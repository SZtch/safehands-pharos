// ─── GoPlus token-security fails CLOSED on schema drift ──────────────
// GoPlus's Pharos (chain 1672) support is new and its schema still maturing. If a
// field is renamed or retyped, the old `=== "1"` checks would read every flag false
// → riskScore 0 → safetyScore 100 → an effective ALLOW on data never assessed. The
// pure parser interpretGoplusTokenResult must return null (→ caller fails closed)
// whenever the honeypot decision field is unreadable, while STILL catching honeypots
// encoded as either the documented string "1" or a drifted numeric 1. This is a
// hermetic unit test of the parser — no network, no SSRF coupling.
import { describe, it } from "node:test";
import assert from "node:assert";
import { handleCheckTokenSecurity, interpretGoplusTokenResult } from "../src/tools/checkTokenSecurity.js";

describe("interpretGoplusTokenResult (fail-closed on GoPlus schema drift)", () => {
  it("parses a clean token as safe (honeypot false, zero tax)", () => {
    const p = interpretGoplusTokenResult({ is_honeypot: "0", buy_tax: "0", sell_tax: "0" });
    assert.ok(p, "clean token should parse");
    assert.strictEqual(p.isHoneypot, false);
    assert.strictEqual(p.buyTaxPercent, 0);
    assert.strictEqual(p.sellTaxPercent, 0);
  });

  it('catches a honeypot encoded as the documented string "1"', () => {
    const p = interpretGoplusTokenResult({ is_honeypot: "1" });
    assert.ok(p);
    assert.strictEqual(p.isHoneypot, true);
  });

  it("catches a honeypot even if GoPlus RETYPES the flag to a number (1)", () => {
    const p = interpretGoplusTokenResult({ is_honeypot: 1 });
    assert.ok(p);
    assert.strictEqual(p.isHoneypot, true);
  });

  it("parses tax percentages from decimal strings", () => {
    const p = interpretGoplusTokenResult({ is_honeypot: "0", buy_tax: "0.15", sell_tax: "0.30" });
    assert.ok(p);
    assert.strictEqual(Math.round(p.buyTaxPercent), 15);
    assert.strictEqual(Math.round(p.sellTaxPercent), 30);
  });

  it("FAILS CLOSED (null) when the honeypot field is absent (schema rename)", () => {
    // GoPlus renamed is_honeypot → honeypot: the pre-fix code would have scored this 100/safe.
    assert.strictEqual(interpretGoplusTokenResult({ honeypot: "1", buy_tax: "0", sell_tax: "0" }), null);
  });

  it("FAILS CLOSED (null) when the honeypot field is an unrecognized type", () => {
    assert.strictEqual(interpretGoplusTokenResult({ is_honeypot: "yes" }), null);
    assert.strictEqual(interpretGoplusTokenResult({ is_honeypot: null }), null);
    assert.strictEqual(interpretGoplusTokenResult({ is_honeypot: {} }), null);
  });

  it("FAILS CLOSED (null) on a missing / non-object / empty result", () => {
    assert.strictEqual(interpretGoplusTokenResult(null), null);
    assert.strictEqual(interpretGoplusTokenResult(undefined), null);
    assert.strictEqual(interpretGoplusTokenResult("nope"), null);
    assert.strictEqual(interpretGoplusTokenResult({}), null);
  });

  it("exposes tokenName/tokenSymbol as display-only metadata (trimmed, length-capped)", () => {
    const p = interpretGoplusTokenResult({
      is_honeypot: "0",
      token_name: "  Pharos Token  ",
      token_symbol: "PHRS",
    });
    assert.ok(p);
    assert.strictEqual(p.tokenName, "Pharos Token");
    assert.strictEqual(p.tokenSymbol, "PHRS");

    const long = interpretGoplusTokenResult({ is_honeypot: "0", token_name: "x".repeat(500) });
    assert.ok(long);
    assert.strictEqual(long.tokenName?.length, 128);
  });

  it("still parses when name/symbol are absent, empty, or non-string (metadata never fails closed)", () => {
    for (const details of [
      { is_honeypot: "0" },
      { is_honeypot: "0", token_name: "", token_symbol: "   " },
      { is_honeypot: "0", token_name: 42, token_symbol: {} },
    ]) {
      const p = interpretGoplusTokenResult(details);
      assert.ok(p, "valid honeypot signal must parse regardless of metadata shape");
      assert.strictEqual(p.tokenName, undefined);
      assert.strictEqual(p.tokenSymbol, undefined);
    }
  });

  it("FAILS CLOSED (null) even when token identity metadata is present but honeypot signal is missing", () => {
    assert.strictEqual(
      interpretGoplusTokenResult({ token_name: "Legit Coin", token_symbol: "LGT", buy_tax: "0" }),
      null
    );
  });
});

// ─── Handler-level: successful response exposes identity; schema drift still fails closed ───
describe("check_token_security handler · tokenName/tokenSymbol pass-through (hermetic, mocked fetch)", () => {
  const ADDRESS = "0x000000000000000000000000000000000000dead";

  // GoPlus calls go through the SSRF-safe layer; only its loopback bypass
  // (ALLOW_LOCAL_X402_FETCH + loopback host) routes through global fetch, so pin
  // GOPLUS_API_BASE to loopback and enable the bypass (snapshot + restore — CI
  // exports ALLOW_LOCAL_X402_FETCH job-wide, never rely on ambient env).
  const PINNED_ENV: Record<string, string> = {
    GOPLUS_API_BASE: "http://127.0.0.1:19999",
    ALLOW_LOCAL_X402_FETCH: "true",
    NODE_ENV: "test",
  };

  async function withMockedGoplus<T>(payload: unknown, fn: () => Promise<T>): Promise<T> {
    const realFetch = globalThis.fetch;
    const savedEnv: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(PINNED_ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
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

  it("successful GoPlus response exposes tokenName/tokenSymbol", async () => {
    const res = await withMockedGoplus(
      {
        code: 1,
        result: {
          [ADDRESS]: { is_honeypot: "0", buy_tax: "0", sell_tax: "0", token_name: "Dead Token", token_symbol: "DEAD" },
        },
      },
      () => handleCheckTokenSecurity({ tokenAddress: ADDRESS })
    );
    assert.strictEqual(res.success, true);
    const data = res.data as { tokenName?: string; tokenSymbol?: string; securityProfile: { isHoneypot: boolean } };
    assert.strictEqual(data.tokenName, "Dead Token");
    assert.strictEqual(data.tokenSymbol, "DEAD");
    assert.strictEqual(data.securityProfile.isHoneypot, false);
  });

  it("schema drift (honeypot missing) STILL fails closed even with token identity present", async () => {
    const res = await withMockedGoplus(
      {
        code: 1,
        result: { [ADDRESS]: { token_name: "Legit Coin", token_symbol: "LGT", buy_tax: "0" } },
      },
      () => handleCheckTokenSecurity({ tokenAddress: ADDRESS })
    );
    assert.strictEqual(res.success, false);
    assert.ok(!res.success && res.error.code === "TOKEN_SECURITY_DATA_UNAVAILABLE");
  });
});
