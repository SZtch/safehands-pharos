// ─── Input / execution hardening ───────────────────────────────────────────
// Offline unit tests for five hardening fixes:
//   - executeSwap hard price-impact ceiling + non-positive amountOut guard
//   - existing-but-invalid agent policy fails CLOSED to `conservative`
//   - replay-store 503s never echo store internals in production
//   - pre-broadcast simulation of the exact swap calldata (explicit gas
//     bypasses viem's implicit estimateGas revert check)
//   - check_token_security network metadata derives from the active network
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { evaluateSwapQuoteGuards, simulateSwapCalldata } from "../src/tools/executeSwap.js";
import { loadAgentPolicy, POLICY_PROFILES } from "../src/lib/policy/agentPolicy.js";
import { replayStoreUnavailableMessage } from "../src/api/x402Gate.js";
import { tokenSecurityNetworkMetadata } from "../src/tools/checkTokenSecurity.js";
import { CHAIN_ID, IS_MAINNET, MAX_SLIPPAGE_PCT, PHAROS_ENVIRONMENT } from "../src/lib/constants.js";

describe("swap quote guards are hard stops", () => {
  it("blocks price impact above MAX_SLIPPAGE_PCT when no tolerance is given", () => {
    const guard = evaluateSwapQuoteGuards({ priceImpact: MAX_SLIPPAGE_PCT + 5, amountOut: "1" });
    assert.strictEqual(guard?.code, "PRICE_IMPACT_TOO_HIGH");
  });

  it("uses the caller's slippageTolerance as the ceiling when it is larger", () => {
    const impact = MAX_SLIPPAGE_PCT + 3;
    assert.strictEqual(evaluateSwapQuoteGuards({ priceImpact: impact, amountOut: "1" }, impact + 1), null);
    assert.strictEqual(
      evaluateSwapQuoteGuards({ priceImpact: impact, amountOut: "1" }, MAX_SLIPPAGE_PCT - 1)?.code,
      "PRICE_IMPACT_TOO_HIGH",
      "a tolerance below MAX_SLIPPAGE_PCT must not lower the ceiling below the impact",
    );
  });

  it("treats negative price impact by magnitude", () => {
    assert.strictEqual(
      evaluateSwapQuoteGuards({ priceImpact: -(MAX_SLIPPAGE_PCT + 5), amountOut: "1" })?.code,
      "PRICE_IMPACT_TOO_HIGH",
    );
  });

  it("blocks non-positive or unparseable amountOut", () => {
    assert.strictEqual(evaluateSwapQuoteGuards({ priceImpact: 0.1, amountOut: "0" })?.code, "INVALID_QUOTE_AMOUNT_OUT");
    assert.strictEqual(evaluateSwapQuoteGuards({ priceImpact: 0.1, amountOut: "-3" })?.code, "INVALID_QUOTE_AMOUNT_OUT");
    assert.strictEqual(evaluateSwapQuoteGuards({ priceImpact: 0.1, amountOut: "not-a-number" })?.code, "INVALID_QUOTE_AMOUNT_OUT");
  });

  it("fails closed on a non-finite price impact", () => {
    assert.strictEqual(evaluateSwapQuoteGuards({ priceImpact: Number.NaN, amountOut: "1" })?.code, "PRICE_IMPACT_TOO_HIGH");
  });

  it("passes a clean quote", () => {
    assert.strictEqual(evaluateSwapQuoteGuards({ priceImpact: 0.4, amountOut: "12.5" }, 3), null);
  });
});

describe("pre-broadcast swap simulation", () => {
  const args = {
    account: "0x000000000000000000000000000000000000dEaD" as const,
    to: "0x000000000000000000000000000000000000dEaD" as const,
    value: 0n,
    data: "0x" as const,
  };

  it("returns null when the call simulates cleanly", async () => {
    assert.strictEqual(await simulateSwapCalldata({ call: async () => ({ data: "0x" }) }, args), null);
  });

  it("returns the revert reason when the call reverts", async () => {
    const result = await simulateSwapCalldata(
      { call: async () => { throw new Error("execution reverted: K"); } },
      args,
    );
    assert.ok(result?.includes("execution reverted"));
  });
});

describe("existing-but-invalid agent policy fails closed to conservative", () => {
  const policiesDir = join(process.cwd(), ".agents", "policies");

  function withWarnSpy<T>(fn: () => T): { result: T; warnings: string[] } {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
    try {
      return { result: fn(), warnings };
    } finally {
      console.warn = original;
    }
  }

  it("malformed JSON → conservative profile + operator warning", () => {
    const agentId = `p1-test-malformed-${process.pid}`;
    const file = join(policiesDir, `${agentId}.json`);
    writeFileSync(file, "{ not valid json", "utf-8");
    try {
      const { result, warnings } = withWarnSpy(() => loadAgentPolicy(agentId));
      assert.strictEqual(result.profile, "conservative");
      assert.deepStrictEqual(result, POLICY_PROFILES.conservative);
      assert.ok(warnings.some((w) => w.includes(agentId) && w.includes("conservative")), "must warn the operator");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("parseable but schema-invalid policy → conservative, never balanced", () => {
    const agentId = `p1-test-invalid-${process.pid}`;
    const file = join(policiesDir, `${agentId}.json`);
    writeFileSync(file, JSON.stringify({ profile: "conservative" }), "utf-8"); // missing limits/flags
    try {
      const { result } = withWarnSpy(() => loadAgentPolicy(agentId));
      assert.strictEqual(result.profile, "conservative");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("valid custom policy file still loads verbatim", () => {
    const agentId = `p1-test-valid-${process.pid}`;
    const file = join(policiesDir, `${agentId}.json`);
    writeFileSync(file, JSON.stringify(POLICY_PROFILES.advanced), "utf-8");
    try {
      assert.strictEqual(loadAgentPolicy(agentId).profile, "advanced");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("unknown agentId keeps the existing default-policy behavior", () => {
    const policy = loadAgentPolicy(`p1-test-nonexistent-${process.pid}`);
    // Repo ships .agents/policies/default.json (balanced); hardcoded fallback is balanced too.
    assert.strictEqual(policy.profile, "balanced");
  });
});

describe("replay-store failure messages are sanitized in production", () => {
  const leaky = new Error("getaddrinfo ENOTFOUND secret-instance.upstash.io — /data/.safehands/x402_replay.json EACCES");

  it("production → generic message with no store internals", () => {
    const msg = replayStoreUnavailableMessage(leaky, true);
    assert.ok(!msg.includes("upstash"), "must not leak the Redis hostname");
    assert.ok(!msg.includes("/data"), "must not leak filesystem paths");
    assert.ok(msg.toLowerCase().includes("unavailable"));
  });

  it("non-production keeps the diagnostic detail", () => {
    const msg = replayStoreUnavailableMessage(leaky, false);
    assert.ok(msg.includes("ENOTFOUND"));
  });
});

describe("token-security network metadata reflects the active network", () => {
  it("active chain id reports the active environment and mainnet flag", () => {
    assert.deepStrictEqual(tokenSecurityNetworkMetadata(CHAIN_ID), {
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
    });
  });

  it("unknown chain id reports custom-chain and never claims mainnet", () => {
    const meta = tokenSecurityNetworkMetadata(999999);
    assert.strictEqual(meta.environment, "custom-chain");
    assert.strictEqual(meta.isMainnet, false);
  });
});
