// ─── Pharos SPV verifier behavioral tests (pure crypto — no network) ────────
// verifyPharosSPV is the trustless read-path proof check (SHA-256 MSU trie,
// NOT Keccak). These tests pin the soundness properties:
//   • existence: the walked hash chain must terminate exactly at the stateRoot;
//   • the key-derived slot-offset check (deriveExpectedOffset) rejects proofs
//     that redirect through the wrong slot (fake-slot redirection);
//   • non-existence: the main chain must root correctly AND every sibling
//     chain must independently root correctly;
//   • malformed input (empty proof) fails closed.
// Proof fixtures are synthesized with the module's own hash helpers, and
// sha256Hex itself is cross-checked against node:crypto independently.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import {
  sha256Hex,
  getNibbleAtDepth,
  deriveExpectedOffset,
  verifyPharosSPV,
  type SPVProofNode,
} from "../src/lib/pharos/spvVerifier.js";

const node = (proofNode: string, nextBeginOffset = 0, nextEndOffset = 0): SPVProofNode => ({
  proofNode,
  nextBeginOffset,
  nextEndOffset,
});

// A 32-byte key whose last byte is 0x11 (=17) → MSU root offset 17*32 = 544.
const KEY = `0x${"11".repeat(32)}`;

describe("sha256Hex", () => {
  it("matches an independent node:crypto SHA-256 of the same bytes", () => {
    const independent = `0x${createHash("sha256").update(Buffer.from([0xde, 0xad, 0xbe, 0xef])).digest("hex")}`;
    assert.strictEqual(sha256Hex("0xdeadbeef"), independent);
  });
});

describe("getNibbleAtDepth", () => {
  it("reads nibbles left-to-right and returns 0 past the end", () => {
    assert.strictEqual(getNibbleAtDepth("0x1f00", 0), 0x1);
    assert.strictEqual(getNibbleAtDepth("0x1f00", 1), 0xf);
    assert.strictEqual(getNibbleAtDepth("0x1f00", 99), 0);
  });
});

describe("deriveExpectedOffset", () => {
  it("depth 0 (MSU root): last byte of the key × 32", () => {
    assert.strictEqual(deriveExpectedOffset(KEY, 0), 17 * 32);
  });

  it("depth ≥ 1 (internal node): 3-byte header + key-hash nibble × 32", () => {
    const nibble = getNibbleAtDepth(sha256Hex(KEY), 0);
    assert.strictEqual(deriveExpectedOffset(KEY, 1), 3 + nibble * 32);
  });
});

describe("verifyPharosSPV · existence proofs", () => {
  it("accepts a single-node proof whose hash IS the state root", () => {
    const leaf = node("0xaabbcc");
    assert.strictEqual(verifyPharosSPV(KEY, sha256Hex("0xaabbcc"), true, [leaf]), true);
  });

  it("rejects a single-node proof against the wrong state root", () => {
    const leaf = node("0xaabbcc");
    assert.strictEqual(verifyPharosSPV(KEY, sha256Hex("0x999999"), true, [leaf]), false);
  });

  it("accepts a two-node chain with the correct key-derived offset", () => {
    const proof = [node("0xaaaa", deriveExpectedOffset(KEY, 0)), node("0xbbbb")];
    assert.strictEqual(verifyPharosSPV(KEY, sha256Hex("0xaaaa"), true, proof), true);
  });

  it("THROWS on fake-slot redirection (tampered nextBeginOffset)", () => {
    const proof = [node("0xaaaa", deriveExpectedOffset(KEY, 0) + 32), node("0xbbbb")];
    assert.throws(
      () => verifyPharosSPV(KEY, sha256Hex("0xaaaa"), true, proof),
      /Invalid slot offset/,
      "an offset not derived from the key must be rejected loudly, not walked"
    );
  });

  it("accepts a three-node chain (exercises the internal-node offset at depth 1)", () => {
    const proof = [
      node("0xaaaa", deriveExpectedOffset(KEY, 0)),
      node("0xbbbb", deriveExpectedOffset(KEY, 1)),
      node("0xcccc"),
    ];
    assert.strictEqual(verifyPharosSPV(KEY, sha256Hex("0xaaaa"), true, proof), true);
  });

  it("fails closed on an empty proof", () => {
    assert.strictEqual(verifyPharosSPV(KEY, sha256Hex("0x00"), true, []), false);
  });
});

describe("verifyPharosSPV · non-existence proofs", () => {
  it("accepts when the main chain roots correctly and there are no siblings", () => {
    const proof = [node("0xdddd")];
    assert.strictEqual(verifyPharosSPV(KEY, sha256Hex("0xdddd"), false, proof), true);
  });

  it("rejects when the main chain does not reach the state root", () => {
    const proof = [node("0xdddd")];
    assert.strictEqual(verifyPharosSPV(KEY, sha256Hex("0xeeee"), false, proof), false);
  });

  it("accepts only when EVERY sibling chain independently reaches the state root", () => {
    const root = sha256Hex("0xdddd");
    const proof = [node("0xdddd")];
    const goodSibling = {
      slotIndex: 3,
      leftmostLeafKey: `0x${"22".repeat(32)}`,
      proofPath: [node("0xdddd")], // hashes to the same root
    };
    const badSibling = {
      slotIndex: 4,
      leftmostLeafKey: `0x${"33".repeat(32)}`,
      proofPath: [node("0xffff")], // hashes elsewhere
    };
    assert.strictEqual(verifyPharosSPV(KEY, root, false, proof, [goodSibling]), true);
    assert.strictEqual(verifyPharosSPV(KEY, root, false, proof, [goodSibling, badSibling]), false);
  });

  it("skips empty sibling proof paths without failing the whole proof", () => {
    const root = sha256Hex("0xdddd");
    const proof = [node("0xdddd")];
    const emptySibling = { slotIndex: 0, leftmostLeafKey: KEY, proofPath: [] };
    assert.strictEqual(verifyPharosSPV(KEY, root, false, proof, [emptySibling]), true);
  });
});
