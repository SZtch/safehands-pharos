// ─── Anvita hosted engine — resolve_alias (registry-only name resolution) ──
// Unit tests import the engine's exported resolveAliasCore (the engine is
// import-safe via its run-guard); CLI tests drive the real artifact as a
// subprocess. resolve_alias makes NO network calls, so no mock RPC is needed.
// Locks the fail-closed contract: exact-match only, never fuzzy, unknown
// aliases and non-ASCII (homoglyph) input are structured failures.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENGINE_URL = new URL("../anvita/safehands/scripts/safehands-engine.js", import.meta.url);
const ENGINE = fileURLToPath(ENGINE_URL);
const KNOWN = JSON.parse(readFileSync(new URL("../anvita/safehands/assets/known-pharos.json", import.meta.url), "utf8"));

const { resolveAliasCore } = await import(ENGINE_URL);

function runEngine(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENGINE, ...args], { env: { ...process.env } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", (code) => resolve({ code, json: JSON.parse(out) }));
  });
}

describe("resolveAliasCore (imported)", () => {
  it("resolves a verified protocol alias to its canonical contracts", () => {
    const r = resolveAliasCore("okx");
    assert.strictEqual(r.matches.length, 1);
    const m = r.matches[0];
    assert.strictEqual(m.kind, "protocol");
    assert.strictEqual(m.protocol, "okx-dex");
    assert.strictEqual(m.verificationStatus, "verified");
    assert.ok(m.contracts && Object.keys(m.contracts).length === 2);
  });

  it("resolves a canonical token symbol case-insensitively", () => {
    const r = resolveAliasCore("usdc");
    const token = r.matches.find((m) => m.kind === "token");
    assert.ok(token);
    assert.strictEqual(token.symbol, "USDC");
    assert.strictEqual(token.address, KNOWN.canonicalTokens.USDC);
    assert.strictEqual(token.verification, "canonical");
  });

  it("resolves a multi-word registry alias with whitespace normalization", () => {
    const r = resolveAliasCore("  Morpho   Blue  ");
    const p = r.matches.find((m) => m.kind === "protocol");
    assert.ok(p);
    assert.strictEqual(p.protocol, "morpho");
    assert.strictEqual(p.verificationStatus, "verified");
  });

  it("an UNVERIFIED protocol resolves with null contracts and do-not-trust guidance", () => {
    const r = resolveAliasCore("faroswap");
    const p = r.matches.find((m) => m.kind === "protocol");
    assert.ok(p);
    assert.strictEqual(p.verificationStatus, "unverified");
    assert.strictEqual(p.contracts, null);
    assert.ok(/NOT verified/i.test(p.guidance));
    assert.ok(/do not trust/i.test(p.guidance));
  });

  it("pros and pharos resolve to the native token, never a contract address", () => {
    for (const q of ["pros", "PHAROS"]) {
      const r = resolveAliasCore(q);
      const n = r.matches.find((m) => m.kind === "native");
      assert.ok(n, `${q} should match native`);
      assert.strictEqual(n.symbol, "PROS");
      assert.strictEqual(n.address, undefined);
    }
  });

  it("unknown aliases return zero matches, never a fuzzy guess", () => {
    for (const q of ["pepecoin", "usdcc", "okx-", "morph"]) {
      assert.strictEqual(resolveAliasCore(q).matches.length, 0, `${q} must not match`);
    }
  });

  it("non-ASCII (homoglyph) input is rejected outright", () => {
    const cyrillic = "USDС"; // Cyrillic Es masquerading as C
    const r = resolveAliasCore(cyrillic);
    assert.strictEqual(r.error.code, "ALIAS_CHARSET_REJECTED");
  });

  it("empty input is a validation error", () => {
    assert.strictEqual(resolveAliasCore("   ").error.code, "VALIDATION_ERROR");
    assert.strictEqual(resolveAliasCore(undefined).error.code, "VALIDATION_ERROR");
  });

  it("a 0x address passes through with recognition info", () => {
    const permit2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
    const known = resolveAliasCore(permit2).matches[0];
    assert.strictEqual(known.kind, "address");
    assert.strictEqual(known.recognized, true);

    const unknown = resolveAliasCore("0x9999999999999999999999999999999999999999").matches[0];
    assert.strictEqual(unknown.kind, "address");
    assert.strictEqual(unknown.recognized, false);
    assert.strictEqual(unknown.label, null);
  });

  it("a canonical token address reverse-resolves its symbol", () => {
    const m = resolveAliasCore(KNOWN.canonicalTokens.USDC).matches[0];
    assert.strictEqual(m.recognized, true);
    assert.strictEqual(m.tokenSymbol, "USDC");
  });
});

describe("resolve_alias CLI", () => {
  it("success envelope: verified protocol, exit 0, unambiguous", async () => {
    const { code, json } = await runEngine(["resolve_alias", '{"alias":"okx"}']);
    assert.strictEqual(code, 0);
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.command, "resolve_alias");
    assert.strictEqual(json.ambiguous, false);
    assert.strictEqual(json.chainId, 1672);
    assert.ok(typeof json.rule === "string" && json.rule.length > 0);
  });

  it("unknown alias: structured UNKNOWN_ALIAS failure, exit 1", async () => {
    const { code, json } = await runEngine(["resolve_alias", '{"alias":"pepecoin"}']);
    assert.strictEqual(code, 1);
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, "UNKNOWN_ALIAS");
    assert.ok(/never guesses/i.test(json.error.message));
  });

  it("bare-string argument works like the json form", async () => {
    const { code, json } = await runEngine(["resolve_alias", "USDC"]);
    assert.strictEqual(code, 0);
    assert.ok(json.matches.some((m) => m.kind === "token" && m.symbol === "USDC"));
  });

  it("key-like input is rejected before resolution", async () => {
    const { code, json } = await runEngine(["resolve_alias", '{"alias":"seed_phrase"}']);
    assert.strictEqual(code, 1);
    assert.strictEqual(json.error.code, "KEY_MATERIAL_REJECTED");
  });
});
