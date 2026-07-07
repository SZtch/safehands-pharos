// ─── Tool: get_wallet_balance ──────────────────────────────────────────
// Returns native PROS and active-network ERC-20 balances for a wallet using viem reads.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { getDodoRoute } from "../lib/dodoApi.js";
import { ERC20_ABI, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, activeTokenMap, activeTokenDecimals } from "../lib/constants.js";
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

const QUOTE_WALLET = "0x0000000000000000000000000000000000000001";

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

    let prosUsd = 0;
    let priceSourceStatus = "unavailable";
    try {
      const quote = await getDodoRoute({
        fromToken: "PROS",
        toToken: "USDC",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });
      if (quote.routeAvailable) {
        prosUsd = parseFloat(quote.amountOut);
        priceSourceStatus = "ok";
      } else {
        priceSourceStatus = "no_route_available";
      }
    } catch {
      priceSourceStatus = "unavailable";
    }

    const prosValueUsd = parseFloat(prosBalance) * prosUsd;
    const usdcValueUsd = parseFloat(usdcBalance);
    const usdtValueUsd = usdtResult && "formatted" in usdtResult ? parseFloat(usdtBalance) : 0;
    const totalUsd = (prosValueUsd + usdcValueUsd + usdtValueUsd).toFixed(4);

    return ok({
      walletAddress: input.walletAddress,
      balances: {
        PROS: { balance: { value: prosBalance, unit: "PROS" }, valueUsd: { value: prosValueUsd.toFixed(4), unit: "USD" } },
        USDC: usdcResult && "formatted" in usdcResult
          ? { balance: { value: usdcBalance, unit: "USDC" }, valueUsd: { value: usdcValueUsd.toFixed(4), unit: "USD" }, tokenAddress: usdcResult.tokenAddress, decimals: usdcResult.decimals }
          : { supported: false, reason: `USDC is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}).` },
        USDT: usdtResult && "formatted" in usdtResult
          ? { balance: { value: usdtBalance, unit: "USDT" }, valueUsd: { value: usdtValueUsd.toFixed(4), unit: "USD" }, tokenAddress: usdtResult.tokenAddress, decimals: usdtResult.decimals }
          : { supported: false, reason: `USDT is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}); no fallback/testnet address was queried.` },
      },
      totalUsd: { value: totalUsd, unit: "USD" },
      prosPrice: prosUsd > 0 ? { value: prosUsd.toFixed(4), unit: "USD" } : null,
      priceSourceStatus,
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
      source: "pharos_rpc",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
