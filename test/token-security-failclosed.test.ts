// ─── P0-1 · GoPlus token-security fails CLOSED on schema drift ──────────────
// GoPlus's Pharos (chain 1672) support is new and its schema still maturing. If a
// field is renamed or retyped, the old `=== "1"` checks would read every flag false
// → riskScore 0 → safetyScore 100 → an effective ALLOW on data never assessed. The
// pure parser interpretGoplusTokenResult must return null (→ caller fails closed)
// whenever the honeypot decision field is unreadable, while STILL catching honeypots
// encoded as either the documented string "1" or a drifted numeric 1. This is a
// hermetic unit test of the parser — no network, no SSRF coupling.
import { describe, it } from "node:test";
import assert from "node:assert";
import { interpretGoplusTokenResult } from "../src/tools/checkTokenSecurity.js";

describe("P0-1 · interpretGoplusTokenResult (fail-closed on GoPlus schema drift)", () => {
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
});
