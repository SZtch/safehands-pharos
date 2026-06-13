// ─── Tool: check_allowance ─────────────────────────────────────────────
// Checks ERC-20 token allowance for DODO_APPROVE_ADDRESS.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { DODO_APPROVE_ADDRESS, USDC_ADDRESS, USDT_ADDRESS, ERC20_ABI, } from "../lib/constants.js";
import { formatUnits, parseUnits } from "viem";
import { ok } from "../lib/toolResponse.js";
export const checkAllowanceSchema = z.object({
    walletAddress: z.string().describe("Wallet address to check allowance for"),
    token: z.enum(["USDC", "USDT"]).describe("ERC-20 token to check"),
    amount: z.string().optional().describe("Human-readable swap/transfer amount to check against. When provided, needsApproval is exact (allowance < amount). When omitted, only checks allowance > 0."),
});
export const checkAllowanceTool = {
    name: "check_allowance",
    description: "Check ERC-20 token allowance granted to DODO_APPROVE_ADDRESS for swaps. Returns current allowance and whether approval is needed.",
    inputSchema: checkAllowanceSchema,
};
export async function handleCheckAllowance(raw) {
    const input = checkAllowanceSchema.parse(raw);
    const walletAddr = input.walletAddress;
    const tokenAddress = input.token === "USDC" ? USDC_ADDRESS : USDT_ADDRESS;
    const decimals = 6;
    const allowanceRaw = (await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [walletAddr, DODO_APPROVE_ADDRESS],
    }));
    const allowanceFormatted = formatUnits(allowanceRaw, decimals);
    let isApproved;
    let needsApproval;
    let approvalNote;
    if (input.amount !== undefined) {
        const requiredWei = parseUnits(input.amount, decimals);
        isApproved = allowanceRaw >= requiredWei;
        needsApproval = !isApproved;
        approvalNote = `Amount-aware: allowance ${allowanceFormatted} vs required ${input.amount}`;
    }
    else {
        isApproved = allowanceRaw > 0n;
        needsApproval = !isApproved;
        approvalNote = "Heuristic (no amount provided): any nonzero allowance counts as approved. Pass 'amount' for an exact check.";
    }
    return ok({
        token: input.token,
        tokenAddress,
        walletAddress: input.walletAddress,
        spender: DODO_APPROVE_ADDRESS,
        allowance: allowanceFormatted,
        allowanceRaw: allowanceRaw.toString(),
        isApproved,
        needsApproval,
        approvalNote,
    });
}
//# sourceMappingURL=checkAllowance.js.map