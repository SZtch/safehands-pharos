// ─── Action Policy Engine — deterministic BLOCK matrix ─────────────────────
// The reason a pre-execution firewall exists is its BLOCK paths. These are the
// dangerous-transaction cases that MUST be rejected. Pure + deterministic:
// no chain, no network, no signer. Complements the live-RPC smoke suite.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { evaluateActionPolicy } from "../src/lib/policy/actionPolicyEngine.js";

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
