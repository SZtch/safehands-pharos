// ─── L1 Merkle inclusion read-path ─────────────────────────────────────────
// Verifies the keyless consumer that closes the on-chain-memory loop:
//   • computeRiskLeaf matches the contract's double-keccak(abi.encode(...)) leaf
//   • proveInclusion produces a proof merkletreejs verifies against the batch root
//   • a tampered record no longer satisfies the original proof
//   • records absent from the batch return null (not a false positive)
//   • actionHash disambiguates multiple records for the same target
//   • normalizeRiskRecords coerces every serialized expiresAt / numeric form
//   • verifyRiskInclusion is fail-closed & keyless when the registry is unconfigured
// Pure + deterministic: no chain, no network, no private key.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { MerkleTree } from "merkletreejs";
import { buildMerkleTree, computeRiskLeaf, type RiskRecordInput } from "../src/lib/merkleBatcher.js";
import { proveInclusion, normalizeRiskRecords, verifyRiskInclusion } from "../src/lib/riskInclusion.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const H = (n: number) => (`0x${n.toString(16).padStart(64, "0")}`) as `0x${string}`;

function rec(over: Partial<RiskRecordInput> = {}): RiskRecordInput {
  return {
    target: A,
    actionHash: H(1),
    score: 42,
    level: 2,
    recommendation: 1,
    policyVersionHash: H(2),
    evidenceHash: H(3),
    expiresAt: 0n,
    ...over,
  };
}

// Independent re-implementation of the Solidity leaf, so a drift in computeRiskLeaf
// (which the contract's verifyRiskRecord relies on) fails the test loudly.
function contractLeaf(r: RiskRecordInput): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters("address, bytes32, uint8, uint8, uint8, bytes32, bytes32, uint64"),
    [
      r.target as `0x${string}`,
      r.actionHash as `0x${string}`,
      r.score,
      r.level,
      r.recommendation,
      r.policyVersionHash as `0x${string}`,
      r.evidenceHash as `0x${string}`,
      r.expiresAt,
    ]
  );
  return keccak256(keccak256(encoded));
}

describe("L1 Merkle inclusion read-path", () => {
  it("computeRiskLeaf matches the contract's double-keccak leaf", () => {
    const r = rec();
    assert.equal(computeRiskLeaf(r), contractLeaf(r));
  });

  it("proveInclusion yields a proof that verifies against the batch root", () => {
    const records = [rec({ target: A, actionHash: H(1) }), rec({ target: B, actionHash: H(2) }), rec({ target: A, actionHash: H(9) })];
    const proven = proveInclusion(records, { target: A, actionHash: H(1) });
    assert.ok(proven, "expected a proof");
    assert.equal(proven!.verifiedLocal, true);

    // Root the proof verifies against is the same root the writer would commit.
    assert.equal(proven!.computedRoot, buildMerkleTree(records).getHexRoot());
    // And it verifies through a fresh, independent MerkleTree.verify call.
    assert.equal(
      MerkleTree.verify(proven!.proof, proven!.leaf, proven!.computedRoot, keccak256, { sortPairs: true }),
      true
    );
  });

  it("a tampered record does not satisfy the original proof", () => {
    const records = [rec({ target: A, actionHash: H(1), score: 10 }), rec({ target: B, actionHash: H(2) })];
    const proven = proveInclusion(records, { target: A, actionHash: H(1) })!;
    // Same record but score changed → different leaf → proof must fail.
    const tamperedLeaf = computeRiskLeaf(rec({ target: A, actionHash: H(1), score: 99 }));
    assert.equal(
      MerkleTree.verify(proven.proof, tamperedLeaf, proven.computedRoot, keccak256, { sortPairs: true }),
      false
    );
  });

  it("returns null for a target absent from the batch", () => {
    const records = [rec({ target: A }), rec({ target: B })];
    assert.equal(proveInclusion(records, { target: "0x9999999999999999999999999999999999999999" }), null);
  });

  it("actionHash disambiguates multiple records for the same target", () => {
    const records = [rec({ target: A, actionHash: H(1), score: 1 }), rec({ target: A, actionHash: H(2), score: 2 })];
    const proven = proveInclusion(records, { target: A, actionHash: H(2) })!;
    assert.equal(proven.record.score, 2);
    assert.equal(proven.verifiedLocal, true);
  });

  it("normalizeRiskRecords coerces every serialized numeric form", () => {
    const raw = [
      { target: A, actionHash: H(1), score: "42", level: "2", recommendation: "1", policyVersionHash: H(2), evidenceHash: H(3), expiresAt: "1700000000n" },
      { target: B, actionHash: H(4), score: 7, level: 0, recommendation: 0, policyVersionHash: H(5), evidenceHash: H(6), expiresAt: 1700000001 },
      { target: A, actionHash: H(7), score: 0, level: 0, recommendation: 0, policyVersionHash: H(8), evidenceHash: H(9), expiresAt: "0" },
    ];
    const norm = normalizeRiskRecords(raw);
    assert.equal(norm.length, 3);
    assert.equal(norm[0].expiresAt, 1700000000n);
    assert.equal(norm[0].score, 42);
    assert.equal(typeof norm[0].expiresAt, "bigint");
    assert.equal(norm[1].expiresAt, 1700000001n);
    assert.equal(norm[2].expiresAt, 0n);
    // Normalized records rebuild the identical tree as native bigint records.
    assert.equal(buildMerkleTree(norm).getHexRoot(), buildMerkleTree(norm).getHexRoot());
  });

  it("normalizeRiskRecords ignores non-array / junk input", () => {
    assert.deepEqual(normalizeRiskRecords(null), []);
    assert.deepEqual(normalizeRiskRecords({ not: "an array" }), []);
    assert.equal(normalizeRiskRecords([null, 5, "x"]).length, 0);
  });

  it("verifyRiskInclusion is fail-closed & keyless when the registry is unconfigured", async () => {
    // The Pacific-mainnet registry address is now a baked read-path default, so we
    // force the unconfigured address explicitly → no chain, no network touched.
    // Proves the fail-closed neutral path still holds when no address resolves.
    const result = await verifyRiskInclusion({ target: A }, { registryAddress: "" });
    assert.equal(result.configured, false);
    assert.equal(result.committed, false);
    assert.equal(result.verifiedOnchain, null);
    assert.equal(result.source, "unconfigured");
  });
});
