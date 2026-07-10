// ─── Action Policy Engine — deterministic BLOCK matrix ─────────────────────
// The reason a pre-execution firewall exists is its BLOCK paths. These are the
// dangerous-transaction cases that MUST be rejected. Pure + deterministic:
// no chain, no network, no signer. Complements the live-RPC smoke suite.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { evaluateActionPolicy, riskEvidenceFromAssessment } from "../src/lib/policy/actionPolicyEngine.js";
import { enforceWriteDecision } from "../src/lib/policy/writeExecutionGate.js";
import type { RiskAssessment } from "../src/lib/riskEngine.js";

const VALID = "0x1111111111111111111111111111111111111111";

function failed(checkName: string, r: ReturnType<typeof evaluateActionPolicy>) {
  return r.checks.find((c) => c.name === checkName && c.status === "fail");
}

describe("ActionPolicyEngine — dangerous-transaction BLOCK matrix", () => {
  before(() => {
    // Ensure environment-driven guards are in their default (test-neutral) state.
    delete process.env.SAFEHANDS_RECIPIENT_DENYLIST;
    delete process.env.ALLOW_LOCAL_X402_FETCH;
  });
  after(() => {
    delete process.env.SAFEHANDS_RECIPIENT_DENYLIST;
    delete process.env.ALLOW_LOCAL_X402_FETCH;
  });

  it("BLOCKs an unlimited token approval by default", () => {
    const r = evaluateActionPolicy({ actionType: "approve_token", approvalUnlimited: true, spender: VALID });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("approval_amount", r), "approval_amount should fail");
  });

  it("BLOCKs an over-limit approval", () => {
    const r = evaluateActionPolicy({ actionType: "approve_token", approvalAmount: "999999999999", spender: VALID });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("approval_limit", r), "approval_limit should fail");
  });

  it("BLOCKs an over-limit payment", () => {
    const r = evaluateActionPolicy({ actionType: "send_payment", amount: "999999999999", recipient: VALID, recipientVerified: true });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("payment_limit", r), "payment_limit should fail");
  });

  it("BLOCKs an over-limit PROS swap", () => {
    const r = evaluateActionPolicy({ actionType: "execute_swap", amount: "999999999999", tokenIn: "PROS", tokenOut: "USDC" });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("swap_amount_limit", r), "swap_amount_limit should fail");
  });

  it("BLOCKs an SSRF-sensitive x402 URL (cloud metadata endpoint)", () => {
    const r = evaluateActionPolicy({ actionType: "x402_pay_and_fetch", url: "http://169.254.169.254/latest/meta-data/" });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("x402_url", r), "x402_url should fail");
  });

  it("BLOCKs an x402 URL pointing at localhost", () => {
    const r = evaluateActionPolicy({ actionType: "x402_pay_and_fetch", url: "http://localhost:8545/" });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("x402_url", r), "x402_url should fail");
  });

  it("BLOCKs an invalid recipient address", () => {
    const r = evaluateActionPolicy({ actionType: "send_payment", amount: "0.001", recipient: "0xNOTVALID" });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("recipient_address", r), "recipient_address should fail");
  });

  it("BLOCKs an invalid spender address", () => {
    const r = evaluateActionPolicy({ actionType: "approve_token", approvalAmount: "1", spender: "0xNOTVALID" });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("spender_address", r), "spender_address should fail");
  });

  it("BLOCKs an unsupported chain (Ethereum mainnet, chain 1)", () => {
    const r = evaluateActionPolicy({ actionType: "send_payment", amount: "0.001", recipient: VALID, recipientVerified: true, chainId: 1 });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("chain_id", r), "chain_id should fail");
  });

  it("BLOCKs an unsupported x402 payment token", () => {
    const r = evaluateActionPolicy({
      actionType: "x402_pay_and_fetch",
      url: "https://api.example.com/data",
      paymentAmountUsdc: "0.01",
      paymentTokenAddress: "0x000000000000000000000000000000000000dEaD",
    });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("x402_payment_token", r), "x402_payment_token should fail");
  });

  it("BLOCKs a payment to an operator-denylisted recipient", () => {
    process.env.SAFEHANDS_RECIPIENT_DENYLIST = VALID;
    try {
      const r = evaluateActionPolicy({ actionType: "send_payment", amount: "0.001", recipient: VALID });
      assert.strictEqual(r.decision, "BLOCK");
      assert.ok(failed("recipient_denylist", r), "recipient_denylist should fail");
    } finally {
      delete process.env.SAFEHANDS_RECIPIENT_DENYLIST;
    }
  });

  it("does NOT downgrade a hard BLOCK to REQUIRE_FUNDING when also over-limit", () => {
    // Over-limit (hard policy violation) AND underfunded. A recoverable funding
    // signal must not mask the hard BLOCK — funding the wallet would not make an
    // over-limit payment safe.
    const r = evaluateActionPolicy({ actionType: "send_payment", amount: "999999999999", recipient: VALID, recipientVerified: true, walletBalancePhs: "0" });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("payment_limit", r), "payment_limit should fail");
  });

  it("ALLOWs a clean, within-limit, verified payment (happy path)", () => {
    const r = evaluateActionPolicy({
      actionType: "send_payment",
      amount: "0.001",
      recipient: VALID,
      recipientVerified: true,
      walletBalancePhs: "10",
    });
    assert.strictEqual(r.decision, "ALLOW");
    assert.strictEqual(r.safeToExecute, true);
    assert.ok(!r.checks.some((c) => c.status === "fail"), "no check should fail on the happy path");
  });
});

