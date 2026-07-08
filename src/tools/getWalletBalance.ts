// ─── Tool: get_wallet_balance ──────────────────────────────────────────
// Returns native PROS and active-network ERC-20 balances for a wallet using
// viem reads. USD valuation comes from the PriceResolver (Chainlink Push
// Engine feeds); balances always succeed even when prices are unavailable.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { ERC20_ABI, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, activeTokenMap, activeTokenDecimals } from "../lib/constants.js";
import { resolvePriceUsd } from "../lib/price/priceResolver.js";
import { formatEther, formatUnits, isAddress } from "viem";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";

export const getWalletBalanceSchema = z.object({
  walletAddress: z.string().describe("Wallet address to check balances for"),
});

export type GetWalletBalanceInput = z.input<typeof getWalletBalanceSchema>;

export const getWalletBalanceTool = {
  name: "get_wallet_balance",
  description:
    "Return PROS and supported active-network token balances for a wallet on Pharos, with total USD estimate.",
  inputSchema: getWalletBalanceSchema,
};

type PriceLegStatus = "ok" | "rpc_degraded_cache" | "unavailable" | "not_needed";

async function priceLeg(symbol: string): Promise<{ status: PriceLegStatus; priceUsd: number }> {
  const result = await resolvePriceUsd(symbol);
  if (result.ok) {
    return { status: result.resolution.sourceStatus, priceUsd: result.resolution.priceUsdNumber };
  }
  return { status: "unavailable", priceUsd: 0 };
}

async function readTokenBalance(address: `0x${string}`, tokenAddress: `0x${string}`, decimals: number, symbol: string) {
  const raw = (await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;
  return {
    symbol,
    raw,
    formatted: formatUnits(raw, decimals),
    decimals,
    tokenAddress,
  };
}

export async function handleGetWalletBalance(raw: GetWalletBalanceInput) {
  const input = getWalletBalanceSchema.parse(raw);
  if (!isAddress(input.walletAddress)) {
    return fail("INVALID_WALLET_ADDRESS", `Invalid wallet address: ${input.walletAddress}`, false, "get_wallet_balance");
  }
  const addr = input.walletAddress as `0x${string}`;
  const tokenMap = activeTokenMap();
  const decimalsMap = activeTokenDecimals();

  try {
    const prosBalanceWei = await publicClient.getBalance({ address: addr });
    const prosBalance = formatEther(prosBalanceWei);

    const supportedTokenReads = await Promise.all(
      (["USDC", "USDT"] as const).map(async (symbol) => {
        const tokenAddress = tokenMap[symbol];
        if (!tokenAddress) return { symbol, unsupported: true as const };
        return readTokenBalance(addr, tokenAddress, decimalsMap[symbol] ?? decimalsMap[tokenAddress.toLowerCase()] ?? 18, symbol);
      })
    );

    const usdcResult = supportedTokenReads.find((r) => r.symbol === "USDC");
    const usdtResult = supportedTokenReads.find((r) => r.symbol === "USDT");
    const usdcBalance = usdcResult && "formatted" in usdcResult ? usdcResult.formatted : "0";
    const usdtBalance = usdtResult && "formatted" in usdtResult ? usdtResult.formatted : "0";

    // Price legs run SEQUENTIALLY (never Promise.all — public RPC rate-limits
    // parallel eth_call bursts) and only for assets that are actually held.
    // PROS is always priced because prosPrice is a top-level response field.
    const prosLeg = await priceLeg("PROS");
    const usdcLeg =
      usdcResult && "formatted" in usdcResult && parseFloat(usdcBalance) > 0
        ? await priceLeg("USDC")
        : { status: "not_needed" as const, priceUsd: 0 };
    const usdtLeg =
      usdtResult && "formatted" in usdtResult && parseFloat(usdtBalance) > 0
        ? await priceLeg("USDT")
        : { status: "not_needed" as const, priceUsd: 0 };

    const prosValueUsd = parseFloat(prosBalance) * prosLeg.priceUsd;
    const usdcValueUsd = parseFloat(usdcBalance) * usdcLeg.priceUsd;
    const usdtValueUsd = parseFloat(usdtBalance) * usdtLeg.priceUsd;
    const totalUsd = (prosValueUsd + usdcValueUsd + usdtValueUsd).toFixed(4);

    const attempted = [prosLeg, usdcLeg, usdtLeg].filter((leg) => leg.status !== "not_needed");
    const failedCount = attempted.filter((leg) => leg.status === "unavailable").length;
    const priceSourceStatus =
      failedCount === attempted.length
        ? "unavailable"
        : failedCount > 0
          ? "partial"
          : attempted.some((leg) => leg.status === "rpc_degraded_cache")
            ? "rpc_degraded_cache"
            : "ok";

    return ok({
      walletAddress: input.walletAddress,
      balances: {
        PROS: {
          balance: { value: prosBalance, unit: "PROS" },
          valueUsd: { value: prosValueUsd.toFixed(4), unit: "USD" },
          priceStatus: prosLeg.status,
        },
        USDC: usdcResult && "formatted" in usdcResult
          ? {
              balance: { value: usdcBalance, unit: "USDC" },
              valueUsd: { value: usdcValueUsd.toFixed(4), unit: "USD" },
              priceStatus: usdcLeg.status,
              tokenAddress: usdcResult.tokenAddress,
              decimals: usdcResult.decimals,
            }
          : { supported: false, reason: `USDC is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}).` },
        USDT: usdtResult && "formatted" in usdtResult
          ? {
              balance: { value: usdtBalance, unit: "USDT" },
              valueUsd: { value: usdtValueUsd.toFixed(4), unit: "USD" },
              priceStatus: usdtLeg.status,
              tokenAddress: usdtResult.tokenAddress,
              decimals: usdtResult.decimals,
            }
          : { supported: false, reason: `USDT is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}); no fallback/testnet address was queried.` },
      },
      totalUsd: { value: totalUsd, unit: "USD" },
      prosPrice: prosLeg.priceUsd > 0 ? { value: prosLeg.priceUsd.toFixed(4), unit: "USD" } : null,
      priceSourceStatus,
      priceDetail: { PROS: prosLeg.status, USDC: usdcLeg.status, USDT: usdtLeg.status },
      priceSource: "chainlink_push_feed",
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
      source: "pharos_rpc",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
