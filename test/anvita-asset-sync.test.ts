// ─── Anvita asset drift check ─────────────────────────────────────────────
// The hosted-skill asset JSONs are GENERATED from the canonical ecosystem
// registry by scripts/sync-anvita-assets.ts. This test regenerates each asset
// in-memory and compares it byte-for-byte with the committed file, so a hand
// edit to either side fails CI instead of silently diverging (audit finding
// F5: three unsynchronized registry copies).
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GENERATED_ASSETS, renderAsset, verifyAnvitaEngineConsistency } from "../scripts/sync-anvita-assets.js";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../anvita/safehands/assets");

describe("anvita/safehands/assets are generated from the canonical registry", () => {
  for (const name of Object.keys(GENERATED_ASSETS)) {
    it(`${name} matches the generator output (run: npm run sync:anvita)`, () => {
      const committed = readFileSync(path.join(ASSETS_DIR, name), "utf8");
      assert.strictEqual(committed, renderAsset(name), `${name} drifted from the canonical registry`);
    });
  }

  it("generated known-pharos.json canonical addresses are lowercase (engine matches by lowercase key)", () => {
    const parsed = JSON.parse(renderAsset("known-pharos.json")) as {
      canonicalContracts: Record<string, string>;
      canonicalTokens: Record<string, string>;
    };
    for (const addr of Object.keys(parsed.canonicalContracts)) {
      assert.strictEqual(addr, addr.toLowerCase());
    }
    for (const addr of Object.values(parsed.canonicalTokens)) {
      assert.strictEqual(addr, addr.toLowerCase());
    }
    assert.strictEqual(Object.keys(parsed.canonicalContracts).length, 21); // 14 infra + 3 Morpho (VERIFIED 2026-07-11) + 4 AquaFlux (VERIFIED 2026-07-12)
    assert.strictEqual(Object.keys(parsed.canonicalTokens).length, 4);
  });

  it("generated supported-protocols.json never invents an endpoint", () => {
    const parsed = JSON.parse(renderAsset("supported-protocols.json")) as {
      providers: Record<string, { endpoint: unknown; providerStatus: string }>;
    };
    for (const [key, provider] of Object.entries(parsed.providers)) {
      assert.strictEqual(provider.endpoint, null, `${key} endpoint must stay null until verified`);
      assert.strictEqual(provider.providerStatus, "not_configured");
    }
  });

  it("engine artifacts are consistent (ABI methods, engine selectors, ENGINE_VERSION == package version)", () => {
    assert.deepStrictEqual(verifyAnvitaEngineConsistency(), []);
  });

  it("the SEL drift-parser still sees the whole selector block (truncation is silent)", () => {
    // The consistency checker regex-reads `const SEL = {...}` up to the FIRST
    // closing brace, so a `};` accidentally introduced inside the block (even in
    // a comment) would silently truncate the parse. Assert the parsed map spans
    // from the original read selectors to the v2.4.0 action selectors.
    const engineSrc = readFileSync(path.join(ASSETS_DIR, "..", "scripts", "safehands-engine.js"), "utf8");
    const selBlock = engineSrc.match(/const SEL = \{([\s\S]*?)\};/);
    assert.ok(selBlock, "SEL block not found in the engine source");
    const parsed = new Map<string, string>();
    for (const m of selBlock[1].matchAll(/(\w+):\s*"(0x[0-9a-fA-F]{8})"/g)) {
      parsed.set(m[1], m[2]);
    }
    for (const name of ["reputationOf", "allowance", "approve", "setApprovalForAll", "multiSend", "execTransaction"]) {
      assert.ok(parsed.has(name), `SEL parser no longer sees "${name}" — the block was truncated or renamed`);
    }
  });
});