// ─── Risk evidence checks — the policy engine is the SOLE decider ───────────
// The riskEngine no longer gates execution anywhere; its output enters here as
// evidence and these checks reproduce the former direct tool gates exactly
// (never-weaken): score > threshold → BLOCK, critical counterparty → BLOCK,
// degraded → REQUIRE_CONFIRMATION (confirmable).
describe("ActionPolicyEngine — risk evidence checks (sole decider)", () => {
  // A payment input that is ALLOW on its own, so any non-ALLOW outcome below is
  // attributable to the risk evidence.
  const CLEAN_PAYMENT = {
    actionType: "send_payment" as const,
    amount: "0.001",
    recipient: VALID,
    recipientVerified: true,
    walletBalancePhs: "10",
  };

  it("BLOCKs on a risk score above the block threshold — never confirmable", () => {
    const r = evaluateActionPolicy({ ...CLEAN_PAYMENT, risk: { score: 90, degraded: false } });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("risk_score", r), "risk_score should fail");
    const gate = enforceWriteDecision(r, { confirmed: true, toolName: "send_payment", requireRiskEvidence: true });
    assert.strictEqual(gate!.error.code, "POLICY_BLOCKED", "a risk-score BLOCK must not be confirmable");
  });

  it("BLOCKs on a critical counterparty even when the weighted score is low", () => {
    const r = evaluateActionPolicy({ ...CLEAN_PAYMENT, risk: { score: 20, degraded: false, counterpartyRisk: 95 } });
    assert.strictEqual(r.decision, "BLOCK");
    assert.ok(failed("risk_counterparty", r), "risk_counterparty should fail");
  });

  it("BLOCKs when degraded AND over-threshold coincide (fail beats unknown)", () => {
    const r = evaluateActionPolicy({ ...CLEAN_PAYMENT, risk: { score: 85, degraded: true, degradedReasons: ["Balance could not be verified."] } });
    assert.strictEqual(r.decision, "BLOCK");
  });

  it("REQUIREs CONFIRMATION on degraded risk data — and confirm=true satisfies it", () => {
    const r = evaluateActionPolicy({
      ...CLEAN_PAYMENT,
      risk: { score: 20, degraded: true, degradedReasons: ["Wallet balance could not be verified — RPC unavailable."] },
    });
    assert.strictEqual(r.decision, "REQUIRE_CONFIRMATION");
    const check = r.checks.find((c) => c.name === "risk_degraded");
    assert.strictEqual(check?.status, "unknown");
    assert.ok(r.reasons.some((m) => m.includes("degraded")), "degradation detail must surface in reasons");

    const unconfirmed = enforceWriteDecision(r, { confirmed: false, toolName: "send_payment", requireRiskEvidence: true });
    assert.strictEqual(unconfirmed!.error.code, "CONFIRMATION_REQUIRED");
    const confirmed = enforceWriteDecision(r, { confirmed: true, toolName: "send_payment", requireRiskEvidence: true });
    assert.strictEqual(confirmed, null, "degraded risk must be confirmable (parity with the former tool gate)");
  });

  it("mentions the permanent SWAP_LIQUIDITY_NOT_CONFIGURED state in the degraded check", () => {
    const r = evaluateActionPolicy({
      actionType: "execute_swap",
      amount: "0.001",
      tokenIn: "USDC",
      tokenOut: "PROS",
      risk: { score: 45, degraded: true, degradedReasons: ["Route data unavailable."], swapProviderNotConfigured: true },
    });
    const check = r.checks.find((c) => c.name === "risk_degraded");
    assert.ok(check?.message.includes("SWAP_LIQUIDITY_NOT_CONFIGURED"), "permanence must be called out");
  });

  it("still ALLOWs when the risk evidence is clean", () => {
    const r = evaluateActionPolicy({ ...CLEAN_PAYMENT, risk: { score: 12, degraded: false, counterpartyRisk: 10 } });
    assert.strictEqual(r.decision, "ALLOW");
    assert.ok(r.checks.some((c) => c.name === "risk_score" && c.status === "pass"), "risk_score pass must be present");
    assert.strictEqual(enforceWriteDecision(r, { confirmed: false, toolName: "send_payment", requireRiskEvidence: true }), null);
  });

  it("emits NO risk_* checks when risk evidence is omitted (structural/preflight callers)", () => {
    const r = evaluateActionPolicy(CLEAN_PAYMENT);
    assert.ok(!r.checks.some((c) => c.name.startsWith("risk_")), "no risk_* checks without evidence");
    assert.strictEqual(r.decision, "ALLOW");
  });

  it("requireRiskEvidence fails closed when the policy carries no risk evidence (wiring guard)", () => {
    const r = evaluateActionPolicy(CLEAN_PAYMENT); // ALLOW, but evaluated without risk
    const gate = enforceWriteDecision(r, { confirmed: true, toolName: "send_payment", requireRiskEvidence: true });
    assert.strictEqual(gate!.error.code, "POLICY_EVIDENCE_MISSING", "missing evidence must block loudly");
    // Without the flag (structural callers like approve_token / x402), behavior is unchanged.
    assert.strictEqual(enforceWriteDecision(r, { confirmed: false, toolName: "approve_token" }), null);
  });

  it("riskEvidenceFromAssessment projects a RiskAssessment faithfully", () => {
    const assessment: RiskAssessment = {
      riskScore: 44,
      riskLevel: "medium",
      recommendation: "caution",
      breakdown: { liquidityRisk: 70, slippageRisk: 60, counterpartyRisk: 55, balanceRisk: 5, marketConditionRisk: 5 },
      reasons: [],
      suggestion: "",
      degraded: true,
      degradedReasons: ["Route fetch failed."],
      swapProviderNotConfigured: true,
    };
    const evidence = riskEvidenceFromAssessment(assessment);
    assert.deepStrictEqual(evidence, {
      score: 44,
      degraded: true,
      degradedReasons: ["Route fetch failed."],
      counterpartyRisk: 55,
      swapProviderNotConfigured: true,
    });
  });
});
