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
