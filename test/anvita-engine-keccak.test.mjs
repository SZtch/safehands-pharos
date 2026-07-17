// ─── Hosted-engine keccak256 + verdict hash-binding ────────────────────────
// The zero-dep engine ships its own keccak256 (prerequisite for verdict
// hash-binding today and the Merkle-inclusion port next). It must be
// bit-identical to the ecosystem implementation: standard vectors first, then
// a randomized differential against viem's keccak256.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { keccak256 as viemKeccak256 } from "viem";
import { keccak256, keccak256Hex, bindCalldata, bindIntent } from "../anvita/safehands/scripts/safehands-engine.js";

describe("engine keccak256 — standard vectors", () => {
  it("empty input", () => {
    assert.strictEqual(keccak256(Buffer.from("")), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });
  it("'abc'", () => {
    assert.strictEqual(keccak256(Buffer.from("abc")), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  });
  it("exactly one rate block (136 bytes) exercises the padding boundary", () => {
    const b = Buffer.alloc(136, 0x61);
    assert.strictEqual(keccak256(b), viemKeccak256(("0x" + b.toString("hex"))));
  });
});

describe("engine keccak256 — differential vs viem", () => {
  it("matches viem on 64 random inputs across sizes 0..600 bytes", () => {
    for (let i = 0; i < 64; i++) {
      const len = Math.floor(Math.random() * 601);
      const b = randomBytes(len);
      const ours = keccak256(b);
      const theirs = viemKeccak256(("0x" + b.toString("hex")));
      assert.strictEqual(ours, theirs, `mismatch at len ${len}: ${b.toString("hex").slice(0, 40)}…`);
    }
  });
  it("keccak256Hex hashes the BYTES of a 0x string, matching viem's hex mode", () => {
    const hex = "0xdeadbeef00112233";
    assert.strictEqual(keccak256Hex(hex), viemKeccak256(hex));
  });
});

describe("verdict hash-binding", () => {
  it("is deterministic for identical calldata and differs on a single changed byte", () => {
    const a1 = bindCalldata("0x" + "11".repeat(20), "0", "0xabcdef");
    const a2 = bindCalldata("0x" + "11".repeat(20), "0", "0xabcdef");
    const b = bindCalldata("0x" + "11".repeat(20), "0", "0xabcdee");
    assert.strictEqual(a1.digest, a2.digest, "same bytes must bind to the same digest");
    assert.notStrictEqual(a1.digest, b.digest, "different bytes must never share a digest");
    assert.strictEqual(a1.boundTo, "calldata");
    assert.strictEqual(a1.algorithm, "keccak256");
  });
  it("intent binding is field-order independent and value sensitive", () => {
    const x = bindIntent({ action: "transfer", toAddress: "0xAA", amount: "1" });
    const y = bindIntent({ amount: "1", action: "transfer", toAddress: "0xaa" });
    const z = bindIntent({ action: "transfer", toAddress: "0xAA", amount: "2" });
    assert.strictEqual(x.digest, y.digest, "key order and address case must not change the digest");
    assert.notStrictEqual(x.digest, z.digest, "a different amount must change the digest");
  });
  it("carries an advisory expiry after issuedAt", () => {
    const v = bindCalldata("0x" + "22".repeat(20), "0", "0x");
    assert.ok(new Date(v.expiresAt) > new Date(v.issuedAt), "expiresAt must be after issuedAt");
    assert.match(v.note, /different bytes|expired/i);
  });
});
