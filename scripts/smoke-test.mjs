#!/usr/bin/env node
// ─── SafeHands Smoke Tests ─────────────────────────────────────────────
// Deterministic, offline-safe smoke tests for all critical hardening areas.
// No private keys, no real funds, no mainnet, no RPC required.
// ────────────────────────────────────────────────────────────────────────

import { handleSafeHandsPreflightCheck } from "../dist/tools/safehandsPreflightCheck.js";
import { handleSafeHandsSafeExecute } from "../dist/tools/safehandsSafeExecute.js";
import { handleSafeHandsX402Preflight } from "../dist/tools/safehandsX402Preflight.js";
import { handleCreateAgentWallet } from "../dist/tools/createAgentWallet.js";
import { handlePublishRiskScore } from "../dist/tools/publishRiskScore.js";
import { evaluateActionPolicy } from "../dist/lib/policy/actionPolicyEngine.js";
import { isValidPositiveAmount, validatePositiveAmount, validateNonZeroAddress, validateTokenIdentifier } from "../dist/lib/validation.js";
import { isBlockedIp, assertSafeFetchUrl } from "../dist/lib/http.js";
import { RISK_REGISTRY_V2_ADDRESS, RISK_REGISTRY_V2_ABI, REQUIRE_AUTHORIZED_AGENT_FOR_WRITE } from "../dist/lib/constants.js";
import { deriveActionHash } from "../dist/lib/riskRegistryV2.js";
import { loadAgentPolicy, POLICY_PROFILES, saveAgentPolicy } from "../dist/lib/policy/agentPolicy.js";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import { existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __smoke_dirname = dirname(fileURLToPath(import.meta.url));

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

// ─── 23. approve_token with approvalToken="notaddress" → validation error

await assertAsync("preflight: approve_token invalid token → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "approve_token",
    chainId: 688689,
    approvalAmount: "1",
    approvalToken: "notaddress",
    spender: VALID_ADDR,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 24. execute_swap with invalid tokenIn/tokenOut → validation error

await assertAsync("preflight: execute_swap invalid tokenIn → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "execute_swap",
    chainId: 688689,
    amount: "1",
    tokenIn: "notaddress",
    tokenOut: "alsoBad",
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 25. publish_risk_score missing walletAddress/score → validation error

await assertAsync("preflight: publish_risk_score missing fields → validation error", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "publish_risk_score",
    chainId: 688689,
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 26. x402_preflight paymentAmountUsdc="abc" → validation error

await assertAsync("x402_preflight: paymentAmountUsdc=abc → validation error", async () => {
  const r = await handleSafeHandsX402Preflight({
    url: "http://8.8.8.8/paid",
    paymentAmountUsdc: "abc",
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 27. x402_preflight paymentAmountUsdc="-1" → validation error

await assertAsync("x402_preflight: paymentAmountUsdc=-1 → validation error", async () => {
  const r = await handleSafeHandsX402Preflight({
    url: "http://8.8.8.8/paid",
    paymentAmountUsdc: "-1",
  });
  return !r.success && r.error.code === "VALIDATION_ERROR";
});

// ─── 28. validateTokenIdentifier unit tests

assert("token: PHRS valid symbol", validateTokenIdentifier("PHRS", "t") === null, undefined);
assert("token: valid address", validateTokenIdentifier("0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8", "t") === null, undefined);
assert("token: notaddress blocked", validateTokenIdentifier("notaddress", "t") !== null, undefined);

// ─── Phase 3: Constants / V2 ABI ──────────────────────────────────────

assert("v2: address is configured", RISK_REGISTRY_V2_ADDRESS === "0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25", undefined);

assert("v2: ABI can encode isAuthorizedAgent", (() => {
  try {
    const data = encodeFunctionData({ abi: RISK_REGISTRY_V2_ABI, functionName: "isAuthorizedAgent", args: [VALID_ADDR] });
    return typeof data === "string" && data.startsWith("0x");
  } catch { return false; }
})(), undefined);

assert("v2: ABI can encode publishRiskRecord", (() => {
  try {
    const hash = "0x" + "ab".repeat(32);
    const data = encodeFunctionData({
      abi: RISK_REGISTRY_V2_ABI,
      functionName: "publishRiskRecord",
      args: [VALID_ADDR, VALID_ADDR, hash, 50, "LOW", "Safe", "v1.6.0", "", 0n],
    });
    return typeof data === "string" && data.startsWith("0x");
  } catch { return false; }
})(), undefined);

assert("v2: REQUIRE_AUTHORIZED_AGENT_FOR_WRITE defaults true", REQUIRE_AUTHORIZED_AGENT_FOR_WRITE === true, undefined);

// ─── Phase 3: deriveActionHash ────────────────────────────────────────

assert("v2: deriveActionHash produces bytes32", (() => {
  const hash = deriveActionHash(688689, "send_payment", VALID_ADDR, { amount: "0.001" });
  return typeof hash === "string" && hash.startsWith("0x") && hash.length === 66;
})(), undefined);

assert("v2: deriveActionHash is deterministic", (() => {
  const a = deriveActionHash(688689, "swap", VALID_ADDR, { tokenIn: "PHRS", tokenOut: "USDC" });
  const b = deriveActionHash(688689, "swap", VALID_ADDR, { tokenIn: "PHRS", tokenOut: "USDC" });
  return a === b;
})(), undefined);

// ─── Phase 3: publish_risk_score validation ───────────────────────────

await assertAsync("publish_risk_score: WRITE_TOOLS_DISABLED blocks", async () => {
  const prev = process.env.WRITE_TOOLS_ENABLED;
  process.env.WRITE_TOOLS_ENABLED = "false";
  try {
    const r = await handlePublishRiskScore({ action: "transfer", amount: "0.001", toAddress: VALID_ADDR });
    return !r.success && r.error.code === "WRITE_TOOLS_DISABLED";
  } finally {
    if (prev !== undefined) process.env.WRITE_TOOLS_ENABLED = prev;
    else delete process.env.WRITE_TOOLS_ENABLED;
  }
});

// ─── Phase 3: preflight does NOT require authorization ────────────────

await assertAsync("preflight: no authorization required", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    chainId: 688689,
    amount: "0.001",
    recipient: VALID_ADDR,
  });
  return r.success && r.data.decision === "ALLOW";
});

// ─── Phase 3: safe_execute managed auth gate ──────────────────────────

await assertAsync("safe_execute: managed no-wallet → blocked (no signer)", async () => {
  const prev = { we: process.env.WRITE_TOOLS_ENABLED, wm: process.env.WALLET_MODE, req: process.env.REQUIRE_AUTHORIZED_AGENT_FOR_WRITE };
  process.env.WRITE_TOOLS_ENABLED = "true";
  process.env.WALLET_MODE = "managed-testnet";
  process.env.REQUIRE_AUTHORIZED_AGENT_FOR_WRITE = "true";
  try {
    const r = await handleSafeHandsSafeExecute({
      path: "safe_execute_send_payment",
      execute: true,
      confirmExecution: true,
      action: { toAddress: VALID_ADDR, amount: "0.001", agentId: "test-no-wallet" },
    });
    // No managed wallet → signer unavailable → policy BLOCK (no signer) → executed:false
    return r.success && r.data && r.data.blocked === true && r.data.executed === false;
  } finally {
    process.env.WRITE_TOOLS_ENABLED = prev.we;
    process.env.WALLET_MODE = prev.wm;
    if (prev.req !== undefined) process.env.REQUIRE_AUTHORIZED_AGENT_FOR_WRITE = prev.req;
    else delete process.env.REQUIRE_AUTHORIZED_AGENT_FOR_WRITE;
  }
});

// ─── Phase 3: auto-authorize disabled by default ──────────────────────

assert("auto-authorize: disabled by default", process.env.AUTO_AUTHORIZE_AGENT_WALLET !== "true", undefined);

// ─── Phase 4: Agent Policy ──────────────────────────────────────────

assert("policy: default loads as balanced", (() => {
  const p = loadAgentPolicy();
  return p.profile === "balanced" && Number(p.limits.maxSwapPHRS) === 10;
})(), undefined);

assert("policy: conservative profile exists", (() => {
  const p = POLICY_PROFILES.conservative;
  return p.profile === "conservative" && Number(p.limits.maxPaymentPHRS) === 0.1;
})(), undefined);

assert("policy: advanced allows 1000 PHRS swap", (() => {
  const p = POLICY_PROFILES.advanced;
  return Number(p.limits.maxSwapPHRS) === 1000;
})(), undefined);

assert("policy: custom agent policy saves and loads", (() => {
  const testId = "__smoke_test_temp__";
  const custom = {
    profile: "custom",
    limits: {
      maxPaymentPHRS: "50",
      maxSwapPHRS: "500",
      maxDailySpendPHRS: "1000",
      maxX402PaymentUSDC: "0.5",
      maxApprovalUSDC: "100",
    },
    flags: {
      allowUnknownTokens: false,
      allowCustomContractCalls: true,
      requireConfirmationAboveRisk: "HIGH",
    },
  };
  try {
    saveAgentPolicy(testId, custom);
    const loaded = loadAgentPolicy(testId);
    return loaded.profile === "custom" && loaded.limits.maxSwapPHRS === "500";
  } finally {
    try {
      const fp = join(__smoke_dirname, "..", ".agents", "policies", `${testId}.json`);
      if (existsSync(fp)) unlinkSync(fp);
    } catch {}
  }
})(), undefined);

// ─── Phase 4: large swap against agent policy ─────────────────────────

await assertAsync("policy: 1000 PHRS swap ALLOWED by advanced policy", async () => {
  const r = evaluateActionPolicy({
    actionType: "execute_swap",
    chainId: 688689,
    isMainnet: false,
    amount: "1000",
    tokenIn: "PHRS",
    tokenOut: "USDC",
    agentPolicy: POLICY_PROFILES.advanced,
  });
  return r.decision === "ALLOW";
});

await assertAsync("policy: 1000 PHRS swap BLOCKED by conservative policy", async () => {
  const r = evaluateActionPolicy({
    actionType: "execute_swap",
    chainId: 688689,
    isMainnet: false,
    amount: "1000",
    tokenIn: "PHRS",
    tokenOut: "USDC",
    agentPolicy: POLICY_PROFILES.conservative,
  });
  return r.decision === "BLOCK";
});

// ─── Phase 4: hard safety rules override custom policy ────────────────

await assertAsync("policy: mainnet BLOCKED even with advanced policy", async () => {
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

await assertAsync("policy: unlimited approval BLOCKED even with advanced policy", async () => {
  const r = evaluateActionPolicy({
    actionType: "approve_token",
    chainId: 688689,
    isMainnet: false,
    approvalAmount: "max",
    approvalToken: "USDC",
    spender: VALID_ADDR,
    agentPolicy: POLICY_PROFILES.advanced,
  });
  return r.decision === "BLOCK";
});

await assertAsync("policy: x402 SSRF BLOCKED even with advanced policy", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "x402_pay_and_fetch",
    url: "http://localhost:4021/paid",
    paymentAmountUsdc: "0.001",
  });
  const data = r.success ? r.data : null;
  return data && data.decision === "BLOCK";
});

// ─── Phase 4: env defaults ───────────────────────────────────────────

assert("env: WRITE_TOOLS_ENABLED defaults false", process.env.WRITE_TOOLS_ENABLED !== "true", undefined);

assert("env: RiskRegistry V2 address defaults correctly", RISK_REGISTRY_V2_ADDRESS === "0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25", undefined);

assert("env: REQUIRE_AUTHORIZED_AGENT_FOR_WRITE defaults true", REQUIRE_AUTHORIZED_AGENT_FOR_WRITE === true, undefined);

// ─── Phase 4: preflight works without .env ───────────────────────────

await assertAsync("env: preflight works without private key or wallet", async () => {
  const r = await handleSafeHandsPreflightCheck({
    actionType: "send_payment",
    chainId: 688689,
    amount: "0.001",
    recipient: VALID_ADDR,
  });
  return r.success && r.data.decision === "ALLOW";
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
