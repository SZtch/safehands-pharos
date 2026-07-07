// ─── Tool: check_allowance ─────────────────────────────────────────────
// Checks ERC-20 token allowance for DODO_APPROVE_ADDRESS.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import {
  DODO_APPROVE_ADDRESS,
  ERC20_ABI,
  CHAIN_ID,
  PHAROS_ENVIRONMENT,
  activeTokenMap,
  activeTokenDecimals,
} from "../lib/constants.js";
import { formatUnits, isAddress, parseUnits } from "viem";
import { ok, fail } from "../lib/toolResponse.js";
import { lookupCanonical } from "../lib/analysis/contractIntel.js";

export const checkAllowanceSchema = z.object({
  walletAddress: z.string().describe("Wallet address to check allowance for"),
  token: z.enum(["USDC", "USDT"]).describe("ERC-20 token to check"),
  amount: z.string().optional().describe("Human-readable swap/transfer amount to check against. When provided, needsApproval is exact (allowance < amount). When omitted, only checks allowance > 0."),
});

export type CheckAllowanceInput = z.input<typeof checkAllowanceSchema>;

export const checkAllowanceTool = {
  name: "check_allowance",
  description:
    "Check ERC-20 token allowance granted to DODO_APPROVE_ADDRESS for swaps. Returns current allowance and whether approval is needed.",
  inputSchema: checkAllowanceSchema,
};

function resolveAllowanceToken(symbol: "USDC" | "USDT") {
  const map = activeTokenMap();
  const decimalsMap = activeTokenDecimals();
  const tokenAddress = map[symbol];
  if (!tokenAddress) return null;
  return {
    tokenAddress,
    decimals: decimalsMap[symbol] ?? decimalsMap[tokenAddress.toLowerCase()] ?? 18,
  };
}

export async function handleCheckAllowance(raw: CheckAllowanceInput) {
  const input = checkAllowanceSchema.parse(raw);
  if (!isAddress(input.walletAddress)) {
    return fail("INVALID_WALLET_ADDRESS", `Invalid wallet address: ${input.walletAddress}`, false, "check_allowance");
  }

  const resolved = resolveAllowanceToken(input.token);
  if (!resolved) {
    return fail(
      "UNSUPPORTED_TOKEN",
      `${input.token} is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}). No allowance query was made against a fallback/testnet address.`,
      false,
      "check_allowance"
    );
  }

  const walletAddr = input.walletAddress as `0x${string}`;
  const { tokenAddress, decimals } = resolved;

  const allowanceRaw = (await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [walletAddr, DODO_APPROVE_ADDRESS],
  })) as bigint;

  const allowanceFormatted = formatUnits(allowanceRaw, decimals);

  let isApproved: boolean;
  let needsApproval: boolean;
  let approvalNote: string;

  if (input.amount !== undefined) {
    const requiredWei = parseUnits(input.amount, decimals);
    isApproved = allowanceRaw >= requiredWei;
    needsApproval = !isApproved;
    approvalNote = `Amount-aware: allowance ${allowanceFormatted} vs required ${input.amount}`;
  } else {
    isApproved = allowanceRaw > 0n;
    needsApproval = !isApproved;
    approvalNote = "Heuristic (no amount provided): any nonzero allowance counts as approved. Pass 'amount' for an exact check.";
  }

  const spenderCanonical = lookupCanonical(DODO_APPROVE_ADDRESS);

  return ok({
    token: input.token,
    tokenAddress,
    walletAddress: input.walletAddress,
    spender: DODO_APPROVE_ADDRESS,
    spenderRecognition: { recognized: Boolean(spenderCanonical), label: spenderCanonical?.label ?? "DODO/FaroSwap approve proxy (mainnet, project-configured)" },
    allowance: allowanceFormatted,
    allowanceRaw: allowanceRaw.toString(),
    isApproved,
    needsApproval,
    approvalNote,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
  });
}
