// ─── SafeHands deterministic policy suite (no network) ─────────────────────
// Pure policy-engine + production-posture assertions. Runs offline and gates
// merges. The live-RPC checks moved to test/live-smoke.test.ts (npm run test:live).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { getActiveNetwork } from "../src/lib/networks.js";
import { isExecutionAvailable } from "../src/lib/config.js";
import { evaluateActionPolicy } from "../src/lib/policy/actionPolicyEngine.js";
import { evaluateProductionPosture } from "../src/lib/productionGuards.js";

// Mainnet context passed explicitly via the (single) input object. NOTE: the
// engine signature is evaluateActionPolicy(input) — one arg, synchronous. A
// prior version called it with 4 positional args + await; those were silently
// discarded (test/ was not type-checked), so the mainnet context was never
// actually applied. Fixed here + enforced by npm run typecheck:test.
const MAINNET = { environment: "pacific-mainnet", chainId: 1672, isMainnet: true } as const;

describe("SafeHands Deterministic Policy Suite", () => {
  before(() => {
    assert.strictEqual(getActiveNetwork().name, "pacific-mainnet", "Tests must run against pacific-mainnet");
  });

  it("should have execution mode disabled by default without env flags", () => {
    assert.strictEqual(isExecutionAvailable(), false);
  });

  describe("T-5: REQUIRE_FUNDING & REQUIRE_TOKEN_REVIEW mappings (Audit Fix)", () => {
    const TEST_WALLET = "0x000000000000000000000000000000000000dEaD";

    it("should trigger REQUIRE_FUNDING when wallet balance is insufficient", () => {
      // Amount within the payment limit but above the (zero) balance, so the ONLY
      // failing check is funding — which must remap to REQUIRE_FUNDING (fundable),
      // not BLOCK. (An over-limit amount is a hard BLOCK and must not be masked.)
      const verdict = evaluateActionPolicy({
        ...MAINNET,
        actionType: "send_payment",
        amount: "0.5",
        tokenOut: "PROS",
        recipient: TEST_WALLET,
        recipientVerified: true,
        tokenRegistryStatus: "VERIFIED",
        tokenSecurityStatus: "ok",
        walletBalancePhs: "0", // Insufficient balance
      });
      assert.strictEqual(verdict.decision, "REQUIRE_FUNDING");
      const fundingCheck = verdict.checks?.find((c) => c.name === "funding_balance");
      assert.ok(fundingCheck, "funding_balance check should exist");
      assert.strictEqual(fundingCheck.status, "fail");
    });

    it("should trigger REQUIRE_TOKEN_REVIEW when token security status is unknown", () => {
      const verdict = evaluateActionPolicy({
        ...MAINNET,
        actionType: "send_payment",
        amount: "1",
        tokenOut: "PROS",
        recipient: TEST_WALLET,
        recipientVerified: true,
        tokenRegistryStatus: "VERIFIED",
        tokenSecurityStatus: "unknown",
        walletBalancePhs: "10",
      });
      assert.strictEqual(verdict.decision, "REQUIRE_TOKEN_REVIEW");
      const tokenCheck = verdict.checks?.find((c) => c.name === "token_security_provider");
      assert.ok(tokenCheck, "token_security_provider check should exist");
      assert.strictEqual(tokenCheck.status, "unknown");
    });
  });

  describe("Recipient denylist (operator-configurable)", () => {
    const BAD = "0x4444444444444444444444444444444444444444";
    const baseInput = {
      ...MAINNET,
      actionType: "send_payment" as const,
      amount: "0.001",
      tokenOut: "PROS",
      recipientVerified: true,
      tokenRegistryStatus: "VERIFIED",
      tokenSecurityStatus: "ok" as const,
      walletBalancePhs: "10",
    };

    it("should BLOCK a payment to an operator-denylisted recipient", () => {
      process.env.SAFEHANDS_RECIPIENT_DENYLIST = BAD;
      try {
        const verdict = evaluateActionPolicy({ ...baseInput, recipient: BAD });
        assert.strictEqual(verdict.decision, "BLOCK");
        const check = verdict.checks?.find((c) => c.name === "recipient_denylist");
        assert.ok(check, "recipient_denylist check should exist");
        assert.strictEqual(check.status, "fail");
      } finally {
        delete process.env.SAFEHANDS_RECIPIENT_DENYLIST;
      }
    });

    it("should NOT block a recipient when the denylist is empty (no fabricated list)", () => {
      delete process.env.SAFEHANDS_RECIPIENT_DENYLIST;
      const verdict = evaluateActionPolicy({ ...baseInput, recipient: BAD });
      assert.notStrictEqual(verdict.decision, "BLOCK");
    });
  });

  describe("Production posture guard", () => {
    const base = {
      NODE_ENV: "production",
      SAFEHANDS_STATE_DIR: "/data",
      SAFEHANDS_CORS_ORIGIN: "https://app.example",
    } as NodeJS.ProcessEnv;

    it("fails fast on managed execution on a public host", () => {
      const issues = evaluateProductionPosture({ ...base, WALLET_MODE: "managed-mainnet", WRITE_TOOLS_ENABLED: "true" });
      const fatal = issues.find((i) => i.code === "MANAGED_EXECUTION_ON_PUBLIC");
      assert.ok(fatal, "should flag managed execution on public host");
      assert.strictEqual(fatal!.level, "fatal");
    });

    it("allows managed execution with an explicit override", () => {
      const issues = evaluateProductionPosture({ ...base, WALLET_MODE: "managed-mainnet", WRITE_TOOLS_ENABLED: "true", SAFEHANDS_ALLOW_MANAGED_ON_PUBLIC: "true" });
      assert.ok(!issues.some((i) => i.level === "fatal"));
    });

    it("passes clean for the zero-custody profile", () => {
      const issues = evaluateProductionPosture({ ...base, WALLET_MODE: "none", WRITE_TOOLS_ENABLED: "false" });
      assert.ok(!issues.some((i) => i.level === "fatal"));
    });

    it("fails fast on a local x402 facilitator key in production", () => {
      const issues = evaluateProductionPosture({ ...base, WALLET_MODE: "none", X402_FACILITATOR_PRIVATE_KEY: "0x" + "11".repeat(32) });
      const fatal = issues.find((i) => i.code === "LOCAL_FACILITATOR_KEY_IN_PRODUCTION");
      assert.ok(fatal, "should flag a local facilitator key in production");
      assert.strictEqual(fatal!.level, "fatal");
    });

    it("allows a local facilitator key with the explicit override", () => {
      const issues = evaluateProductionPosture({ ...base, WALLET_MODE: "none", X402_FACILITATOR_PRIVATE_KEY: "0x" + "11".repeat(32), SAFEHANDS_ALLOW_LOCAL_FACILITATOR: "true" });
      assert.ok(!issues.some((i) => i.level === "fatal"));
    });

    it("warns on an ephemeral state dir in production", () => {
      const issues = evaluateProductionPosture({ NODE_ENV: "production", WALLET_MODE: "none", SAFEHANDS_CORS_ORIGIN: "https://app.example" } as NodeJS.ProcessEnv);
      assert.ok(issues.some((i) => i.code === "EPHEMERAL_STATE_DIR"));
    });

    it("returns no issues outside production", () => {
      const issues = evaluateProductionPosture({ NODE_ENV: "development", WALLET_MODE: "managed-mainnet", WRITE_TOOLS_ENABLED: "true" } as NodeJS.ProcessEnv);
      assert.strictEqual(issues.length, 0);
    });
  });
});
