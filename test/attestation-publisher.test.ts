// ─── Attestation publisher behavioral tests (hermetic — temp store, mocked RPC) ──
// publishAttestation / retryPendingAttestations / getAgentReputation
// (src/lib/pharos/attestationPublisher.ts). Pins the fail-closed contract:
//   • unconfigured + not required  → "skipped", nothing persisted (zero-custody default);
//   • unconfigured + REQUIRED      → "failed" + a persisted record with lastError
//     (a required attestation that can't publish must leave loud evidence);
//   • classifyAction maps calldata → the contract's action-type hashes;
//   • getAgentReputation degrades to a NEUTRAL zero (never negative, never a throw)
//     when unconfigured, on bad input, and on RPC failure;
//   • the retry sweep picks up due pending_retry records and re-resolves their state.
//
// The module reads SAFEHANDS_ATTESTATION_STORE_PATH and the retry flags at import
// time, so env is pinned BEFORE the dynamic import (tsx runs each test file in its
// own process — see the hardhat/tsx isolation memory). viem clients use global
// fetch → mocked JSON-RPC for the reputation reads.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zeroAddress } from "viem";

const ENV_KEYS = [
  "SAFEHANDS_ATTESTATION_STORE_PATH",
  "SAFEHANDS_ATTESTATION_RETRY_ENABLED",
  "SAFEHANDS_ATTESTATION_REQUIRED",
  "SAFEHANDS_ATTESTATION_ADDRESS",
  "SAFEHANDS_ATTESTER_PRIVATE_KEY",
  "PHAROS_RPC_URL",
] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

const tmpDir = mkdtempSync(join(tmpdir(), "sh-attest-"));
const storePath = join(tmpDir, "attestations.json");

// Pin module-load env BEFORE importing the module under test.
process.env.SAFEHANDS_ATTESTATION_STORE_PATH = storePath;
process.env.SAFEHANDS_ATTESTATION_RETRY_ENABLED = "false"; // no background timer in tests
delete process.env.SAFEHANDS_ATTESTATION_REQUIRED;
delete process.env.SAFEHANDS_ATTESTATION_ADDRESS;
delete process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY;

const ap = await import("../src/lib/pharos/attestationPublisher.js");

const AGENT = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x2222222222222222222222222222222222222222";
const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");

// ── Mock JSON-RPC over global fetch (viem reputation reads) ───────────────
const realFetch = globalThis.fetch;
const rpcState = {
  failNext: false,
  reputation: { verifiedCount: 0n, lastAt: 0n },
};

