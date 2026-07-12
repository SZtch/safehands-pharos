// ─── token_registry_status · display-only metadata for custom tokens ─────────
// Custom/non-registry tokens may get best-effort tokenName/tokenSymbol from GoPlus
// for DISPLAY ONLY. Invariants under test:
//   • status stays CUSTOM_NON_REGISTRY, verificationStatus stays UNVERIFIED_CUSTOM_TOKEN,
//     top-level symbol stays null (registry symbol only) — metadata never upgrades trust.
//   • metadata carries verified:false, displayOnly:true, and an untrusted-data warning.
//   • missing/unfetchable metadata does not fail the tool — response is byte-identical
//     to the pre-enrichment shape.
//   • registry tokens are never enriched (no GoPlus call at all).
//   • the same is_honeypot-less payload that yields metadata here still makes
//     check_token_security fail closed (fail-closed path untouched).
// Hermetic — globalThis.fetch is mocked and restored. GoPlus calls now go through
// the SSRF-safe layer (src/lib/http.ts), whose DNS-pinned path bypasses global
// fetch; only the loopback bypass (ALLOW_LOCAL_X402_FETCH + loopback host) routes
// through global fetch. So the helper pins GOPLUS_API_BASE to a loopback URL and
// enables the bypass itself (snapshot + restore — CI exports ALLOW_LOCAL_X402_FETCH
// job-wide in .github/workflows/ci.yml, so never rely on ambient env).
import { describe, it } from "node:test";
import assert from "node:assert";
import { handleTokenRegistryStatus } from "../src/tools/tokenRegistryStatus.js";
import { fetchGoplusTokenIdentity, handleCheckTokenSecurity } from "../src/tools/checkTokenSecurity.js";

const CUSTOM = "0x000000000000000000000000000000000000dead";

type MockFetch = () => Promise<Response>;

const PINNED_ENV: Record<string, string> = {
  GOPLUS_API_BASE: "http://127.0.0.1:19999",
  ALLOW_LOCAL_X402_FETCH: "true",
  NODE_ENV: "test",
};

async function withMockedFetch<T>(mock: MockFetch, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const savedEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(PINNED_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = mock as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function goplusResponse(details: unknown): MockFetch {
  return async () =>
    new Response(JSON.stringify({ code: 1, result: { [CUSTOM]: details } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

describe("token_registry_status · display-only metadata for custom tokens", () => {
  it("custom token with metadata STILL returns CUSTOM_NON_REGISTRY / UNVERIFIED_CUSTOM_TOKEN, marked display-only", async () => {
    const res = await withMockedFetch(
      goplusResponse({ token_name: "  Dead Token  ", token_symbol: "DEAD" }),
      () => handleTokenRegistryStatus({ tokenAddress: CUSTOM })
    );
    assert.strictEqual(res.success, true);
    const data = res.data as any;
    // Verification posture is unchanged by metadata:
    assert.strictEqual(data.status, "CUSTOM_NON_REGISTRY");
    assert.strictEqual(data.verificationStatus, "UNVERIFIED_CUSTOM_TOKEN");
    assert.strictEqual(data.symbol, null); // top-level symbol = registry symbol only
    // Metadata is present, trimmed, and explicitly display-only/untrusted:
    assert.strictEqual(data.tokenMetadata.tokenName, "Dead Token");
    assert.strictEqual(data.tokenMetadata.tokenSymbol, "DEAD");
    assert.strictEqual(data.tokenMetadata.source, "goplus_metadata");
    assert.strictEqual(data.tokenMetadata.verified, false);
    assert.strictEqual(data.tokenMetadata.displayOnly, true);
    assert.match(data.tokenMetadata.warning, /display-only/i);
    assert.match(data.tokenMetadata.warning, /does NOT imply the token is safe/);
  });

  it("missing metadata does not fail the tool — response shape identical to pre-enrichment", async () => {
    for (const mock of [
      goplusResponse({}), // GoPlus knows the token but has no name/symbol
      async () => new Response(JSON.stringify({ code: 0, result: {} }), { status: 200 }), // not indexed
      async () => new Response("{}", { status: 404 }), // hard API failure (non-retryable)
    ] as MockFetch[]) {
      const res = await withMockedFetch(mock, () => handleTokenRegistryStatus({ tokenAddress: CUSTOM }));
      assert.strictEqual(res.success, true);
      const data = res.data as any;
      assert.strictEqual(data.status, "CUSTOM_NON_REGISTRY");
      assert.strictEqual(data.verificationStatus, "UNVERIFIED_CUSTOM_TOKEN");
      assert.strictEqual("tokenMetadata" in data, false);
    }
  });

  it("registry tokens are never enriched — no GoPlus call is made", async () => {
    const res = await withMockedFetch(
      async () => {
        throw new Error("token_registry_status must not call the network for registry tokens");
      },
      () => handleTokenRegistryStatus({ token: "USDC" }) // present in both network registries
    );
    assert.strictEqual(res.success, true);
    const data = res.data as any;
    assert.strictEqual(data.symbol, "USDC");
    assert.notStrictEqual(data.status, "CUSTOM_NON_REGISTRY");
    assert.strictEqual("tokenMetadata" in data, false);
  });

  it("metadata caps at 128 chars and drops non-string values", async () => {
    const identity = await withMockedFetch(
      goplusResponse({ token_name: "x".repeat(500), token_symbol: 42 }),
      () => fetchGoplusTokenIdentity(CUSTOM)
    );
    assert.strictEqual(identity.tokenName?.length, 128);
    assert.strictEqual(identity.tokenSymbol, undefined);
  });

  it("the same honeypot-less payload yields display metadata here but check_token_security STILL fails closed", async () => {
    // token_name/token_symbol present, is_honeypot missing — the honeypot-missing case.
    const mock = goplusResponse({ token_name: "Legit Coin", token_symbol: "LGT", buy_tax: "0" });

    const registry = await withMockedFetch(mock, () => handleTokenRegistryStatus({ tokenAddress: CUSTOM }));
    assert.strictEqual(registry.success, true);
    const data = registry.data as any;
    assert.strictEqual(data.verificationStatus, "UNVERIFIED_CUSTOM_TOKEN");
    assert.strictEqual(data.tokenMetadata.tokenName, "Legit Coin");
    assert.strictEqual(data.tokenMetadata.verified, false);

    const security = await withMockedFetch(mock, () => handleCheckTokenSecurity({ tokenAddress: CUSTOM }));
    assert.strictEqual(security.success, false);
    assert.ok(!security.success && security.error.code === "TOKEN_SECURITY_DATA_UNAVAILABLE");
  });
});
