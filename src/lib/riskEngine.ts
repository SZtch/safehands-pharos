// ─── Risk Scoring Engine ───────────────────────────────────────────────
// 5-dimension risk assessment engine for SafeHands.
// Weights: liquidity 25%, slippage 25%, counterparty 20%,
//          balance 15%, market conditions 15%
// ────────────────────────────────────────────────────────────────────────

import { publicClient } from "./pharosClient.js";
import {
  getDodoRoute,
  isNativeToken,
  resolveTokenAddress,
  resolveTokenDecimals,
  toWei,
  DodoNotConfiguredError,
  type DodoQuote,
} from "./dodoApi.js";
import {
  RISK_WEIGHTS,
  RISK_BLOCK_THRESHOLD,
  MAX_SLIPPAGE_PCT,
  MAX_BALANCE_USAGE_PCT,
  ERC20_ABI,
  CHAIN_ID,
} from "./constants.js";
import { addressTrustEvidence } from "./ecosystemRegistry.js";
import { formatEther, isAddress, parseEther } from "viem";

// ─── Types ─────────────────────────────────────────────────────────────

export interface RiskBreakdown {
  liquidityRisk: number;
  slippageRisk: number;
  counterpartyRisk: number;
  balanceRisk: number;
  marketConditionRisk: number;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskRecommendation = "proceed" | "caution" | "block";

export interface RiskAssessment {
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: RiskRecommendation;
  breakdown: RiskBreakdown;
  reasons: string[];
  suggestion: string;
  /**
   * True when a CRITICAL risk signal could not be evaluated (route/liquidity or
   * balance fetch failed). Callers must fail-closed on this — never silently
   * proceed on degraded data (H2). Market-condition gaps are non-critical and do
   * NOT set this.
   */
  degraded: boolean;
  degradedReasons: string[];
  /**
   * Structural (not transient): the swap liquidity provider is not configured/
   * verified for the active chain (SWAP_LIQUIDITY_NOT_CONFIGURED). Liquidity and
   * slippage dimensions were scored fail-closed without live route data.
   */
  swapProviderNotConfigured?: boolean;
}

export interface RiskInput {
  action: "swap" | "transfer";
  tokenIn?: string;
  tokenOut?: string;
  amount: string;
  toAddress?: string;
  walletAddress: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function computeRiskLevel(score: number): RiskLevel {
  if (score <= 30) return "low";
  if (score <= 60) return "medium";
  if (score <= 80) return "high";
  return "critical";
}

function computeRecommendation(score: number): RiskRecommendation {
  if (score <= 30) return "proceed";
  if (score <= RISK_BLOCK_THRESHOLD) return "caution";
  return "block";
}

function weightedAverage(breakdown: RiskBreakdown): number {
  const w = RISK_WEIGHTS;
  return Math.round(
    breakdown.liquidityRisk * w.liquidityRisk +
      breakdown.slippageRisk * w.slippageRisk +
      breakdown.counterpartyRisk * w.counterpartyRisk +
      breakdown.balanceRisk * w.balanceRisk +
      breakdown.marketConditionRisk * w.marketConditionRisk
  );
}

// ─── Individual Risk Scorers ───────────────────────────────────────────

/**
 * Pre-fetches the DODO route quote once for swap actions.
 * Both scoreLiquidity and scoreSlippage use this cached result.
 * `notConfigured` distinguishes the structural provider-not-configured state
 * (SWAP_LIQUIDITY_NOT_CONFIGURED) from a transient fetch failure.
 */
async function fetchSwapQuote(input: RiskInput): Promise<{ quote: DodoQuote | null; notConfigured: boolean }> {
  if (input.action !== "swap") return { quote: null, notConfigured: false };
  try {
    const quote = await getDodoRoute({
      fromToken: input.tokenIn!,
      toToken: input.tokenOut!,
      amountHuman: input.amount,
      walletAddress: input.walletAddress,
    });
    return { quote, notConfigured: false };
  } catch (err) {
    return { quote: null, notConfigured: err instanceof DodoNotConfiguredError };
  }
}

function scoreLiquidity(input: RiskInput, quote: DodoQuote | null, notConfigured: boolean): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (input.action !== "swap") return { score: 0, reasons };

