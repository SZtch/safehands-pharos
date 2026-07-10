// ─── Calldata decoder (read-only) ──────────────────────────────────────
// Verifies the offline superset decoder: permit / Permit2 approve /
// setApprovalForAll / transfer(From) / allowance changes / dangerous-admin.
// A token transfer to an unknown recipient must REQUIRE_CONFIRMATION (never LOW);
// a denylisted recipient is BLOCKED; the decoder is a sub-signal that can only
// escalate the guardian aggregate, never lower it. Pure + deterministic.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { encodeFunctionData } from "viem";
import {
  analyzeCalldata,
  PERMIT2_APPROVE_SELECTOR,
  isDecodableCalldataSelector,
} from "../src/lib/analysis/calldata.js";
import { handleGuardianCheck } from "../src/api/routes.js";
import { classifyIntent } from "../src/agent/agentIntentClassifier.js";
import { routeIntent } from "../src/agent/agentToolRouter.js";

// Permit2 singleton is a recognized canonical (known) spender/operator.
const KNOWN = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const UNKNOWN = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const UINT256_MAX = (1n << 256n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;

const ABI = [
  { name: "permit", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }], outputs: [] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "token", type: "address" }, { name: "spender", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }], outputs: [] },
  { name: "setApprovalForAll", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { name: "transferFrom", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "increaseAllowance", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "addedValue", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "decreaseAllowance", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "subtractedValue", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "transferOwnership", type: "function", stateMutability: "nonpayable", inputs: [{ name: "newOwner", type: "address" }], outputs: [] },
] as const;

const enc = (functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({ abi: ABI, functionName: functionName as never, args: args as never });

// Permit2 approve shares the ERC-20 `approve` name; encode it explicitly by its own ABI.
const encPermit2 = (token: string, spender: string, amount: bigint, expiration: number) =>
  encodeFunctionData({
    abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "spender", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }], outputs: [] }] as const,
    functionName: "approve",
    args: [token as `0x${string}`, spender as `0x${string}`, amount, expiration],
  });

afterEach(() => {
  delete process.env.SAFEHANDS_RECIPIENT_DENYLIST;
});

