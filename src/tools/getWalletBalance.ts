// ─── Tool: get_wallet_balance ──────────────────────────────────────────
// Returns PHRS, USDC, USDT balances for a wallet using viem reads.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { getDodoRoute } from "../lib/dodoApi.js";
import { USDC_ADDRESS, USDT_ADDRESS, ERC20_ABI, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { formatEther, formatUnits, isAddress } from "viem";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";

export const getWalletBalanceSchema = z.object({
  walletAddress: z.string().describe("Wallet address to check balances for"),
});

export type GetWalletBalanceInput = z.input<typeof getWalletBalanceSchema>;

export const getWalletBalanceTool = {
  name: "get_wallet_balance",
  description:
    "Return PHRS (native), USDC, and USDT balances for a wallet on Pharos Atlantic Testnet, with total USD estimate.",
  inputSchema: getWalletBalanceSchema,
};

const QUOTE_WALLET = "0x0000000000000000000000000000000000000001";

export async function handleGetWalletBalance(raw: GetWalletBalanceInput) {
  const input = getWalletBalanceSchema.parse(raw);
  if (!isAddress(input.walletAddress)) {
    return fail("INVALID_WALLET_ADDRESS", `Invalid wallet address: ${input.walletAddress}`, false, "get_wallet_balance");
  }
  const addr = input.walletAddress as `0x${string}`;

  try {
    const [phrsBalanceWei, usdcBalanceRaw, usdtBalanceRaw] = await Promise.all([
      publicClient.getBalance({ address: addr }),
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [addr],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [addr],
      }) as Promise<bigint>,
    ]);

    const phrsBalance = formatEther(phrsBalanceWei);
    const usdcBalance = formatUnits(usdcBalanceRaw, 6);
    const usdtBalance = formatUnits(usdtBalanceRaw, 6);

    let phrsUsd = 0;
    let priceSourceStatus = "unavailable";
    try {
      const quote = await getDodoRoute({
        fromToken: "PHRS",
        toToken: "USDC",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });
      if (quote.routeAvailable) {
        phrsUsd = parseFloat(quote.amountOut);
        priceSourceStatus = "ok";
      } else {
        priceSourceStatus = "no_route_available";
      }
    } catch {
      priceSourceStatus = "unavailable";
    }

    const phrsValueUsd = parseFloat(phrsBalance) * phrsUsd;
    const usdcValueUsd = parseFloat(usdcBalance);
    const usdtValueUsd = parseFloat(usdtBalance);
    const totalUsd = (phrsValueUsd + usdcValueUsd + usdtValueUsd).toFixed(4);

    return ok({
      walletAddress: input.walletAddress,
      balances: {
        PHRS: { balance: { value: phrsBalance, unit: "PHRS" }, valueUsd: { value: phrsValueUsd.toFixed(4), unit: "USD" } },
        USDC: { balance: { value: usdcBalance, unit: "USDC" }, valueUsd: { value: usdcValueUsd.toFixed(4), unit: "USD" } },
        USDT: { balance: { value: usdtBalance, unit: "USDT" }, valueUsd: { value: usdtValueUsd.toFixed(4), unit: "USD" } },
      },
      totalUsd: { value: totalUsd, unit: "USD" },
      phrsPrice: phrsUsd > 0 ? { value: phrsUsd.toFixed(4), unit: "USD" } : null,
      priceSourceStatus,
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: false,
      source: "pharos_rpc",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
