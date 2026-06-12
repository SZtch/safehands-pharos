// ─── Tool: check_allowance ─────────────────────────────────────────────
// Checks ERC-20 token allowance for DODO_APPROVE_ADDRESS.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import {
  DODO_APPROVE_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  ERC20_ABI,
} from "../lib/constants.js";
import { formatUnits } from "viem";

export const checkAllowanceSchema = z.object({
  walletAddress: z.string().describe("Wallet address to check allowance for"),
  token: z.enum(["USDC", "USDT"]).describe("ERC-20 token to check"),
});

export type CheckAllowanceInput = z.input<typeof checkAllowanceSchema>;

export const checkAllowanceTool = {
  name: "check_allowance",
  description:
    "Check ERC-20 token allowance granted to DODO_APPROVE_ADDRESS for swaps. Returns current allowance and whether approval is needed.",
  inputSchema: checkAllowanceSchema,
};

export async function handleCheckAllowance(raw: CheckAllowanceInput) {
  const input = checkAllowanceSchema.parse(raw);
  const walletAddr = input.walletAddress as `0x${string}`;
  const tokenAddress = input.token === "USDC" ? USDC_ADDRESS : USDT_ADDRESS;
  const decimals = 6;

  const allowanceRaw = (await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [walletAddr, DODO_APPROVE_ADDRESS],
  })) as bigint;

  const allowanceFormatted = formatUnits(allowanceRaw, decimals);

  // Consider "approved" if allowance is at least 1,000,000 tokens (typical max approval)
  const isApproved = allowanceRaw > 0n;
  const needsApproval = !isApproved;

  return {
    token: input.token,
    tokenAddress,
    walletAddress: input.walletAddress,
    spender: DODO_APPROVE_ADDRESS,
    allowance: allowanceFormatted,
    allowanceRaw: allowanceRaw.toString(),
    isApproved,
    needsApproval,
  };
}