  if (!quote) {
    reasons.push(
      notConfigured
        ? `Swap liquidity provider is not configured for chainId ${CHAIN_ID} (SWAP_LIQUIDITY_NOT_CONFIGURED) — liquidity cannot be verified on this network.`
        : "Failed to fetch liquidity data — route provider unavailable."
    );
    return { score: 70, reasons };
  }

  if (!quote.routeAvailable) {
    reasons.push("No swap route available — liquidity may be exhausted");
    return { score: 100, reasons };
  }

  const impact = Math.abs(quote.priceImpact);
  if (impact > 5) {
    reasons.push(`High price impact: ${impact.toFixed(2)}%`);
    return { score: clamp(80 + impact), reasons };
  }
  if (impact > 2) {
    reasons.push(`Moderate price impact: ${impact.toFixed(2)}%`);
    return { score: clamp(40 + impact * 10), reasons };
  }

  reasons.push(`Price impact acceptable: ${impact.toFixed(2)}%`);
  return { score: clamp(impact * 15), reasons };
}

function scoreSlippage(input: RiskInput, quote: DodoQuote | null, notConfigured: boolean): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (input.action !== "swap") return { score: 0, reasons };

  if (!quote) {
    reasons.push(
      notConfigured
        ? `Slippage cannot be estimated — swap route provider not configured for chainId ${CHAIN_ID} (SWAP_LIQUIDITY_NOT_CONFIGURED).`
        : "Slippage estimation failed — route provider unavailable."
    );
    return { score: 60, reasons };
  }

  if (!quote.routeAvailable) {
    reasons.push("Cannot estimate slippage — no route");
    return { score: 90, reasons };
  }

  const impact = Math.abs(quote.priceImpact);
  if (impact > MAX_SLIPPAGE_PCT) {
    reasons.push(`Slippage exceeds max ${MAX_SLIPPAGE_PCT}%: estimated ${impact.toFixed(2)}%`);
    return { score: clamp(80 + (impact - MAX_SLIPPAGE_PCT) * 5), reasons };
  }

  reasons.push(`Estimated slippage: ${impact.toFixed(2)}%`);
  return { score: clamp(impact * 16), reasons };
}

async function scoreCounterparty(input: RiskInput, quote: DodoQuote | null): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];

  if (input.action === "swap") {
    // Registry-driven counterparty trust ONLY. The former unconditional
    // "DODO protocol (known) → 5" relaxed risk with a testnet-provenance claim
    // that holds on no network per the ecosystem registry.
    const router = quote?.routeAvailable && isAddress(quote.to) ? quote.to : null;
    if (!router) {
      reasons.push("Swap counterparty (router) could not be determined — no route data to evaluate.");
      return { score: 55, reasons };
    }
    const evidence = addressTrustEvidence(router, CHAIN_ID);
    if (evidence.verifiedCanonical) {
      reasons.push(`Swap router ${evidence.contractLabel ?? router} is VERIFIED in the SafeHands ecosystem registry.`);
      return { score: 5, reasons };
    }
    if (evidence.recognized) {
      reasons.push(
        `Swap router matches ecosystem-registry entry "${evidence.contractLabel}" (${evidence.verificationStatus}) — recognition only, not a safety signal.`
      );
      return { score: 40, reasons };
    }
    reasons.push(
      `Swap router ${router} is not in the SafeHands ecosystem registry — unverified counterparty (the execution allowlist still constrains which router may execute at write time).`
    );
    return { score: 55, reasons };
  }

  // For transfers, check the recipient address
  const to = input.toAddress;
  if (!to) {
    reasons.push("No recipient address provided");
    return { score: 100, reasons };
  }

  if (!isAddress(to)) {
    reasons.push("Invalid EVM address format");
    return { score: 100, reasons };
  }

  // Zero address check
  if (to === "0x0000000000000000000000000000000000000000") {
    reasons.push("Sending to zero address — tokens will be burned");
    return { score: 95, reasons };
  }

  // Self-send check
  if (to.toLowerCase() === input.walletAddress.toLowerCase()) {
    reasons.push("Sending to own address — likely unintended");
    return { score: 50, reasons };
  }

  // Check if address has code (is a contract)
  try {
    const code = await publicClient.getCode({ address: to as `0x${string}` });
    if (code && code !== "0x") {
      reasons.push("Recipient is a contract address — verify intent");
      return { score: 40, reasons };
    }
  } catch {
    // RPC error, non-critical
  }

  // Check if address has any transaction history (has balance)
  try {
    const balance = await publicClient.getBalance({ address: to as `0x${string}` });
    if (balance === 0n) {
      reasons.push("Recipient has zero balance — new or unused address");
      return { score: 30, reasons };
    }
  } catch {
    // Non-critical
  }

  reasons.push("Recipient address looks valid");
  return { score: 10, reasons };
}

