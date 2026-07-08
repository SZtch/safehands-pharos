import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, toHex, toFunctionSelector, zeroAddress } from "viem";

type HardhatViemRuntime = {
  viem: {
    deployContract: (name: string, args?: readonly unknown[]) => Promise<any>;
    getWalletClients: () => Promise<Array<{ account: { address: `0x${string}` } }>>;
  };
};

async function getViem() {
  const connection = await network.create();
  return (connection as unknown as HardhatViemRuntime).viem;
}


const PREPARED_HASH = keccak256(toHex("prepared:1"));
const TX_HASH = keccak256(toHex("tx:1"));
const PREPARED_HASH_2 = keccak256(toHex("prepared:2"));
const TX_HASH_2 = keccak256(toHex("tx:2"));
const ACTION_PAYMENT = keccak256(toHex("PAYMENT"));
const POLICY_HASH = keccak256(toHex("policy:2.0.0"));
const META_HASH = keccak256(toHex("meta"));
const CHAIN_ID = 1672n;

// All-digit addresses — case-insensitive, no checksum concerns.
const AGENT: `0x${string}` = "0x1111111111111111111111111111111111111111";
const AGENT_2: `0x${string}` = "0x2222222222222222222222222222222222222222";

/**
 * Assert a contract call reverts with a specific custom error (name OR raw selector).
 */
async function rejectsWithError(promise: Promise<unknown>, errorName: string): Promise<void> {
  const selector = toFunctionSelector(`${errorName}()`);
  await assert.rejects(promise, (err: unknown) => {
    const msg = String(err);
    return msg.includes(errorName) || msg.includes(selector);
  });
}

async function deployFixture() {
  const viem = await getViem();
  const registry = await viem.deployContract("SafeHandsRegistry");
  const attestation = await viem.deployContract("SafeHandsAttestation", [registry.address]);
  const [ownerWallet, operatorWallet, nobodyWallet] = await viem.getWalletClients();
  return { registry, attestation, ownerWallet, operatorWallet, nobodyWallet, viem };
}

describe("SafeHandsAttestation — Construction", async function () {
  it("reverts on a zero registry address", async function () {
    const { viem } = await deployFixture();
    await rejectsWithError(viem.deployContract("SafeHandsAttestation", [zeroAddress]), "ZeroRegistry");
  });

  it("links to the registry", async function () {
    const { attestation, registry } = await deployFixture();
    assert.equal((await attestation.read.registry()).toLowerCase(), registry.address.toLowerCase());
  });
});

