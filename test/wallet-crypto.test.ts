// ─── M4 · Managed-wallet key encryption (scrypt AES-256-GCM) ───────────────
// The managed-wallet store now derives its AES key with a memory-hard scrypt KDF
// (versioned "sh2:" format) instead of single-pass SHA-256, and the old XOR
// obfuscation path is removed. These are hermetic (no network, no store file).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import { encryptKey, decryptKey } from "../src/lib/wallet/index.js";

const PK = "0x" + "1234567890abcdef".repeat(4); // valid 32-byte test key

describe("M4 · wallet key encryption", () => {
  it("round-trips a private key and emits the versioned scrypt format", () => {
    const enc = encryptKey(PK, "unit-test-encryption-key");
    assert.ok(enc.startsWith("sh2:"), "new ciphertext must use the scrypt-versioned prefix");
    assert.notStrictEqual(enc, PK);
    assert.strictEqual(decryptKey(enc, "unit-test-encryption-key"), PK);
  });

  it("uses a fresh random salt/iv per encryption (ciphertexts differ)", () => {
    assert.notStrictEqual(encryptKey(PK, "k"), encryptKey(PK, "k"));
  });

  it("fails authentication under the wrong key (GCM tag rejects, no silent output)", () => {
    const enc = encryptKey(PK, "right-key");
    assert.throws(() => decryptKey(enc, "wrong-key"));
  });

  it("rejects the removed legacy XOR format instead of silently trusting it", () => {
    assert.throws(() => decryptKey("0xdeadbeefdeadbeef", "any-key"), /no longer supported/);
  });
});