async function scoreBalance(input: RiskInput): Promise<{ score: number; reasons: string[]; degraded?: boolean }> {
  const reasons: string[] = [];

  try {
    const walletAddr = input.walletAddress as `0x${string}`;

    if (input.action === "transfer" || (input.action === "swap" && isNativeToken(input.tokenIn || "PROS"))) {
      // Check native PROS balance
      const balance = await publicClient.getBalance({ address: walletAddr });
      const amountWei = parseEther(input.amount);
      const gasBuffer = parseEther("0.01"); // ~0.01 PROS for gas

      if (balance < amountWei + gasBuffer) {
        const balanceHuman = formatEther(balance);
        reasons.push(`Insufficient PROS balance: have ${balanceHuman}, need ${input.amount} + gas`);
        return { score: 100, reasons };
      }

      const usagePct = Number((amountWei * 100n) / balance);
      if (usagePct > MAX_BALANCE_USAGE_PCT) {
        reasons.push(`Using ${usagePct}% of wallet balance — high exposure`);
        return { score: clamp(60 + (usagePct - MAX_BALANCE_USAGE_PCT)), reasons };
      }

      reasons.push(`Balance sufficient, using ${usagePct}% of wallet`);
      return { score: clamp(usagePct / 3), reasons };
    }

    // ERC-20 token balance check
    if (input.tokenIn) {
      const tokenAddress = resolveTokenAddress(input.tokenIn);
      const decimals = resolveTokenDecimals(input.tokenIn);
      const amountWei = BigInt(toWei(input.amount, decimals));

      const balance = (await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [walletAddr],
      })) as bigint;

      if (balance < amountWei) {
        reasons.push(`Insufficient ${input.tokenIn} balance`);
        return { score: 100, reasons };
      }

      // Also check gas balance
      const ethBalance = await publicClient.getBalance({ address: walletAddr });
      if (ethBalance < parseEther("0.005")) {
        reasons.push("Very low PROS balance for gas fees");
        return { score: 80, reasons };
      }

      reasons.push("Token and gas balance sufficient");
      return { score: 5, reasons };
    }

    return { score: 0, reasons: ["Balance check skipped"] };
  } catch (err) {
    reasons.push(`Balance check failed: ${(err as Error).message}`);
    return { score: 50, reasons, degraded: true };
  }
}

async function scoreMarketCondition(_input: RiskInput): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];

  try {
    // Check recent block production rate as a proxy for chain health
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const prevBlock = await publicClient.getBlock({
      blockNumber: latestBlock.number - 10n,
    });

    const timeDiff = Number(latestBlock.timestamp - prevBlock.timestamp);
    const avgBlockTime = timeDiff / 10;

    if (avgBlockTime > 30) {
      reasons.push(`Slow block production: ~${avgBlockTime.toFixed(1)}s/block — chain may be congested`);
      return { score: 60, reasons };
    }

    if (avgBlockTime > 15) {
      reasons.push(`Slightly elevated block times: ~${avgBlockTime.toFixed(1)}s/block`);
      return { score: 30, reasons };
    }

    // Check gas price
    const gasPrice = await publicClient.getGasPrice();
    const gasPriceGwei = Number(gasPrice) / 1e9;

    if (gasPriceGwei > 100) {
      reasons.push(`High gas price: ${gasPriceGwei.toFixed(1)} Gwei`);
      return { score: 50, reasons };
    }

    reasons.push(`Chain healthy: ~${avgBlockTime.toFixed(1)}s/block, ${gasPriceGwei.toFixed(1)} Gwei gas`);
    return { score: 5, reasons };
  } catch {
    reasons.push("Could not assess market conditions");
    return { score: 20, reasons };
  }
}

