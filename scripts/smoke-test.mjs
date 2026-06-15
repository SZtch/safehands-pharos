#!/usr/bin/env node
// ─── SafeHands Smoke Tests ─────────────────────────────────────────────
// Deterministic, offline-safe smoke tests for all critical hardening areas.
// No private keys, no real funds, no mainnet, no RPC required.
// ────────────────────────────────────────────────────────────────────────

import { handleSafeHandsPreflightCheck } from "../dist/tools/safehandsPreflightCheck.js";
import { handleSafeHandsSafeExecute } from "../dist/tools/safehandsSafeExecute.js";
import { handleCreateAgentWallet } from "../dist/tools/createAgentWallet.js";
import { evaluateActionPolicy } from "../dist/lib/policy/actionPolicyEngine.js";
import { isValidPositiveAmount, validatePositiveAmount, validateNonZeroAddress } from "../dist/lib/validation.js";
import { isBlockedIp, assertSafeFetchUrl } from "../dist/lib/http.js";

const VALID_ADDR = "0x0000000000000000000000000000000000000001";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const results = [];
let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    results.push({ name, status: "PASS" });
    passed++;
  } else {
    results.push({ name, status: "FAIL", detail });
    failed++;
  }
}

async function assertAsync(name, fn) {
  try {
    const ok = await fn();
    assert(name, ok, "returned false");
  } catch (err) {
    assert(name, false, err.message);
  }
}

// ─── 1. Shared Validation ─────────────────────────────────────────────

assert("amount: positive valid", isValidPositiveAmount("0.001"), undefined);
assert("amount: reject negative", !isValidPositiveAmount("-1"), undefined);
assert("amount: reject zero", !isValidPositiveAmount("0"), undefined);
assert("amount: reject abc", !isValidPositiveAmount("abc"), undefined);
assert("amount: reject NaN", !isValidPositiveAmount("NaN"), undefined);
assert("amount: reject Infinity", !isValidPositiveAmount("Infinity"), undefined);
assert("amount: reject empty", !isValidPositiveAmount(""), undefined);
assert("amount: reject null", !isValidPositiveAmount(null), undefined);
assert("amount: reject undefined", !isValidPositiveAmount(undefined), undefined);

assert("addr: valid address passes", validateNonZeroAddress(VALID_ADDR, "x") === null, undefined);
assert("addr: zero address blocked", validateNonZeroAddress(ZERO_ADDR, "x") !== null, undefined);
assert("addr: invalid address blocked", validateNonZeroAddress("not-an-address", "x") !== null, undefined);
assert("addr: empty blocked", validateNonZeroAddress("", "x") !== null, undefined);

// ─── 2. Preflight: mainnet chainId=1 → BLOCK ─────────────────────────

await assertAsync("preflight: mainnet chainId=1 → BLOCK", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    chainId: 1,
    isMainnet: true,
    amount: "0.001",
    recipient: VALID_ADDR,
  });
  const data = r.success ? r.data : null;
  return data && data.decision === "BLOCK";
});

// ─── 3. Preflight: send_payment missing amount → BLOCK/validation ────

await assertAsync("preflight: send_payment missing amount → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    recipient: VALID_ADDR,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 4. Preflight: send_payment amount=-1 → BLOCK/validation ─────────

await assertAsync("preflight: send_payment amount=-1 → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    amount: "-1",
    recipient: VALID_ADDR,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 5. Preflight: send_payment amount=abc → BLOCK/validation ────────

await assertAsync("preflight: send_payment amount=abc → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    amount: "abc",
    recipient: VALID_ADDR,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 6. Preflight: send_payment zero recipient → BLOCK/validation ────

await assertAsync("preflight: send_payment zero recipient → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    amount: "0.001",
    recipient: ZERO_ADDR,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 7. Preflight: unlimited/max approval → BLOCK ────────────────────

await assertAsync("preflight: approve_token max → BLOCK", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "approve_token",
    approvalAmount: "max",
    approvalToken: "USDC",
    spender: VALID_ADDR,
  });
  const data = r.success ? r.data : null;
  return data && data.decision === "BLOCK";
});

// ─── 8. Preflight: approve with invalid token → validation error ─────

await assertAsync("preflight: approve_token missing token → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "approve_token",
    approvalAmount: "5",
    spender: VALID_ADDR,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 9. Preflight: approve with spenderAddress instead of spender → validation error

await assertAsync("preflight: approve_token with spenderAddress → strict error", async () => {
  try {
    const r = await handleSafeHandsPreflightCheck({
      actionType: "approve_token",
      approvalAmount: "5",
      approvalToken: "USDC",
      spenderAddress: VALID_ADDR,
    });
    return !r.success && r.error.code === "VALIDATION_ERROR";
  } catch {
    return true;
  }
});

// ─── 10. SSRF: x402 localhost → BLOCK ─────────────────────────────────

await assertAsync("preflight: x402 localhost → BLOCK", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "x402_pay_and_fetch",
    url: "http://localhost:4021/paid",
    paymentAmountUsdc: "0.001",
  });
  const data = r.success ? r.data : null;
  return data && data.decision === "BLOCK";
});

// ─── 11. SSRF: x402 169.254.169.254 → BLOCK ──────────────────────────

