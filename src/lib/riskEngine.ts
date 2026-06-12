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
} from "./dodoApi.js";
import {
  RISK_WEIGHTS,
  RISK_BLOCK_THRESHOLD,
  RISK_WARN_THRESHOLD,
  MAX_SLIPPAGE_PCT,
  MAX_BALANCE_USAGE_PCT,
  ERC20_ABI,
  DODO_ROUTE_PROXY_ADDRESS,
} from "./constants.js";
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

async function scoreLiquidity(input: RiskInput): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];

  if (input.action !== "swap") return { score: 0, reasons };

  try {
    const quote = await getDodoRoute({
      fromToken: input.tokenIn!,
      toToken: input.tokenOut!,
      amountHuman: input.amount,
      walletAddress: input.walletAddress,
    });

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
  } catch (err) {
    reasons.push(`Failed to fetch liquidity data: ${(err as Error).message}`);
    return { score: 70, reasons };
  }
}

async function scoreSlippage(input: RiskInput): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];

  if (input.action !== "swap") return { score: 0, reasons };

  try {
    const quote = await getDodoRoute({
      fromToken: input.tokenIn!,
      toToken: input.tokenOut!,
      amountHuman: input.amount,
      walletAddress: input.walletAddress,
    });

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
  } catch {
    reasons.push("Slippage estimation failed");
    return { score: 60, reasons };
  }
}

async function scoreCounterparty(input: RiskInput): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];

  if (input.action === "swap") {
    // For swaps, counterparty is the DODO protocol — trusted
    reasons.push("Swap routed through DODO protocol (known)");
    return { score: 5, reasons };
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

async function scoreBalance(input: RiskInput): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];

  try {
    const walletAddr = input.walletAddress as `0x${string}`;

    if (input.action === "transfer" || (input.action === "swap" && isNativeToken(input.tokenIn || "PHRS"))) {
      // Check native PHRS balance
      const balance = await publicClient.getBalance({ address: walletAddr });
      const amountWei = parseEther(input.amount);
      const gasBuffer = parseEther("0.01"); // ~0.01 PHRS for gas

      if (balance < amountWei + gasBuffer) {
        const balanceHuman = formatEther(balance);
        reasons.push(`Insufficient PHRS balance: have ${balanceHuman}, need ${input.amount} + gas`);
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
        reasons.push("Very low PHRS balance for gas fees");
        return { score: 80, reasons };
      }

      reasons.push("Token and gas balance sufficient");
      return { score: 5, reasons };
    }

    return { score: 0, reasons: ["Balance check skipped"] };
  } catch (err) {
    reasons.push(`Balance check failed: ${(err as Error).message}`);
    return { score: 50, reasons };
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
  const [liquidity, slippage, counterparty, balance, market] = await Promise.all([
    scoreLiquidity(input),
    scoreSlippage(input),
    scoreCounterparty(input),
    scoreBalance(input),
    scoreMarketCondition(input),
  ]);

  const breakdown: RiskBreakdown = {
    liquidityRisk: liquidity.score,
    slippageRisk: slippage.score,
    counterpartyRisk: counterparty.score,
    balanceRisk: balance.score,
    marketConditionRisk: market.score,
  };

  const riskScore = clamp(weightedAverage(breakdown));
  const riskLevel = computeRiskLevel(riskScore);
  const recommendation = computeRecommendation(riskScore);

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
  };
}
