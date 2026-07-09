// ─── Pharos ecosystem registry — evidence & fail-closed status ─────────────
// The registry is awareness-only data (no RPC, no keys). These tests lock:
//   • verified official addresses map to STRUCTURED evidence on the right network
//   • the Atlantic Chainlink cache is NOT indexed as a mainnet address (Change 1)
//   • unverified aggregators (LI.FI/Jumper) stay `to_verify` — never claimed integrated
//   • roadmap bridges (CCIP/CCTP/LayerZero) stay `roadmap` from official docs
//   • no `implemented` entry lacks its evidence (no fake confidence)
// Pure + deterministic: no chain, no network, no key.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ECOSYSTEM_PROVIDERS,
  lookupEcosystemByAddress,
  lookupEcosystemByName,
  ecosystemRegistrySummary,
} from "../src/lib/pharos/ecosystem.js";

const PACIFIC_CHAINLINK_CACHE = "0xc71f7d98d3d9a000Fdfe307fBdb9d94AbD56424B";
const ATLANTIC_CHAINLINK_CACHE = "0x5456fD07A1622d33969f833d52aA5AD2c68C3Fa2";

describe("Pharos ecosystem registry — evidence & fail-closed status", () => {
  it("a verified official address maps to structured evidence on Pacific mainnet", () => {
    const hit = lookupEcosystemByAddress(PACIFIC_CHAINLINK_CACHE);
    assert.ok(hit, "expected a registry hit for the Pacific Chainlink cache");
    assert.strictEqual(hit!.network, "pacific-mainnet");
    assert.strictEqual(hit!.chainId, 1672);
    // Structured evidence, not a bare boolean.
    assert.strictEqual(hit!.entry.source, "official_docs");
    assert.strictEqual(hit!.entry.category, "oracle");
    assert.ok(hit!.entry.officialDocsUrl && hit!.entry.officialDocsUrl.length > 0);
    assert.ok(hit!.entry.riskRelevance.length > 0);
    assert.ok(hit!.entry.safehandsBehavior.length > 0);
  });

  it("the Atlantic Chainlink cache is indexed on atlantic-testnet, not mainnet (Change 1 lock)", () => {
    const hit = lookupEcosystemByAddress(ATLANTIC_CHAINLINK_CACHE);
    assert.ok(hit, "expected a registry hit for the Atlantic Chainlink cache");
    assert.strictEqual(hit!.network, "atlantic-testnet");
    assert.strictEqual(hit!.chainId, 688689);
  });

  it("address lookup is case-insensitive", () => {
    assert.ok(lookupEcosystemByAddress(PACIFIC_CHAINLINK_CACHE.toLowerCase()));
  });

  it("unknown address → undefined (no false positive)", () => {
    assert.strictEqual(lookupEcosystemByAddress("0x0000000000000000000000000000000000000abc"), undefined);
  });

  it("unverified aggregators (LI.FI / Jumper) stay `to_verify` — never claimed integrated", () => {
    for (const name of ["lifi", "li.fi", "jumper"]) {
      const entry = lookupEcosystemByName(name);
      assert.ok(entry, `expected an entry for ${name}`);
      assert.strictEqual(entry!.status, "to_verify");
      assert.strictEqual(entry!.source, "to_verify");
      assert.strictEqual(entry!.addresses, undefined, "unverified provider must carry no addresses");
    }
  });

  it("roadmap bridges (CCIP / CCTP / LayerZero) stay `roadmap` from official docs (aware ≠ integrated)", () => {
    for (const name of ["ccip", "cctp", "layerzero"]) {
      const entry = lookupEcosystemByName(name);
      assert.ok(entry, `expected an entry for ${name}`);
      assert.strictEqual(entry!.status, "roadmap");
      assert.strictEqual(entry!.source, "official_docs");
      assert.strictEqual(entry!.category, "cross_chain");
    }
  });

  it("every `implemented` entry carries evidence — no fake confidence", () => {
    for (const e of ECOSYSTEM_PROVIDERS) {
      if (e.status !== "implemented") continue;
      assert.ok(e.officialDocsUrl && e.officialDocsUrl.length > 0, `${e.name} implemented without officialDocsUrl`);
      assert.notStrictEqual(e.source, "to_verify", `${e.name} implemented but source is to_verify`);
      assert.ok(e.safehandsBehavior.length > 0, `${e.name} implemented without safehandsBehavior`);
    }
  });

  it("registry summary reports exactly the four implemented providers", () => {
    const summary = ecosystemRegistrySummary();
    assert.strictEqual(summary.providers, ECOSYSTEM_PROVIDERS.length);
    assert.strictEqual(summary.byStatus.implemented, 4);
  });
});
