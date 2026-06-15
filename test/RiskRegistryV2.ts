import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Address } from "viem";
import { keccak256, toHex, zeroAddress } from "viem";

const ACTION_HASH = keccak256(toHex("send_payment:0x01:0.001"));
const ACTION_HASH_2 = keccak256(toHex("execute_swap:0x02:1.0"));
const WALLET = "0x0000000000000000000000000000000000000001" as Address;
const AGENT = "0x0000000000000000000000000000000000000002" as Address;
const AGENT_2 = "0x0000000000000000000000000000000000000003" as Address;
const NOBODY = "0x0000000000000000000000000000000000000099" as Address;

async function deployFixture() {
  const { viem } = await network.create();
  const registry = await viem.deployContract("RiskRegistryV2");
  const publicClient = await viem.getPublicClient();
  const [ownerWallet, agentWallet, nobodyWallet] = await viem.getWalletClients();
  return { registry, publicClient, ownerWallet, agentWallet, nobodyWallet, viem };
}

function futureTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 86400);
}

function pastTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) - 86400);
}

// ─── Authorization Tests ──────────────────────────────────────────

describe("RiskRegistryV2 — Authorization", async function () {
  it("owner can authorize agent", async function () {
    const { registry } = await deployFixture();
    await registry.write.setAuthorizedAgent([AGENT, true]);
    assert.equal(await registry.read.isAuthorizedAgent([AGENT]), true);
  });

  it("owner can revoke agent", async function () {
    const { registry } = await deployFixture();
    await registry.write.setAuthorizedAgent([AGENT, true]);
    await registry.write.setAuthorizedAgent([AGENT, false]);
    assert.equal(await registry.read.isAuthorizedAgent([AGENT]), false);
  });

  it("non-owner cannot authorize agent", async function () {
    const { registry, agentWallet } = await deployFixture();
    await assert.rejects(
      registry.write.setAuthorizedAgent([AGENT, true], { account: agentWallet.account }),
      /caller is not the owner/,
    );
  });

  it("zero address authorization reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.setAuthorizedAgent([zeroAddress, true]),
      /ZeroAddress/,
    );
  });

  it("batch authorization works", async function () {
    const { registry } = await deployFixture();
    await registry.write.batchSetAuthorizedAgents([[AGENT, AGENT_2], true]);
    assert.equal(await registry.read.isAuthorizedAgent([AGENT]), true);
    assert.equal(await registry.read.isAuthorizedAgent([AGENT_2]), true);
  });

  it("empty batch reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.batchSetAuthorizedAgents([[], true]),
      /EmptyArray/,
    );
  });

  it("batch with zero address reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.batchSetAuthorizedAgents([[AGENT, zeroAddress], true]),
      /ZeroAddress/,
    );
  });
});

// ─── Risk Publishing Tests ────────────────────────────────────────

describe("RiskRegistryV2 — Publishing", async function () {
  it("owner can publish valid risk record", async function () {
    const { registry } = await deployFixture();
    const tx = await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 75, "MEDIUM", "Review needed", "v1.6.0", "", futureTimestamp(),
    ]);
    const record = await registry.read.getRiskRecord([1n]);
    assert.equal(record.wallet, WALLET);
    assert.equal(record.score, 75);
    assert.equal(record.riskLevel, "MEDIUM");
  });

  it("authorized agent can publish valid risk record", async function () {
    const { registry, agentWallet } = await deployFixture();
    await registry.write.setAuthorizedAgent([agentWallet.account.address, true]);
    await registry.write.publishRiskRecord(
      [WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp()],
      { account: agentWallet.account },
    );
    const record = await registry.read.getRiskRecord([1n]);
    assert.equal(record.score, 50);
  });

  it("unauthorized wallet cannot publish risk record", async function () {
    const { registry, nobodyWallet } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord(
        [WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp()],
        { account: nobodyWallet.account },
      ),
      /UnauthorizedPublisher/,
    );
  });

  it("wallet zero address reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord([
        zeroAddress, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
      ]),
      /ZeroAddress/,
    );
  });

  it("agent zero address reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord([
        WALLET, zeroAddress, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
      ]),
      /ZeroAddress/,
    );
  });

  it("score > 100 reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord([
        WALLET, AGENT, ACTION_HASH, 101, "HIGH", "Bad", "v1.6.0", "", futureTimestamp(),
      ]),
      /InvalidScore/,
    );
  });

  it("empty riskLevel reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord([
        WALLET, AGENT, ACTION_HASH, 50, "", "Safe", "v1.6.0", "", futureTimestamp(),
      ]),
      /EmptyString/,
    );
  });

  it("empty recommendation reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord([
        WALLET, AGENT, ACTION_HASH, 50, "LOW", "", "v1.6.0", "", futureTimestamp(),
      ]),
      /EmptyString/,
    );
  });

  it("empty policyVersion reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord([
        WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "", "", futureTimestamp(),
      ]),
      /EmptyString/,
    );
  });

  it("zero actionHash reverts", async function () {
    const { registry } = await deployFixture();
    const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
    await assert.rejects(
      registry.write.publishRiskRecord([
        WALLET, AGENT, zeroHash, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
      ]),
      /InvalidActionHash/,
    );
  });

  it("expired expiresAt reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.publishRiskRecord([
        WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", pastTimestamp(),
      ]),
      /InvalidExpiry/,
    );
  });

  it("expiresAt=0 is accepted (no expiry)", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", 0n,
    ]);
    const record = await registry.read.getRiskRecord([1n]);
    assert.equal(record.expiresAt, 0n);
  });
});