describe("calldata decoder — approvals", () => {
  it("ERC-2612 permit: unlimited to unknown spender => BLOCK", () => {
    const data = enc("permit", [UNKNOWN, UNKNOWN, UINT256_MAX, 0n, 27, "0x".padEnd(66, "0"), "0x".padEnd(66, "0")]);
    const r = analyzeCalldata(data);
    assert.strictEqual(r.decision, "BLOCK");
    assert.strictEqual(r.details.method, "permit");
    assert.strictEqual(r.details.unlimited, true);
    assert.strictEqual(r.details.spender!.toLowerCase(), UNKNOWN);
    assert.strictEqual(r.readOnly, true);
  });

  it("ERC-2612 permit: limited to unknown spender => REQUIRE_CONFIRMATION", () => {
    const data = enc("permit", [UNKNOWN, UNKNOWN, 1000n, 0n, 27, "0x".padEnd(66, "0"), "0x".padEnd(66, "0")]);
    assert.strictEqual(analyzeCalldata(data).decision, "REQUIRE_CONFIRMATION");
  });

  it("Permit2 approve: extracts token/spender/amount/expiration; uint160-max is unlimited => BLOCK (unknown)", () => {
    const data = encPermit2(TOKEN, UNKNOWN, UINT160_MAX, 12345);
    const r = analyzeCalldata(data);
    assert.strictEqual(r.details.selector, PERMIT2_APPROVE_SELECTOR);
    assert.strictEqual(r.details.method, "permit2_approve");
    assert.strictEqual(r.details.token!.toLowerCase(), TOKEN);
    assert.strictEqual(r.details.spender!.toLowerCase(), UNKNOWN);
    assert.strictEqual(r.details.amountRaw, UINT160_MAX.toString());
    assert.strictEqual(r.details.unlimited, true);
    assert.strictEqual(r.decision, "BLOCK");
  });

  it("Permit2 approve: unlimited to a KNOWN spender => REQUIRE_CONFIRMATION", () => {
    const data = encPermit2(TOKEN, KNOWN, UINT160_MAX, 0);
    const r = analyzeCalldata(data);
    assert.strictEqual(r.details.counterpartyKnown, true);
    assert.strictEqual(r.decision, "REQUIRE_CONFIRMATION");
  });

  it("setApprovalForAll(operator,true) unknown operator => BLOCK; (operator,false) => ALLOW", () => {
    const grant = analyzeCalldata(enc("setApprovalForAll", [UNKNOWN, true]));
    assert.strictEqual(grant.decision, "BLOCK");
    assert.strictEqual(grant.details.approved, true);
    assert.strictEqual(grant.details.operator!.toLowerCase(), UNKNOWN);

    const revoke = analyzeCalldata(enc("setApprovalForAll", [UNKNOWN, false]));
    assert.strictEqual(revoke.decision, "ALLOW");
    assert.strictEqual(revoke.details.approved, false);
  });

  it("increaseAllowance unlimited to unknown => BLOCK; decreaseAllowance => ALLOW", () => {
    assert.strictEqual(analyzeCalldata(enc("increaseAllowance", [UNKNOWN, UINT256_MAX])).decision, "BLOCK");
    const dec = analyzeCalldata(enc("decreaseAllowance", [UNKNOWN, 5n]));
    assert.strictEqual(dec.decision, "ALLOW");
    assert.strictEqual(dec.details.method, "decreaseAllowance");
  });

  it("ERC-20 approve delegates to analyzeApproval (unlimited unknown => BLOCK, method 'approve')", () => {
    const approveData = encodeFunctionData({
      abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [
        { name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const,
      functionName: "approve", args: [UNKNOWN as `0x${string}`, UINT256_MAX],
    });
    const r = analyzeCalldata(approveData, TOKEN);
    assert.strictEqual(r.details.method, "approve");
    assert.strictEqual(r.details.category, "approval");
    assert.strictEqual(r.decision, "BLOCK");
  });
});

describe("calldata decoder — transfers (assets move => never LOW for unknown recipient)", () => {
  it("transfer to unknown recipient => REQUIRE_CONFIRMATION", () => {
    const r = analyzeCalldata(enc("transfer", [RECIPIENT, 1000n]), TOKEN);
    assert.strictEqual(r.decision, "REQUIRE_CONFIRMATION");
    assert.strictEqual(r.details.method, "transfer");
    assert.strictEqual(r.details.recipient!.toLowerCase(), RECIPIENT);
    assert.notStrictEqual(r.riskLevel, "LOW");
  });

  it("transferFrom to unknown recipient => REQUIRE_CONFIRMATION", () => {
    const r = analyzeCalldata(enc("transferFrom", [UNKNOWN, RECIPIENT, 1000n]), TOKEN);
    assert.strictEqual(r.decision, "REQUIRE_CONFIRMATION");
    assert.strictEqual(r.details.method, "transferFrom");
    assert.strictEqual(r.details.from!.toLowerCase(), UNKNOWN);
    assert.strictEqual(r.details.recipient!.toLowerCase(), RECIPIENT);
  });

  it("denylisted recipient => BLOCK (transfer and transferFrom)", () => {
    process.env.SAFEHANDS_RECIPIENT_DENYLIST = RECIPIENT;
    const t = analyzeCalldata(enc("transfer", [RECIPIENT, 1n]), TOKEN);
    assert.strictEqual(t.decision, "BLOCK");
    assert.strictEqual(t.details.recipientDenylisted, true);
    const tf = analyzeCalldata(enc("transferFrom", [UNKNOWN, RECIPIENT, 1n]), TOKEN);
    assert.strictEqual(tf.decision, "BLOCK");
    assert.strictEqual(tf.details.recipientDenylisted, true);
  });
});

describe("calldata decoder — dangerous admin + robustness", () => {
  it("transferOwnership => REQUIRE_CONFIRMATION/HIGH, dangerous, non-exhaustive warning", () => {
    const r = analyzeCalldata(enc("transferOwnership", [UNKNOWN]));
    assert.strictEqual(r.decision, "REQUIRE_CONFIRMATION");
    assert.strictEqual(r.riskLevel, "HIGH");
    assert.strictEqual(r.details.dangerous, true);
    assert.strictEqual(r.details.category, "admin");
    assert.ok(r.warnings.some((w) => /not exhaustive/i.test(w)));
  });

  it("malformed calldata for a known selector => partial + REQUIRE_CONFIRMATION (never throws)", () => {
    const r = analyzeCalldata("0xa9059cbb00"); // transfer selector, truncated args
    assert.strictEqual(r.decision, "REQUIRE_CONFIRMATION");
    assert.strictEqual(r.analyzerStatus, "partial");
  });

  it("unknown/undecodable selector => REQUIRE_CONFIRMATION + unavailable (fail-closed)", () => {
    const r = analyzeCalldata("0xdeadbeef");
    assert.strictEqual(r.decision, "REQUIRE_CONFIRMATION");
    assert.strictEqual(r.analyzerStatus, "unavailable");
    assert.strictEqual(isDecodableCalldataSelector("0xdeadbeef"), false);
  });

  it("every result is read-only", () => {
    for (const data of [enc("transfer", [RECIPIENT, 1n]), enc("setApprovalForAll", [UNKNOWN, true]), enc("transferOwnership", [UNKNOWN])]) {
      assert.strictEqual(analyzeCalldata(data).readOnly, true);
    }
  });
});

describe("calldata decoder — wiring", () => {
  it("agent router sends permit2_approval to the calldata decoder (closes the routing gap)", async () => {
    const data = encPermit2(TOKEN, UNKNOWN, UINT160_MAX, 0);
    const intent = classifyIntent({ data });
    assert.strictEqual(intent.intent, "permit2_approval");
    const routed = await routeIntent("permit2_approval", { data, token: TOKEN });
    assert.strictEqual(routed.tool, "analyze/calldata");
    assert.strictEqual(routed.decision, "BLOCK"); // real decode, not "not an ERC-20 approve"
    assert.strictEqual((routed.primaryDetails as { method?: string }).method, "permit2_approve");
  });

  it("decoder LOW cannot lower the guardian aggregate baseline", async () => {
    // decreaseAllowance => decoder ALLOW/LOW, but analyzeEvmCall (unknown target, no
    // RPC client) => REQUIRE_CONFIRMATION, so the aggregate stays REQUIRE_CONFIRMATION.
    const data = enc("decreaseAllowance", [UNKNOWN, 5n]);
    const payload = await handleGuardianCheck({ to: TOKEN, data });
    assert.strictEqual(payload.decision, "REQUIRE_CONFIRMATION");
    const calldataResult = payload.analyzers.find((a) => a.analyzer === "calldata");
    assert.ok(calldataResult, "calldata analyzer should be present");
    assert.strictEqual(calldataResult.decision, "ALLOW");
  });
});
