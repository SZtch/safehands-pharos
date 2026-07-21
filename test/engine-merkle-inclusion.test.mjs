// ─── Hosted engine: Merkle inclusion, differential against the real writer ──
// The registry commits a Merkle root plus a data-availability pointer. Until
// now the hosted engine read the batch behind that pointer but could not prove
// it was the batch the chain committed to, so its records carried a
// "recordsVerifiedAgainstRoot: false" disclaimer and stayed advisory.
//
// The engine now rebuilds every leaf and the whole tree itself. That is only
// safe if its zero-dependency port is byte-for-byte identical to the writer, so
// this file differentials it against the canonical implementation:
//   • computeRiskLeaf   ← src/lib/merkleBatcher.ts (viem encodeAbiParameters + double keccak)
//   • merkleRootSortedPairs ← merkletreejs { sortPairs: true }
// A single divergence here would either reject every honest batch or, far
// worse, accept a batch the chain never committed to.
//
// LEAF_ABI is all-static (address,bytes32,uint8,uint8,uint8,bytes32,bytes32,
// uint64), which is why the port can be eight right-aligned words with no
// offset handling; the random cases below cover the field ranges that matters.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeRiskLeaf as engineLeaf, merkleRootSortedPairs, verifyBatchAgainstRoot } from "../anvita/safehands/scripts/safehands-engine.js";
import { computeRiskLeaf as canonicalLeaf, buildMerkleTree } from "../src/lib/merkleBatcher.js";

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (rnd, bytes) => "0x" + Array.from({ length: bytes * 2 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");

/** A record shaped exactly like the writer's RiskRecordInput. */
function randomRecord(rnd) {
  return {
    target: hex(rnd, 20),
    actionHash: hex(rnd, 32),
    score: Math.floor(rnd() * 101),
    level: Math.floor(rnd() * 4),
    recommendation: Math.floor(rnd() * 3),
    policyVersionHash: hex(rnd, 32),
    evidenceHash: hex(rnd, 32),
    expiresAt: BigInt(Math.floor(rnd() * 4_000_000_000)),
  };
}

/** How the writer serializes a batch to the DA pointer (BigInt → "123n"). */
const asCommitted = (rec) => JSON.parse(JSON.stringify(rec, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)));

describe("hosted leaf encoding matches the canonical writer", () => {
  it("agrees on 300 random records", () => {
    const rnd = mulberry32(0x1eaf);
    for (let i = 0; i < 300; i++) {
      const rec = randomRecord(rnd);
      assert.strictEqual(
        engineLeaf(asCommitted(rec)), canonicalLeaf(rec),
        `leaf mismatch for ${JSON.stringify(asCommitted(rec))}`
      );
    }
  });

  it("agrees on the field boundaries", () => {
    const edge = {
      target: "0x" + "00".repeat(20), actionHash: "0x" + "00".repeat(32),
      score: 0, level: 0, recommendation: 0,
      policyVersionHash: "0x" + "00".repeat(32), evidenceHash: "0x" + "00".repeat(32), expiresAt: 0n,
    };
    const max = {
      target: "0x" + "ff".repeat(20), actionHash: "0x" + "ff".repeat(32),
      score: 255, level: 255, recommendation: 255,
      policyVersionHash: "0x" + "ff".repeat(32), evidenceHash: "0x" + "ff".repeat(32),
      expiresAt: (1n << 64n) - 1n,
    };
    assert.strictEqual(engineLeaf(asCommitted(edge)), canonicalLeaf(edge));
    assert.strictEqual(engineLeaf(asCommitted(max)), canonicalLeaf(max));
  });

  it("refuses a record it cannot encode rather than guessing", () => {
    const good = asCommitted(randomRecord(mulberry32(7)));
    for (const broken of [
      { ...good, target: "0xnot-an-address" }, { ...good, target: undefined },
      { ...good, actionHash: "0x1234" }, { ...good, score: undefined },
      { ...good, score: 256 }, { ...good, level: -1 }, { ...good, expiresAt: "not-a-number" },
      { ...good, expiresAt: (1n << 64n).toString() }, { ...good, evidenceHash: null },
    ]) {
      assert.strictEqual(engineLeaf(broken), null, `must refuse: ${JSON.stringify(broken).slice(0, 90)}`);
    }
    assert.notStrictEqual(engineLeaf(good), null, "a well-formed record must still encode");
  });
});

describe("hosted root matches merkletreejs sortPairs", () => {
  it("agrees for batches of every size from 1 to 24", () => {
    const rnd = mulberry32(0x0007);
    for (let size = 1; size <= 24; size++) {
      const records = Array.from({ length: size }, () => randomRecord(rnd));
      const canonical = buildMerkleTree(records).getHexRoot();
      const ours = merkleRootSortedPairs(records.map((r) => engineLeaf(asCommitted(r))));
      assert.strictEqual(ours.toLowerCase(), canonical.toLowerCase(), `root mismatch at batch size ${size}`);
    }
  });

  it("agrees on 60 random batch sizes, including the odd-node carry", () => {
    const rnd = mulberry32(0xf00d);
    for (let i = 0; i < 60; i++) {
      const size = 1 + Math.floor(rnd() * 40);
      const records = Array.from({ length: size }, () => randomRecord(rnd));
      const canonical = buildMerkleTree(records).getHexRoot();
      const ours = merkleRootSortedPairs(records.map((r) => engineLeaf(asCommitted(r))));
      assert.strictEqual(ours.toLowerCase(), canonical.toLowerCase(), `root mismatch at size ${size}`);
    }
  });
});

describe("batch verification fails closed", () => {
  const rnd = mulberry32(0xbeef);
  const records = Array.from({ length: 5 }, () => randomRecord(rnd));
  const committed = buildMerkleTree(records).getHexRoot();
  const batch = records.map(asCommitted);

  it("verifies a batch that really is the committed one", () => {
    const out = verifyBatchAgainstRoot(batch, committed);
    assert.strictEqual(out.verified, true, JSON.stringify(out));
  });

  it("rejects a batch with a single altered field", () => {
    const tampered = batch.map((r, i) => (i === 2 ? { ...r, score: r.score === 100 ? 99 : r.score + 1 } : r));
    const out = verifyBatchAgainstRoot(tampered, committed);
    assert.strictEqual(out.verified, false);
    assert.strictEqual(out.reason, "root-mismatch");
  });

  it("rejects a batch with a record appended or removed", () => {
    assert.strictEqual(verifyBatchAgainstRoot([...batch, asCommitted(randomRecord(rnd))], committed).reason, "root-mismatch");
    assert.strictEqual(verifyBatchAgainstRoot(batch.slice(0, 4), committed).reason, "root-mismatch");
  });

  it("refuses to verify without a real committed root", () => {
    for (const root of [undefined, null, "0x", "0x" + "00".repeat(32), "not-a-root"]) {
      const out = verifyBatchAgainstRoot(batch, root);
      assert.strictEqual(out.verified, false, `root ${root} must not verify`);
      assert.strictEqual(out.reason, "no-committed-root");
    }
  });

  it("refuses a batch too large to rebuild inside a hosted call", () => {
    // Rebuilding is linear in pure-JS keccak, and the 2 MB response cap allows
    // roughly 6000 records, which measured over 5 s. Refusing above the bound
    // keeps the failure explicit instead of letting a hosted call time out.
    const huge = Array.from({ length: 2001 }, (_, i) => ({ ...batch[0], score: i % 101 }));
    const out = verifyBatchAgainstRoot(huge, committed);
    assert.strictEqual(out.verified, false);
    assert.strictEqual(out.reason, "batch-too-large");
  });

  it("still verifies a batch exactly at the bound", () => {
    // The guard must reject only ABOVE the limit, never at it.
    const rnd2 = mulberry32(0x2000);
    const atLimit = Array.from({ length: 2000 }, () => randomRecord(rnd2));
    const root = buildMerkleTree(atLimit).getHexRoot();
    const out = verifyBatchAgainstRoot(atLimit.map(asCommitted), root);
    assert.strictEqual(out.verified, true, "a batch at exactly the bound must still verify");
  });

  it("refuses an empty batch and a batch holding an unencodable record", () => {
    assert.strictEqual(verifyBatchAgainstRoot([], committed).reason, "batch-empty");
    assert.strictEqual(verifyBatchAgainstRoot("not-an-array", committed).reason, "batch-empty");
    const broken = batch.map((r, i) => (i === 1 ? { ...r, actionHash: "0xshort" } : r));
    assert.strictEqual(verifyBatchAgainstRoot(broken, committed).reason, "record-not-encodable");
  });

  it("is order sensitive only where the tree is", () => {
    // sortPairs sorts each PAIR, not the leaf list, so leaf order is part of the
    // commitment: a reordered batch is a different tree.
    const reversed = [...batch].reverse();
    const out = verifyBatchAgainstRoot(reversed, committed);
    if (out.verified) assert.strictEqual(batch.length, 1, "only a single-leaf batch may be order-insensitive");
    else assert.strictEqual(out.reason, "root-mismatch");
  });
});
