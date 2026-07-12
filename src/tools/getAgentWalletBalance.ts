// ─── get_agent_wallet_balance ───────────────────────────────────────────
// Returns PROS + active-network token balances for a managed agent wallet.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { ok, fail, classifyExternalError, type ToolResponse } from "../lib/toolResponse.js";
import { walletStore } from "../lib/wallet/index.js";
import { publicClient } from "../lib/pharosClient.js";
import { EXPLORER_BASE, IS_MAINNET, CHAIN_ID, PHAROS_ENVIRONMENT, activeTokenMap, activeTokenDecimals } from "../lib/constants.js";
import { formatUnits } from "viem";

export const getAgentWalletBalanceSchema = z.object({
  agentId: z.string().min(1).max(64).describe("Agent wallet identifier"),
});

export type GetAgentWalletBalanceParams = z.infer<typeof getAgentWalletBalanceSchema>;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function readTokenBalance(address: `0x${string}`, symbol: "USDC" | "USDT") {
  const tokenMap = activeTokenMap();
  const decimalsMap = activeTokenDecimals();
  const tokenAddress = tokenMap[symbol];
  if (!tokenAddress) {
    return {
      symbol,
      supported: false as const,
      reason: `${symbol} is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}); no fallback/testnet address was queried.`,
    };
  }
  const decimals = decimalsMap[symbol] ?? decimalsMap[tokenAddress.toLowerCase()] ?? 18;
  const raw = (await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;
  return {
    symbol,
    supported: true as const,
    value: formatUnits(raw, decimals),
    raw: raw.toString(),
    unit: symbol,
    decimals,
    tokenAddress,
  };
}

export async function handleGetAgentWalletBalance(
  params: unknown
): Promise<ToolResponse<unknown>> {
  let parsed: GetAgentWalletBalanceParams;
  try {
    parsed = getAgentWalletBalanceSchema.parse(params);
  } catch (err) {
    const msg = err instanceof Error && "issues" in err
      ? (err as any).issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `get_agent_wallet_balance input validation failed: ${msg}`, false, "get_agent_wallet_balance");
  }
  const { agentId } = parsed;

  const wallet = await walletStore.get(agentId);
  if (!wallet) {
    return fail(
      "WALLET_NOT_FOUND",
      `No wallet found for agentId '${agentId}'. Use create_agent_wallet to create one.`,
      false,
      "wallet_store"
    );
  }

  const address = wallet.address as `0x${string}`;

  try {
    const [prosRaw, usdc, usdt] = await Promise.all([
      publicClient.getBalance({ address }),
      readTokenBalance(address, "USDC"),
      readTokenBalance(address, "USDT"),
    ]);

    const pros = formatUnits(prosRaw as bigint, 18);
    const isFunded = parseFloat(pros) > 0;

    return ok({
      agentId,
      address,
      environment: wallet.environment,
      chainId: wallet.chainId,
      activeEnvironment: PHAROS_ENVIRONMENT,
      activeChainId: CHAIN_ID,
      isMainnet: IS_MAINNET,
      explorerUrl: `${EXPLORER_BASE.replace(/\/tx\/$/, '')}/address/${address}`,
      balances: {
        PROS: { value: pros, unit: "PROS", decimals: 18 },
        USDC: usdc.supported
          ? { value: usdc.value, raw: usdc.raw, unit: "USDC", decimals: usdc.decimals, tokenAddress: usdc.tokenAddress }
          : { supported: false, reason: usdc.reason },
        USDT: usdt.supported
          ? { value: usdt.value, raw: usdt.raw, unit: "USDT", decimals: usdt.decimals, tokenAddress: usdt.tokenAddress }
          : { supported: false, reason: usdt.reason },
      },
      isFunded,
      fundingInstructions: isFunded
        ? null
        : `Wallet is unfunded. Fund it with PROS on ${PHAROS_ENVIRONMENT}; wallet address: ${address}`,
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