// ─── Query Tests ──────────────────────────────────────────────────

describe("RiskRegistryV2 — Queries", async function () {
  it("getRiskRecord returns stored record", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 80, "HIGH", "Block", "v1.6.0", "ipfs://evidence", futureTimestamp(),
    ]);
    const record = await registry.read.getRiskRecord([1n]);
    assert.equal(record.recordId, 1n);
    assert.equal(record.wallet, WALLET);
    assert.equal(record.agent, AGENT);
    assert.equal(record.actionHash, ACTION_HASH);
    assert.equal(record.score, 80);
    assert.equal(record.riskLevel, "HIGH");
    assert.equal(record.recommendation, "Block");
    assert.equal(record.policyVersion, "v1.6.0");
    assert.equal(record.evidenceURI, "ipfs://evidence");
    assert.equal(record.revoked, false);
  });

  it("getLatestRiskRecordForWallet returns latest record", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 30, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH_2, 90, "CRITICAL", "Block now", "v1.6.0", "", futureTimestamp(),
    ]);
    const latest = await registry.read.getLatestRiskRecordForWallet([WALLET]);
    assert.equal(latest.recordId, 2n);
    assert.equal(latest.score, 90);
  });

  it("getRiskRecordsForWallet returns all wallet record IDs", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 30, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH_2, 90, "CRITICAL", "Block", "v1.6.0", "", futureTimestamp(),
    ]);
    const ids = await registry.read.getRiskRecordsForWallet([WALLET]);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], 1n);
    assert.equal(ids[1], 2n);
  });

  it("getRiskRecordByActionHash returns expected record", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "MEDIUM", "Review", "v1.6.0", "", futureTimestamp(),
    ]);
    const record = await registry.read.getRiskRecordByActionHash([ACTION_HASH]);
    assert.equal(record.recordId, 1n);
    assert.equal(record.actionHash, ACTION_HASH);
  });

  it("nonexistent record query reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.read.getRiskRecord([999n]),
      /RecordNotFound/,
    );
  });

  it("nonexistent wallet latest query reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.read.getLatestRiskRecordForWallet([NOBODY]),
      /RecordNotFound/,
    );
  });

  it("nonexistent actionHash query reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.read.getRiskRecordByActionHash([ACTION_HASH]),
      /RecordNotFound/,
    );
  });
});

// ─── Revocation Tests ─────────────────────────────────────────────

describe("RiskRegistryV2 — Revocation", async function () {
  it("owner can revoke record", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    await registry.write.revokeRiskRecord([1n]);
    const record = await registry.read.getRiskRecord([1n]);
    assert.equal(record.revoked, true);
  });

  it("non-owner cannot revoke record", async function () {
    const { registry, agentWallet } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    await assert.rejects(
      registry.write.revokeRiskRecord([1n], { account: agentWallet.account }),
      /caller is not the owner/,
    );
  });

  it("revoked record is not valid", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    await registry.write.revokeRiskRecord([1n]);
    assert.equal(await registry.read.isRiskRecordValid([1n]), false);
  });

  it("revoking already-revoked record reverts", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    await registry.write.revokeRiskRecord([1n]);
    await assert.rejects(
      registry.write.revokeRiskRecord([1n]),
      /AlreadyRevoked/,
    );
  });

  it("revoking nonexistent record reverts", async function () {
    const { registry } = await deployFixture();
    await assert.rejects(
      registry.write.revokeRiskRecord([999n]),
      /RecordNotFound/,
    );
  });

  it("valid unexpired non-revoked record is valid", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    assert.equal(await registry.read.isRiskRecordValid([1n]), true);
  });

  it("record with no expiry (0) is valid", async function () {
    const { registry } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", 0n,
    ]);
    assert.equal(await registry.read.isRiskRecordValid([1n]), true);
  });

  it("nonexistent record is not valid", async function () {
    const { registry } = await deployFixture();
    assert.equal(await registry.read.isRiskRecordValid([999n]), false);
  });
});

// ─── Event Tests ──────────────────────────────────────────────────

describe("RiskRegistryV2 — Events", async function () {
  it("emits AgentAuthorizationUpdated on authorize", async function () {
    const { registry, viem } = await deployFixture();
    await viem.assertions.emit(
      registry.write.setAuthorizedAgent([AGENT, true]),
      registry,
      "AgentAuthorizationUpdated",
    );
  });

  it("emits RiskRecordPublished on publish", async function () {
    const { registry, viem } = await deployFixture();
    await viem.assertions.emit(
      registry.write.publishRiskRecord([
        WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
      ]),
      registry,
      "RiskRecordPublished",
    );
  });

  it("emits RiskRecordRevoked on revoke", async function () {
    const { registry, viem } = await deployFixture();
    await registry.write.publishRiskRecord([
      WALLET, AGENT, ACTION_HASH, 50, "LOW", "Safe", "v1.6.0", "", futureTimestamp(),
    ]);
    await viem.assertions.emit(
      registry.write.revokeRiskRecord([1n]),
      registry,
      "RiskRecordRevoked",
    );
  });
});
