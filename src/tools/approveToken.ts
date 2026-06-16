// ─── Tool: approve_token ───────────────────────────────────────────────
// Approves ERC-20 token spending for DODO swap router.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { DODO_APPROVE_ADDRESS, USDC_ADDRESS, USDT_ADDRESS, ERC20_ABI, MAX_APPROVAL_AMOUNT_USDC, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { resolveTokenDecimals, toWei } from "../lib/dodoApi.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { requireManagedExecutionReady, isManagedExecutionFailure } from "../lib/managedExecution.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { validatePositiveAmount } from "../lib/validation.js";

export const approveTokenSchema = z.object({
  token: z.enum(["USDC", "USDT"]).describe("ERC-20 token to approve"),
  amount: z.string().describe("Human-readable amount to approve, or 'max' for unlimited"),
  agentId: z.string().optional().describe("Managed testnet wallet agentId when WALLET_MODE=managed-testnet"),
}).strict();

export type ApproveTokenInput = z.input<typeof approveTokenSchema>;

export const approveTokenTool = {
  name: "approve_token",
  description:
    "Approve ERC-20 token spending for FaroSwap (DODO) router. Required before swapping non-native tokens.",
  inputSchema: approveTokenSchema,
};

export async function handleApproveToken(raw: ApproveTokenInput) {
  let input: z.infer<typeof approveTokenSchema>;
  try {
    input = approveTokenSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `approve_token input validation failed: ${msg}`, false, "approve_token");
  }

  if (input.amount !== "max") {
    const amtErr = validatePositiveAmount(input.amount, "amount");
    if (amtErr) return fail("VALIDATION_ERROR", amtErr, false, "approve_token");
  }

  const gate = await requireManagedExecutionReady("approve_token", input.agentId);
  if (isManagedExecutionFailure(gate)) return gate;
  const { signer } = gate;

  const policy = evaluateActionPolicy({
    actionType: "approve_token",
    agentId: input.agentId,
    approvalAmount: input.amount,
    approvalToken: input.token,
    approvalUnlimited: input.amount === "max",
    spender: DODO_APPROVE_ADDRESS,
    spenderVerified: true,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
    signerAvailable: true,
    requiresSigner: true,
    allowUnlimitedApproval: process.env.ALLOW_UNLIMITED_APPROVAL === "true",
  });
  if (policy.decision === "BLOCK") {
    const code = input.amount === "max" ? "UNLIMITED_APPROVAL_BLOCKED" : "POLICY_BLOCKED";
    return fail(code, policy.reasons.join(" ") || "Approval blocked by SafeHands policy.", false, "approve_token");
  }

  if (input.amount !== "max" && Number(input.amount) > Number(MAX_APPROVAL_AMOUNT_USDC)) {
    return fail("APPROVAL_LIMIT_EXCEEDED", `Approval amount exceeds the operator ceiling MAX_APPROVAL_AMOUNT_USDC (${MAX_APPROVAL_AMOUNT_USDC}), which bounds all agent policies. Raise MAX_APPROVAL_AMOUNT_USDC to allow larger testnet approvals.`, false, "approve_token");
  }

  const tokenAddress = input.token === "USDC" ? USDC_ADDRESS : USDT_ADDRESS;
  const decimals = resolveTokenDecimals(input.token);

  const approveAmount =
    input.amount === "max"
      ? 2n ** 256n - 1n
      : BigInt(toWei(input.amount, decimals));

  try {
    const wallet = createPharosWalletClientFromAccount(signer.account);

    const txHash = await wallet.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [DODO_APPROVE_ADDRESS, approveAmount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      return fail("TX_REVERTED", "approve_token transaction was mined but reverted on-chain.", false, "approve_token");
    }

    return ok({
      txHash,
      explorerUrl: getExplorerUrl(txHash),
      token: input.token,
      tokenAddress,
      approvedAmount: input.amount === "max" ? "unlimited" : input.amount,
      spender: DODO_APPROVE_ADDRESS,
      signerMode: signer.mode,
      walletAddress: signer.address,
      gasUsed: receipt.gasUsed.toString(),
      policy,
      source: "approve_token",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