// ─── Main Risk Assessment ──────────────────────────────────────────────

export async function assessRisk(input: RiskInput): Promise<RiskAssessment> {
  // Fetch DODO route once and share between liquidity + slippage + counterparty scorers
  const { quote: swapQuote, notConfigured: swapProviderNotConfigured } = await fetchSwapQuote(input);

  const [counterparty, balance, market] = await Promise.all([
    scoreCounterparty(input, swapQuote),
    scoreBalance(input),
    scoreMarketCondition(input),
  ]);

  const liquidity = scoreLiquidity(input, swapQuote, swapProviderNotConfigured);
  const slippage = scoreSlippage(input, swapQuote, swapProviderNotConfigured);

  const breakdown: RiskBreakdown = {
    liquidityRisk: liquidity.score,
    slippageRisk: slippage.score,
    counterpartyRisk: counterparty.score,
    balanceRisk: balance.score,
    marketConditionRisk: market.score,
  };

  const riskScore = clamp(weightedAverage(breakdown));
  const riskLevel = computeRiskLevel(riskScore);
  let recommendation = computeRecommendation(riskScore);

  // H2 — fail-closed on missing CRITICAL data. A swap whose route/liquidity could
  // not be fetched, or any action whose balance check threw, must NOT be scored as
  // safe on degraded inputs. Mark degraded and refuse to "proceed" silently.
  const degradedReasons: string[] = [];
  if (input.action === "swap" && swapQuote === null) {
    degradedReasons.push(
      swapProviderNotConfigured
        ? `Swap liquidity provider is not configured for chainId ${CHAIN_ID} (SWAP_LIQUIDITY_NOT_CONFIGURED) — this is a permanent configuration state on this network, not a transient outage.`
        : "Liquidity/slippage could not be assessed — swap route fetch failed."
    );
  }
  if (balance.degraded) {
    degradedReasons.push("Wallet balance could not be verified — RPC unavailable.");
  }
  const degraded = degradedReasons.length > 0;
  if (degraded && recommendation === "proceed") {
    recommendation = "caution";
  }

  // H1 — defense-in-depth transfer block. A critically-risky counterparty
  // (missing / invalid / zero recipient) hard-blocks via the risk engine too, not
  // only via the policy engine. (Weighted heuristics alone can never cross the
  // block threshold for a transfer, so this explicit escalation is required.)
  if (input.action === "transfer" && counterparty.score >= 90) {
    recommendation = "block";
  }

  const reasons = [
    ...liquidity.reasons,
    ...slippage.reasons,
    ...counterparty.reasons,
    ...balance.reasons,
    ...market.reasons,
  ];

  let suggestion: string;
  if (recommendation === "proceed") {
    suggestion = "Risk is within acceptable range. Proceed with the transaction.";
  } else if (recommendation === "caution") {
    suggestion =
      "Moderate risk detected. Review the risk breakdown carefully before proceeding. Consider reducing the amount or adjusting parameters.";
  } else {
    suggestion =
      "High risk detected — execution blocked for safety. Review the reasons and adjust your transaction parameters significantly before retrying.";
  }

  return {
    riskScore,
    riskLevel,
    recommendation,
    breakdown,
    reasons,
    suggestion,
    degraded,
    degradedReasons,
    ...(input.action === "swap" ? { swapProviderNotConfigured } : {}),
  };
}
