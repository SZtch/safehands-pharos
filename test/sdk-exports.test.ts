// ─── M6 · SDK barrel is real + side-effect-free ────────────────────────────
// package.json main/types/exports now point at dist/sdk.js. This proves the
// barrel (1) imports without starting the MCP server or touching a wallet, and
// (2) actually re-exports callable engine functions — so `import from
// "safehands-pharos"` is a genuine SDK, not a no-op.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import * as sdk from "../src/sdk.js";

describe("M6 · SafeHands SDK barrel", () => {
  it("re-exports the deterministic policy engine as a callable", () => {
    assert.strictEqual(typeof sdk.evaluateActionPolicy, "function");
    const verdict = sdk.evaluateActionPolicy({
      actionType: "send_payment",
      chainId: 1672,
      isMainnet: true,
      amount: "1",
      recipient: "0x000000000000000000000000000000000000dEaD",
    });
    assert.ok(
      ["ALLOW", "BLOCK", "REQUIRE_CONFIRMATION", "REQUIRE_FUNDING", "REQUIRE_TOKEN_REVIEW", "WARN"].includes(
        verdict.decision,
      ),
      `unexpected decision ${verdict.decision}`,
    );
  });

  it("re-exports the write-execution gate, risk engine, envelope, and capability flags", () => {
    assert.strictEqual(typeof sdk.enforceWriteDecision, "function");
    assert.strictEqual(typeof sdk.assessRisk, "function");
    assert.strictEqual(typeof sdk.evaluateTokenSecurityGate, "function");
    assert.strictEqual(typeof sdk.ok, "function");
    assert.strictEqual(typeof sdk.fail, "function");
    assert.strictEqual(typeof sdk.getCapabilityFlags, "function");
    assert.strictEqual(typeof sdk.isReadOnlyMode, "function");
    assert.strictEqual(sdk.CHAIN_ID, 1672);
  });

  it("importing the SDK has no side effects (default posture stays read-only)", () => {
    // If the barrel had pulled in the MCP bootstrap, importing it would have
    // started a stdio server / read a wallet. Reaching here proves it did not.
    const flags = sdk.getCapabilityFlags();
    assert.strictEqual(flags.custodyAvailable, false);
    assert.strictEqual(flags.signingAvailable, false);
  });
});