describe("SafeHandsAttestation — Attesting", async function () {
  it("the registry owner can attest; views reflect it", async function () {
    const { attestation } = await deployFixture();
    await attestation.write.attest([PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]);
    assert.equal(await attestation.read.isAttested([TX_HASH]), true);
    assert.equal(await attestation.read.isPreparedAttested([PREPARED_HASH]), true);
    assert.equal(await attestation.read.attestationCount(), 1n);
    const a = await attestation.read.getAttestation([TX_HASH]);
    assert.equal(a.chainId, CHAIN_ID);
    assert.equal(a.actionType, ACTION_PAYMENT);
    assert.equal(a.policyHash, POLICY_HASH);
    assert.equal(a.agent.toLowerCase(), AGENT);
  });

  it("an operator authorized in the registry can attest", async function () {
    const { registry, attestation, operatorWallet } = await deployFixture();
    await registry.write.setOperator([operatorWallet.account.address, true]);
    await attestation.write.attest(
      [PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT],
      { account: operatorWallet.account },
    );
    assert.equal(await attestation.read.isAttested([TX_HASH]), true);
  });

  it("a stranger cannot attest", async function () {
    const { attestation, nobodyWallet } = await deployFixture();
    await rejectsWithError(
      attestation.write.attest(
        [PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT],
        { account: nobodyWallet.account },
      ),
      "UnauthorizedAttester",
    );
  });

  it("rejects zero hashes and zero chainId", async function () {
    const { attestation } = await deployFixture();
    const ZERO_HASH = ("0x" + "0".repeat(64)) as `0x${string}`;
    await rejectsWithError(
      attestation.write.attest([ZERO_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]),
      "ZeroHash",
    );
    await rejectsWithError(
      attestation.write.attest([PREPARED_HASH, ZERO_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]),
      "ZeroHash",
    );
    await rejectsWithError(
      attestation.write.attest([PREPARED_HASH, TX_HASH, 0n, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]),
      "InvalidChainId",
    );
  });

  it("duplicate txHash reverts", async function () {
    const { attestation } = await deployFixture();
    await attestation.write.attest([PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]);
    await rejectsWithError(
      attestation.write.attest([PREPARED_HASH_2, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]),
      "AlreadyAttested",
    );
  });

  it("duplicate preparedTransactionHash reverts", async function () {
    const { attestation } = await deployFixture();
    await attestation.write.attest([PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]);
    await rejectsWithError(
      attestation.write.attest([PREPARED_HASH, TX_HASH_2, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]),
      "AlreadyAttested",
    );
  });

  it("revoking operator status blocks further attestations", async function () {
    const { registry, attestation, operatorWallet } = await deployFixture();
    await registry.write.setOperator([operatorWallet.account.address, true]);
    await attestation.write.attest(
      [PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT],
      { account: operatorWallet.account },
    );
    await registry.write.setOperator([operatorWallet.account.address, false]);
    await rejectsWithError(
      attestation.write.attest(
        [PREPARED_HASH_2, TX_HASH_2, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT],
        { account: operatorWallet.account },
      ),
      "UnauthorizedAttester",
    );
  });
});

describe("SafeHandsAttestation — Agent reputation", async function () {
  it("reputation is zero for an unknown agent", async function () {
    const { attestation } = await deployFixture();
    assert.equal(await attestation.read.attestationCountByAgent([AGENT]), 0n);
    assert.equal(await attestation.read.lastAttestationAt([AGENT]), 0n);
  });

  it("records the agent and increments its reputation", async function () {
    const { attestation } = await deployFixture();
    await attestation.write.attest([PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]);
    const a = await attestation.read.getAttestation([TX_HASH]);
    assert.equal(a.agent.toLowerCase(), AGENT);
    assert.equal(await attestation.read.attestationCountByAgent([AGENT]), 1n);
    assert.ok((await attestation.read.lastAttestationAt([AGENT])) > 0n);
  });

  it("accumulates reputation across multiple verified actions", async function () {
    const { attestation } = await deployFixture();
    await attestation.write.attest([PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]);
    await attestation.write.attest([PREPARED_HASH_2, TX_HASH_2, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]);
    assert.equal(await attestation.read.attestationCountByAgent([AGENT]), 2n);
  });

  it("does not attribute reputation to the zero address but still records the attestation", async function () {
    const { attestation } = await deployFixture();
    await attestation.write.attest([PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, zeroAddress]);
    assert.equal(await attestation.read.isAttested([TX_HASH]), true);
    assert.equal(await attestation.read.attestationCountByAgent([zeroAddress]), 0n);
  });

  it("reputationOf reflects per-agent counts independently", async function () {
    const { attestation } = await deployFixture();
    await attestation.write.attest([PREPARED_HASH, TX_HASH, CHAIN_ID, ACTION_PAYMENT, POLICY_HASH, META_HASH, AGENT]);
    assert.equal(await attestation.read.attestationCountByAgent([AGENT]), 1n);
    assert.equal(await attestation.read.attestationCountByAgent([AGENT_2]), 0n);
    const rep = await attestation.read.reputationOf([AGENT]);
    // viem returns named multi-returns as an array tuple [verifiedCount, lastAt].
    assert.equal(rep[0], 1n);
    assert.ok(rep[1] > 0n);
  });
});
