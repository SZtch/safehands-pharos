// ─── B1 / M1 · Execution-path hardening ────────────────────────────────────
// B1: the write-execution gate must halt on ANY non-ALLOW decision — not just
//     BLOCK — so a REQUIRE_CONFIRMATION action never auto-signs without an
//     explicit confirm. M1: safehands_safe_execute must honor the documented
//     SAFE_EXECUTE_ENABLED gate. All hermetic (no network, no signer).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateActionPolicy } from "../src/lib/policy/actionPolicyEngine.js";
import { enforceWriteDecision } from "../src/lib/policy/writeExecutionGate.js";
import { estimateUsd, resolvePriceableToken } from "../src/lib/spendAccumulator.js";
import { handleSafeHandsSafeExecute } from "../src/tools/safehandsSafeExecute.js";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const MAINNET = { chainId: 1672, isMainnet: true } as const;

describe("B1 · write-execution gate honors the full decision", () => {
  it("ALLOW → proceeds (null)", () => {
    const allow = evaluateActionPolicy({
      ...MAINNET,
      actionType: "send_payment",
      amount: "0.01",
      recipient: DEAD,
      recipientVerified: true,
    });
    assert.strictEqual(allow.decision, "ALLOW");
    assert.strictEqual(enforceWriteDecision(allow, { confirmed: false, toolName: "send_payment" }), null);
  });

  it("REQUIRE_CONFIRMATION (unverified recipient) → blocks without confirm, proceeds with confirm", () => {
    const confirm = evaluateActionPolicy({
      ...MAINNET,
      actionType: "send_payment",
      amount: "0.01",
      recipient: DEAD,
      recipientVerified: false,
    });
    assert.strictEqual(confirm.decision, "REQUIRE_CONFIRMATION");

    const unconfirmed = enforceWriteDecision(confirm, { confirmed: false, toolName: "send_payment" });
    assert.strictEqual(unconfirmed!.error.code, "CONFIRMATION_REQUIRED");

    assert.strictEqual(enforceWriteDecision(confirm, { confirmed: true, toolName: "send_payment" }), null);
  });

  it("BLOCK (unsupported chain) → hard stop, never confirmable", () => {
    const block = evaluateActionPolicy({
      chainId: 1,
      isMainnet: false,
      actionType: "send_payment",
      amount: "0.01",
      recipient: DEAD,
    });
    assert.strictEqual(block.decision, "BLOCK");
    assert.strictEqual(enforceWriteDecision(block, { confirmed: true, toolName: "send_payment" })!.error.code, "POLICY_BLOCKED");
  });

  it("REQUIRE_FUNDING → hard stop even when confirmed (funding is not a confirmable risk)", () => {
    const funding = evaluateActionPolicy({
      ...MAINNET,
      actionType: "send_payment",
      amount: "0.01",
      recipient: DEAD,
      recipientVerified: true,
      walletBalancePhs: "0",
    });
    assert.strictEqual(funding.decision, "REQUIRE_FUNDING");
    assert.strictEqual(enforceWriteDecision(funding, { confirmed: true, toolName: "send_payment" })!.error.code, "REQUIRE_FUNDING");
  });
});

describe("P0-2 · missing token intel is never caller-confirmable", () => {
  const SWAP = {
    ...MAINNET,
    actionType: "execute_swap" as const,
    amount: "0.01",
    tokenIn: "PROS",
    tokenOut: "0x1234000000000000000000000000000000005678",
    signerAvailable: true,
    requiresSigner: true,
  };

  it("reviewed-and-flagged intel (unknown) stays confirmable after review", () => {
    const p = evaluateActionPolicy({ ...SWAP, tokenSecurityStatus: "unknown" });
    assert.strictEqual(p.decision, "REQUIRE_TOKEN_REVIEW");
    assert.strictEqual(enforceWriteDecision(p, { confirmed: false, toolName: "execute_swap" })!.error.code, "CONFIRMATION_REQUIRED");
    assert.strictEqual(enforceWriteDecision(p, { confirmed: true, toolName: "execute_swap" }), null);
  });

  it("missing intel (unavailable) hard-stops even with confirm=true", () => {
    const p = evaluateActionPolicy({ ...SWAP, tokenSecurityStatus: "unavailable" });
    assert.strictEqual(p.decision, "REQUIRE_TOKEN_REVIEW");
    assert.ok(p.checks.some((c) => c.name === "token_security_intel_missing" && c.status === "unknown"), "distinct intel-missing check must be emitted");
    assert.strictEqual(enforceWriteDecision(p, { confirmed: true, toolName: "execute_swap" })!.error.code, "TOKEN_INTEL_UNAVAILABLE");
    assert.strictEqual(enforceWriteDecision(p, { confirmed: false, toolName: "execute_swap" })!.error.code, "TOKEN_INTEL_UNAVAILABLE");
  });
});

describe("P0-3 · unpriceable-token swaps are denied by default", () => {
  it("unpriceable tokenIn → BLOCK, never confirmable", () => {
    const p = evaluateActionPolicy({
      ...MAINNET,
      actionType: "execute_swap",
      amount: "5",
      tokenIn: "SCAMCOIN",
      tokenOut: "USDC",
      tokenSecurityStatus: "ok",
      signerAvailable: true,
      requiresSigner: true,
    });
    assert.strictEqual(p.decision, "BLOCK");
    assert.ok(p.checks.some((c) => c.name === "swap_notional_unpriceable" && c.status === "fail"), "unpriceable-notional check must fail");
    assert.strictEqual(enforceWriteDecision(p, { confirmed: true, toolName: "execute_swap" })!.error.code, "POLICY_BLOCKED");
  });

  it("priceable tokens (incl. WPROS) count toward the USD caps; unknown tokens resolve null", () => {
    assert.strictEqual(resolvePriceableToken("WPROS"), "WPROS");
    assert.strictEqual(resolvePriceableToken("usdc"), "USDC");
    assert.strictEqual(resolvePriceableToken("SCAMCOIN"), null);
    assert.ok(estimateUsd("5", "WPROS") > 0, "WPROS must be priced (like PROS), not silently uncounted");
    assert.strictEqual(estimateUsd("5", "USDC"), 5);
  });
});

describe("M1 · SAFE_EXECUTE_ENABLED is enforced (not decorative)", () => {
  it("safe_execute is disabled with WRITE_TOOLS_ENABLED=true but SAFE_EXECUTE_ENABLED unset", async () => {
    const savedWrite = process.env.WRITE_TOOLS_ENABLED;
    const savedSafe = process.env.SAFE_EXECUTE_ENABLED;
    process.env.WRITE_TOOLS_ENABLED = "true";
    delete process.env.SAFE_EXECUTE_ENABLED;
    try {
      const res = await handleSafeHandsSafeExecute({
        path: "safe_execute_send_payment",
        action: { toAddress: DEAD, amount: "0.01" },
      });
      assert.strictEqual(res.success, false);
      if (!res.success) assert.strictEqual(res.error.code, "SAFE_EXECUTE_DISABLED");
    } finally {
      if (savedWrite === undefined) delete process.env.WRITE_TOOLS_ENABLED;
      else process.env.WRITE_TOOLS_ENABLED = savedWrite;
      if (savedSafe === undefined) delete process.env.SAFE_EXECUTE_ENABLED;
      else process.env.SAFE_EXECUTE_ENABLED = savedSafe;
    }
  });
});
