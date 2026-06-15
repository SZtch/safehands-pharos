// ─── get_agent_wallet_balance ───────────────────────────────────────────
// Returns PHRS + token balances for a managed agent wallet.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { ok, fail, classifyExternalError, type ToolResponse } from "../lib/toolResponse.js";
import { walletStore } from "../lib/wallet/index.js";
import { publicClient } from "../lib/pharosClient.js";
import { TOKEN_REGISTRY, EXPLORER_BASE } from "../lib/constants.js";
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
    const [phrsRaw, usdcRaw, usdtRaw] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: TOKEN_REGISTRY.USDC.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      }),
      publicClient.readContract({
        address: TOKEN_REGISTRY.USDT.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    const phrs = formatUnits(phrsRaw as bigint, 18);
    const usdc = formatUnits(usdcRaw as bigint, 6);
    const usdt = formatUnits(usdtRaw as bigint, 6);
    const isFunded = parseFloat(phrs) > 0;

    return ok({
      agentId,
      address,
      environment: wallet.environment,
      chainId: wallet.chainId,
      isMainnet: false,
      explorerUrl: `https://atlantic.pharosscan.xyz/address/${address}`,
      balances: {
        PHRS: { value: phrs, unit: "PHRS", decimals: 18 },
        USDC: { value: usdc, unit: "USDC", decimals: 6 },
        USDT: { value: usdt, unit: "USDT", decimals: 6 },
      },
      isFunded,
      fundingInstructions: isFunded
        ? null
        : `Wallet is unfunded. Get testnet PHRS from https://testnet.pharosnetwork.xyz/ — wallet address: ${address}`,
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
