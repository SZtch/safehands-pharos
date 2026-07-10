// ─── Canonical ecosystem registry — schema + cross-layer consistency ─────
// The registry (src/data/ecosystemRegistry.data.ts) is the single source of
// truth for bundled ecosystem knowledge. These tests enforce:
//   • the fail-closed schema rules (validateEcosystemRegistry), including that
//     a weakened entry (allow_eligible without proof) fails CI;
//   • the TS constants that are NOT derived from the registry (token registry,
//     SafeHands address resolvers) stay byte-consistent with it;
//   • name lookups can never surface allow-power without an address match.
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ECOSYSTEM_REGISTRY,
  getRegistryItem,
  lookupRegistryByAddress,
  lookupRegistryByName,
  validateEcosystemRegistry,
  type EcosystemItem,
} from "../src/lib/ecosystemRegistry.js";
import {
  ATLANTIC_CANONICAL_CONTRACTS,
  PACIFIC_CANONICAL_CONTRACTS,
  PACIFIC_MAINNET_TOKEN_REGISTRY,
  resolveSafeHandsAttestationAddress,
  resolveSafeHandsRegistryAddress,
} from "../src/lib/constants.js";
import { PACIFIC_MAINNET_PRICE_FEEDS } from "../src/lib/price/feedRegistry.js";

describe("registry schema (fail-closed rules)", () => {
  it("the bundled registry passes validation", () => {
    assert.deepStrictEqual(validateEcosystemRegistry(), []);
  });

  it("rejects allow_eligible without VERIFIED status, contracts, and citations", () => {
    const weakened: EcosystemItem = {
      id: "protocol:test:name-only",
      name: "Name-Only Protocol",
      aliases: ["nameonly"],
      category: "protocol",
      chainId: 1672,
      ecosystemStatus: "KNOWN_ECOSYSTEM",
      verificationStatus: "UNVERIFIED",
      evidenceSources: [],
      contracts: [],
      providers: [],
      safetyUse: "allow_eligible",
      notes: "",
    };
    const errors = validateEcosystemRegistry([weakened]);
    assert.ok(errors.length >= 3, `expected multiple violations, got: ${JSON.stringify(errors)}`);
    assert.ok(errors.some((e) => e.includes("name alone must never produce ALLOW")));
  });

  it("rejects an invented provider endpoint that is not https", () => {
    const item: EcosystemItem = {
      id: "provider:test:http",
      name: "Insecure Provider",
      aliases: [],
      category: "provider",
      chainId: 1672,
      ecosystemStatus: "KNOWN_ECOSYSTEM",
      verificationStatus: "UNVERIFIED",
      evidenceSources: [],
      contracts: [],
      providers: [{ kind: "json_api", endpoint: "http://example.com", configVia: null, status: "implemented" }],
      safetyUse: "recognition_only",
      notes: "",
    };
    assert.ok(validateEcosystemRegistry([item]).some((e) => e.includes("https")));
  });

  it("every allow_eligible item in the bundled registry cites evidence", () => {
    for (const item of ECOSYSTEM_REGISTRY) {
      if (item.safetyUse !== "allow_eligible") continue;
      assert.ok(item.evidenceSources.length > 0, `${item.id} must cite evidence`);
      assert.strictEqual(item.verificationStatus, "VERIFIED", `${item.id} must be VERIFIED`);
      assert.ok(item.contracts.length > 0, `${item.id} must carry verified addresses`);
    }
  });

  it("every NOT_CONFIGURED provider item has only null endpoints (never invented)", () => {
    for (const item of ECOSYSTEM_REGISTRY) {
      if (item.ecosystemStatus !== "NOT_CONFIGURED") continue;
      assert.ok(item.providers.length > 0, `${item.id} must declare its providers`);
      for (const p of item.providers) {
        assert.strictEqual(p.endpoint, null, `${item.id} must not invent an endpoint`);
        assert.strictEqual(p.status, "not_configured");
      }
    }
  });
});

describe("cross-layer consistency (registry ↔ TS constants)", () => {
  it("Pacific canonical contract set has exactly 14 entries (derived from the registry)", () => {
    assert.strictEqual(PACIFIC_CANONICAL_CONTRACTS.length, 14);
    assert.strictEqual(new Set(PACIFIC_CANONICAL_CONTRACTS).size, 14);
  });

  it("Atlantic canonical contract set has exactly 25 entries (derived from the registry)", () => {
    assert.strictEqual(ATLANTIC_CANONICAL_CONTRACTS.length, 25);
  });

  it("Pacific token registry constants match the registry token items", () => {
    for (const token of Object.values(PACIFIC_MAINNET_TOKEN_REGISTRY)) {
      const hit = lookupRegistryByAddress(token.address);
      assert.ok(hit, `registry is missing canonical token ${token.symbol} (${token.address})`);
      assert.strictEqual(hit.item.category, "token");
      assert.strictEqual(hit.item.safetyUse, "allow_eligible");
      assert.strictEqual(hit.contract.symbol, token.symbol);
      assert.strictEqual(hit.contract.decimals, token.decimals);
    }
  });

  it("price feed registry matches the registry oracle item (10 feeds)", () => {
    const oracle = getRegistryItem("oracle:pacific-mainnet:chainlink-push-feeds");
    assert.ok(oracle);
    assert.strictEqual(Object.keys(PACIFIC_MAINNET_PRICE_FEEDS).length, 10);
    for (const feed of oracle.contracts) {
      assert.ok(feed.symbol);
      const config = PACIFIC_MAINNET_PRICE_FEEDS[feed.symbol];
      assert.ok(config, `feedRegistry is missing ${feed.symbol}`);
      assert.strictEqual(config.feedAddress.toLowerCase(), feed.address.toLowerCase());
      assert.strictEqual(config.pair, feed.pair);
    }
  });

  it("SafeHands contract addresses match the chain-guarded resolvers", () => {
    const safehands = getRegistryItem("infrastructure:pacific-mainnet:safehands-contracts");
    assert.ok(safehands);
    const registry = safehands.contracts.find((c) => c.role === "registry");
    const attestation = safehands.contracts.find((c) => c.role === "attestation");
    assert.strictEqual(resolveSafeHandsRegistryAddress(1672).toLowerCase(), registry?.address.toLowerCase());
    assert.strictEqual(resolveSafeHandsAttestationAddress(1672).toLowerCase(), attestation?.address.toLowerCase());
  });
});

describe("name lookups never carry allow-power", () => {
  it("known-but-unverified protocols resolve by name with escalate_only", () => {
    for (const name of ["stargate", "faroswap", "stpros-premint"]) {
      const item = lookupRegistryByName(name);
      assert.ok(item, `expected KNOWN_ECOSYSTEM item for "${name}"`);
      assert.strictEqual(item.ecosystemStatus, "KNOWN_ECOSYSTEM");
      assert.notStrictEqual(item.safetyUse, "allow_eligible");
      assert.strictEqual(item.contracts.length, 0, "no addresses may be invented for unverified protocols");
    }
  });

  it("an unknown name resolves to nothing (UNKNOWN is honest)", () => {
    assert.strictEqual(lookupRegistryByName("definitely-not-a-pharos-protocol"), undefined);
  });
});