await assertAsync("preflight: x402 169.254.169.254 → BLOCK", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "x402_pay_and_fetch",
    url: "http://169.254.169.254/latest/meta-data/",
    paymentAmountUsdc: "0.001",
  });
  const data = r.success ? r.data : null;
  return data && data.decision === "BLOCK";
});

// ─── 12. SSRF: IPv6 ::1 → BLOCK ──────────────────────────────────────

await assertAsync("preflight: x402 IPv6 ::1 → BLOCK", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "x402_pay_and_fetch",
    url: "http://[::1]:4021/paid",
    paymentAmountUsdc: "0.001",
  });
  const data = r.success ? r.data : null;
  return data && data.decision === "BLOCK";
});

// ─── 13. SSRF: IP blocking in http.ts ─────────────────────────────────

assert("ip: 127.0.0.1 blocked", isBlockedIp("127.0.0.1"), undefined);
assert("ip: 10.0.0.1 blocked", isBlockedIp("10.0.0.1"), undefined);
assert("ip: 192.168.1.1 blocked", isBlockedIp("192.168.1.1"), undefined);
assert("ip: 172.16.0.1 blocked", isBlockedIp("172.16.0.1"), undefined);
assert("ip: 169.254.169.254 blocked", isBlockedIp("169.254.169.254"), undefined);
assert("ip: 0.0.0.0 blocked", isBlockedIp("0.0.0.0"), undefined);
assert("ip: ::1 blocked", isBlockedIp("::1"), undefined);
assert("ip: fc00::1 blocked", isBlockedIp("fc00::1"), undefined);
assert("ip: fe80::1 blocked", isBlockedIp("fe80::1"), undefined);
assert("ip: 8.8.8.8 allowed", !isBlockedIp("8.8.8.8"), undefined);

// ─── 14. SSRF: assertSafeFetchUrl blocks private IPs ──────────────────

await assertAsync("ssrf: assertSafeFetchUrl blocks localhost", async () => {
  try { await assertSafeFetchUrl("http://localhost:3000"); return false; } catch { return true; }
});

await assertAsync("ssrf: assertSafeFetchUrl blocks 127.0.0.1", async () => {
  try { await assertSafeFetchUrl("http://127.0.0.1:3000"); return false; } catch { return true; }
});

// ─── 15. Preflight: custom_contract_call empty → BLOCK ────────────────

await assertAsync("preflight: custom_contract_call empty → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "custom_contract_call",
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 16. create_agent_wallet without agentId → validation error ───────

await assertAsync("create_agent_wallet without agentId → validation error", async () => {
  const r = await handleCreateAgentWallet({});
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 17. Safe small Atlantic testnet payment preflight → ALLOW ────────

await assertAsync("preflight: safe small testnet payment → ALLOW", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    chainId: 688689,
    isMainnet: false,
    amount: "0.001",
    amountUnit: "PHRS",
    recipient: VALID_ADDR,
  });
  const data = r.success ? r.data : null;
  return data && data.decision === "ALLOW";
});

// ─── 18. safehands_safe_execute: WRITE_TOOLS_DISABLED ─────────────────

await assertAsync("safe_execute: WRITE_TOOLS_DISABLED → fail", async () => {
  const prev = process.env.WRITE_TOOLS_ENABLED;
  process.env.WRITE_TOOLS_ENABLED = "false";
  try {
    const r = await handleSafeHandsSafeExecute({
      path: "safe_execute_send_payment",
      execute: true,
      confirmExecution: true,
      action: { toAddress: VALID_ADDR, amount: "0.001" },
    });
    return !r.success;
  } finally {
    if (prev !== undefined) process.env.WRITE_TOOLS_ENABLED = prev;
    else delete process.env.WRITE_TOOLS_ENABLED;
  }
});

// ─── 19. Publish_risk_score: score=999 → out of range ─────────────────

await assertAsync("preflight: publish_risk_score score=999 → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "publish_risk_score",
    score: 999,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 20. Publish_risk_score: zero wallet → validation error ───────────

await assertAsync("preflight: publish_risk_score zero wallet → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "publish_risk_score",
    walletAddress: ZERO_ADDR,
    score: 50,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 21. Policy engine: auto-requiresSigner for write actions ─────────

assert("policy: send_payment auto-requiresSigner", (() => {
  const r = evaluateActionPolicy({
    actionType: "send_payment",
    amount: "0.001",
    recipient: VALID_ADDR,
    chainId: 688689,
    isMainnet: false,
    requiresSigner: true,
    signerAvailable: false,
  });
  return r.decision === "BLOCK";
})(), undefined);

// ─── 22. execute_swap: missing tokenIn/tokenOut → validation ──────────

await assertAsync("preflight: execute_swap missing tokenIn → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "execute_swap",
    amount: "0.001",
    tokenOut: "USDC",
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── Summary ──────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(70));
console.log("  SafeHands Smoke Test Results");
console.log("═".repeat(70));

for (const r of results) {
  const icon = r.status === "PASS" ? "✅" : "❌";
  const detail = r.detail ? ` — ${r.detail}` : "";
  console.log(`  ${icon} ${r.name}${detail}`);
}

console.log("\n" + "─".repeat(70));
console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
console.log("─".repeat(70));

if (failed > 0) {
  console.error(`\n❌ ${failed} smoke test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${passed} smoke tests passed.`);
  process.exit(0);
}