before(() => {
  globalThis.fetch = (async (_input: any, init?: any) => {
    if (rpcState.failNext) throw new Error("mock RPC unreachable");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const handle = (r: any) => {
      let result: unknown = null;
      if (r.method === "eth_chainId") result = "0x688"; // 1672
      else if (r.method === "eth_call") {
        result = `0x${word(rpcState.reputation.verifiedCount)}${word(rpcState.reputation.lastAt)}`;
      }
      return { jsonrpc: "2.0", id: r.id, result };
    };
    const payload = Array.isArray(body) ? body.map(handle) : handle(body);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  rpcState.failNext = false;
  delete process.env.SAFEHANDS_ATTESTATION_REQUIRED;
  delete process.env.SAFEHANDS_ATTESTATION_ADDRESS;
  delete process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY;
  if (existsSync(storePath)) rmSync(storePath);
});

const baseRecord = () => ({
  hash: `0x${"cd".repeat(32)}`,
  chainId: 1672,
  from: AGENT,
  policyVersion: "2.3.0",
});

describe("classifyAction", () => {
  it("empty calldata → PAYMENT", () => {
    assert.strictEqual(ap.classifyAction({ data: undefined }), ap.ACTION_PAYMENT);
    assert.strictEqual(ap.classifyAction({ data: "0x" }), ap.ACTION_PAYMENT);
  });

  it("approve(address,uint256) selector → APPROVAL", () => {
    assert.strictEqual(ap.classifyAction({ data: `0x095ea7b3${"0".repeat(128)}` }), ap.ACTION_APPROVAL);
  });

  it("any other selector → CONTRACT_CALL (never silently PAYMENT)", () => {
    assert.strictEqual(ap.classifyAction({ data: `0xa9059cbb${"0".repeat(128)}` }), ap.ACTION_CONTRACT_CALL);
  });
});

describe("publishAttestation · zero-custody default (unconfigured, not required)", () => {
  it("returns 'skipped' and persists NOTHING", async () => {
    const txHash = `0x${"01".repeat(32)}`;
    const status = await ap.publishAttestation(txHash, { data: "0x" }, baseRecord());
    assert.strictEqual(status, "skipped");
    assert.strictEqual(ap.getAttestationRecord(txHash), null);
  });
});

describe("publishAttestation · SAFEHANDS_ATTESTATION_REQUIRED=true without a signer", () => {
  it("returns 'failed' and persists a loud record with lastError", async () => {
    process.env.SAFEHANDS_ATTESTATION_REQUIRED = "true";
    const txHash = `0x${"02".repeat(32)}`;
    const status = await ap.publishAttestation(txHash, { data: `0x095ea7b3${"0".repeat(128)}` }, baseRecord());
    assert.strictEqual(status, "failed");

    const record = ap.getAttestationRecord(txHash);
    assert.ok(record, "a required-but-unpublishable attestation must leave persisted evidence");
    assert.strictEqual(record.status, "failed");
    assert.match(record.lastError ?? "", /required but signer\/address missing/i);
    assert.strictEqual(record.actionType, ap.ACTION_APPROVAL, "action type derives from the calldata");
    assert.strictEqual(record.agent.toLowerCase(), AGENT.toLowerCase());
    assert.strictEqual(record.chainId, 1672);
  });

  it("attributes to the zero address when the record has no 'from' (never invents an agent)", async () => {
    process.env.SAFEHANDS_ATTESTATION_REQUIRED = "true";
    const txHash = `0x${"03".repeat(32)}`;
    await ap.publishAttestation(txHash, { data: "0x" }, { ...baseRecord(), from: undefined });
    assert.strictEqual(ap.getAttestationRecord(txHash)?.agent, zeroAddress);
  });
});

describe("checkAttestationConfig", () => {
  it("throws when required and unconfigured; passes otherwise", () => {
    process.env.SAFEHANDS_ATTESTATION_REQUIRED = "true";
    assert.throws(() => ap.checkAttestationConfig(), /Attestation required/);
    delete process.env.SAFEHANDS_ATTESTATION_REQUIRED;
    assert.doesNotThrow(() => ap.checkAttestationConfig());
  });
});

describe("getAgentReputation · neutral-zero degradation (read-only, keyless)", () => {
  it("invalid agent address → neutral zero, source 'unconfigured'", async () => {
    const rep = await ap.getAgentReputation("not-an-address");
    assert.deepStrictEqual(
      { verifiedCount: rep.verifiedCount, lastAttestationAt: rep.lastAttestationAt, source: rep.source },
      { verifiedCount: 0, lastAttestationAt: 0, source: "unconfigured" },
    );
  });

  it("no attestation contract configured → neutral zero, configured:false", async () => {
    const rep = await ap.getAgentReputation(AGENT);
    assert.strictEqual(rep.configured, false);
    assert.strictEqual(rep.verifiedCount, 0);
    assert.strictEqual(rep.source, "unconfigured");
  });

  it("configured → reads verifiedCount/lastAt from the contract", async () => {
    process.env.SAFEHANDS_ATTESTATION_ADDRESS = CONTRACT;
    rpcState.reputation = { verifiedCount: 7n, lastAt: 1710000000n };
    const rep = await ap.getAgentReputation(AGENT);
    assert.deepStrictEqual(rep, {
      agent: AGENT,
      configured: true,
      verifiedCount: 7,
      lastAttestationAt: 1710000000,
      source: "onchain",
    });
  });

  it("RPC failure degrades to a neutral zero — never a throw, never negative", async () => {
    process.env.SAFEHANDS_ATTESTATION_ADDRESS = CONTRACT;
    rpcState.failNext = true;
    const rep = await ap.getAgentReputation(AGENT);
    assert.strictEqual(rep.configured, true);
    assert.strictEqual(rep.verifiedCount, 0);
    assert.strictEqual(rep.lastAttestationAt, 0);
  });
});

describe("retryPendingAttestations · due-record sweep", () => {
  it("attempts due pending_retry records and re-resolves them (unconfigured → skipped)", async () => {
    const txHash = `0x${"04".repeat(32)}`;
    const now = Date.now();
    writeFileSync(
      storePath,
      JSON.stringify({
        records: {
          [txHash]: {
            txHash,
            preparedTransactionHash: `0x${"cd".repeat(32)}`,
            chainId: 1672,
            actionType: ap.ACTION_PAYMENT,
            policyHash: `0x${"00".repeat(32)}`,
            metadataHash: `0x${"00".repeat(32)}`,
            agent: AGENT,
            status: "pending_retry",
            attempts: 0,
            nextAttemptAt: now - 1000, // due
            createdAt: now - 5000,
            updatedAt: now - 1000,
          },
        },
      }),
    );

    const attempted = await ap.retryPendingAttestations();
    assert.strictEqual(attempted, 1);
    assert.strictEqual(ap.getAttestationRecord(txHash)?.status, "skipped");
  });

  it("ignores records that are not yet due", async () => {
    const txHash = `0x${"05".repeat(32)}`;
    const now = Date.now();
    writeFileSync(
      storePath,
      JSON.stringify({
        records: {
          [txHash]: {
            txHash,
            preparedTransactionHash: `0x${"cd".repeat(32)}`,
            chainId: 1672,
            actionType: ap.ACTION_PAYMENT,
            policyHash: `0x${"00".repeat(32)}`,
            metadataHash: `0x${"00".repeat(32)}`,
            agent: AGENT,
            status: "pending_retry",
            attempts: 0,
            nextAttemptAt: now + 60_000, // NOT due
            createdAt: now,
            updatedAt: now,
          },
        },
      }),
    );

    const attempted = await ap.retryPendingAttestations();
    assert.strictEqual(attempted, 0);
    assert.strictEqual(ap.getAttestationRecord(txHash)?.status, "pending_retry");
    assert.ok(readFileSync(storePath, "utf-8").includes("pending_retry"));
  });
});
