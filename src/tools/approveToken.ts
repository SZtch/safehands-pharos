// ─── Tool: approve_token ───────────────────────────────────────────────
// Approves ERC-20 token spending for an EXPLICIT, caller-provided spender.
// There is no default spender: the former DODO_APPROVE_ADDRESS default silently
// approved a testnet-provenance address on mainnet while stamping
// spenderVerified:true — a fabricated claim. Spender verification now comes
// only from the ecosystem registry (addressTrustEvidence); anything else is an
// unverified claim and the policy engine requires explicit confirmation.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { isAddress } from "viem";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { ERC20_ABI, MAX_APPROVAL_AMOUNT_USDC, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, activeTokenMap, activeTokenDecimals } from "../lib/constants.js";
import { addressTrustEvidence } from "../lib/ecosystemRegistry.js";
import { toWei } from "../lib/dodoApi.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { requireManagedExecutionReady, isManagedExecutionFailure } from "../lib/managedExecution.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { enforceWriteDecision } from "../lib/policy/writeExecutionGate.js";
import { evaluateTokenSecurityGate } from "./checkTokenSecurity.js";
import { validatePositiveAmount } from "../lib/validation.js";

export const approveTokenSchema = z.object({
  token: z.enum(["USDC", "USDT"]).describe("ERC-20 token to approve"),
  amount: z.string().describe("Human-readable amount to approve, or 'max' for unlimited"),
  spender: z.string().describe("EXPLICIT spender contract address to approve (0x…). There is no default spender; SafeHands never picks one for you. Verification is derived from the ecosystem registry; unverified spenders require confirm=true."),
  agentId: z.string().optional().describe("Managed wallet agentId when WALLET_MODE=managed-mainnet"),
  confirm: z.boolean().optional().default(false).describe("Explicit acknowledgement to proceed when SafeHands returns REQUIRE_CONFIRMATION / REQUIRE_TOKEN_REVIEW. Hard BLOCK / honeypot / unlimited / over-limit are never overridable."),
}).strict();

export type ApproveTokenInput = z.input<typeof approveTokenSchema>;

export const approveTokenTool = {
  name: "approve_token",
  description:
    "Approve ERC-20 token spending for an explicit spender address you provide. Spender trust is derived from the SafeHands ecosystem registry (never asserted blindly); approvals to unverified spenders require explicit confirmation, and unlimited approvals are blocked by default. Gated by WRITE_TOOLS_ENABLED.",
  inputSchema: approveTokenSchema,
};

function resolveApprovalToken(symbol: "USDC" | "USDT") {
  const map = activeTokenMap();
  const decimals = activeTokenDecimals();
  const tokenAddress = map[symbol];
  if (!tokenAddress) {
    return null;
  }
  return {
    tokenAddress,
    decimals: decimals[symbol] ?? decimals[tokenAddress.toLowerCase()] ?? 18,
  };
}

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

  if (!isAddress(input.spender)) {
    return fail("VALIDATION_ERROR", `spender must be a valid EVM address (got "${input.spender}").`, false, "approve_token");
  }
  const spender = input.spender as `0x${string}`;
  // Registry-derived trust — the ONLY source of a spenderVerified assertion.
  // Not verified ⇒ pass undefined so the policy engine treats the spender as an
  // unverified claim (spender_reputation: unknown → REQUIRE_CONFIRMATION).
  const spenderEvidence = addressTrustEvidence(spender, CHAIN_ID);

  const resolved = resolveApprovalToken(input.token);
  if (!resolved) {
    return fail(
      "UNSUPPORTED_TOKEN",
      `${input.token} is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}). Use a supported active-network token such as USDC, or add a verified ${input.token} address before approving.`,
      false,
      "approve_token"
    );
  }

  const gate = await requireManagedExecutionReady("approve_token", input.agentId);
  if (isManagedExecutionFailure(gate)) return gate;
  const { signer } = gate;

  // Consult token-security (GoPlus) on the token being approved. Honeypot /
  // extreme-tax → hard block; flagged/unavailable → REQUIRE_TOKEN_REVIEW.
  const sec = await evaluateTokenSecurityGate(resolved.tokenAddress);
  if (sec.verdict === "block") {
    return fail("TOKEN_SECURITY_BLOCKED", `Approval blocked: ${sec.detail ?? "token failed security review"} ${sec.flags.join("; ")}`.trim(), false, "approve_token");
  }

  const policy = evaluateActionPolicy({
    actionType: "approve_token",
    agentId: input.agentId,
    approvalAmount: input.amount,
    approvalToken: input.token,
    approvalUnlimited: input.amount === "max",
    tokenSecurityStatus: sec.policyStatus,
    spender,
    spenderVerified: spenderEvidence.verifiedCanonical ? true : undefined,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: IS_MAINNET,
    signerAvailable: true,
    requiresSigner: true,
    allowUnlimitedApproval: process.env.ALLOW_UNLIMITED_APPROVAL === "true",
  });
  if (policy.decision === "BLOCK" && input.amount === "max") {
    return fail("UNLIMITED_APPROVAL_BLOCKED", policy.reasons.join(" ") || "Unlimited approval blocked by SafeHands policy.", false, "approve_token");
  }
  const approvalGate = enforceWriteDecision(policy, { confirmed: input.confirm === true, toolName: "approve_token" });
  if (approvalGate) return approvalGate;

  if (input.amount !== "max" && Number(input.amount) > Number(MAX_APPROVAL_AMOUNT_USDC)) {
    return fail("APPROVAL_LIMIT_EXCEEDED", `Approval amount exceeds the operator ceiling MAX_APPROVAL_AMOUNT_USDC (${MAX_APPROVAL_AMOUNT_USDC}), which bounds all agent policies. Raise MAX_APPROVAL_AMOUNT_USDC to allow larger mainnet approvals.`, false, "approve_token");
  }

  const { tokenAddress, decimals } = resolved;
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
      args: [spender, approveAmount],
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
      spender,
      spenderVerified: spenderEvidence.verifiedCanonical,
      spenderRegistryEvidence: spenderEvidence.recognized || spenderEvidence.note
        ? {
            recognized: spenderEvidence.recognized,
            verifiedCanonical: spenderEvidence.verifiedCanonical,
            label: spenderEvidence.contractLabel,
            item: spenderEvidence.itemId,
            verificationStatus: spenderEvidence.verificationStatus,
            note: spenderEvidence.note,
          }
        : null,
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
