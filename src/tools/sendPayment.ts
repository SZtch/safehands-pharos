// ─── Tool: send_payment ────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { isAddress, parseEther, formatEther } from "viem";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { MAX_BALANCE_USAGE_PCT, MAX_TX_AMOUNT_PROS, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET } from "../lib/constants.js";
import { requireManagedExecutionReady, isManagedExecutionFailure } from "../lib/managedExecution.js";
import { evaluateActionPolicy, riskEvidenceFromAssessment } from "../lib/policy/actionPolicyEngine.js";
import { enforceWriteDecision } from "../lib/policy/writeExecutionGate.js";
import { checkDailyLimit, reserveDailyLimit, releaseReservation, estimateUsd } from "../lib/spendAccumulator.js";
import { validatePositiveAmount, validateNonZeroAddress, collectErrors } from "../lib/validation.js";

export const sendPaymentSchema = z.object({
  toAddress: z.string(),
  amount: z.string(),
  memo: z.string().optional(),
  agentId: z.string().optional().describe("Managed wallet agentId when WALLET_MODE=managed-mainnet"),
  confirm: z.boolean().optional().default(false).describe("Explicit acknowledgement to proceed when SafeHands returns REQUIRE_CONFIRMATION (e.g. unverified recipient). Hard BLOCK / denylist / over-limit are never overridable."),
}).strict();

export type SendPaymentInput = z.input<typeof sendPaymentSchema>;

export const sendPaymentTool = {
  name: "send_payment",
  description: "Send native PROS with pre-flight validation. Checks address validity, balance sufficiency, and warns on high exposure. Gated by WRITE_TOOLS_ENABLED.",
  inputSchema: sendPaymentSchema,
};

export async function handleSendPayment(raw: SendPaymentInput) {
  let input: z.infer<typeof sendPaymentSchema>;
  try {
    input = sendPaymentSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `send_payment input validation failed: ${msg}`, false, "send_payment");
  }

  const fieldErrors = collectErrors([
    validatePositiveAmount(input.amount, "amount"),
    validateNonZeroAddress(input.toAddress, "toAddress"),
  ]);
  if (fieldErrors.length > 0) {
    return fail("VALIDATION_ERROR", fieldErrors.join(" "), false, "send_payment");
  }

  const gate = await requireManagedExecutionReady("send_payment", input.agentId);
  if (isManagedExecutionFailure(gate)) return gate;
  const { signer } = gate;
  const walletAddress = signer.address;

  if (Number(input.amount) > Number(MAX_TX_AMOUNT_PROS)) {
    return fail("TX_LIMIT_EXCEEDED", `Payment amount exceeds the operator ceiling MAX_TX_AMOUNT_PROS (${MAX_TX_AMOUNT_PROS} PROS), which bounds all agent policies. Raise MAX_TX_AMOUNT_PROS to allow larger mainnet payments.`, false, "send_payment");
  }

  const amountUsd = estimateUsd(input.amount, "PROS");
  const dailyCheck = checkDailyLimit(walletAddress, amountUsd);
  if (!dailyCheck.allowed) {
    return fail(
      "DAILY_SPEND_LIMIT_EXCEEDED",
      `Daily spend limit reached. Spent $${dailyCheck.currentUsd.toFixed(2)} of $${dailyCheck.limitUsd.toFixed(2)} USD today. Remaining: $${dailyCheck.remainingUsd.toFixed(2)}. Resets at UTC midnight.`,
      false,
      "send_payment"
    );
  }

  const warnings: string[] = [];
  const validation = { addressValid: false, balanceSufficient: false, warnings };

  if (!isAddress(input.toAddress)) {
    return fail("INVALID_WALLET_ADDRESS", "Invalid recipient address", false, "send_payment");
  }
  validation.addressValid = true;

  if (input.toAddress === "0x0000000000000000000000000000000000000000") {
    return fail("ZERO_ADDRESS_BLOCKED", "Cannot send to zero address", false, "send_payment");
  }
  if (input.toAddress.toLowerCase() === walletAddress.toLowerCase()) {
    warnings.push("Sending to own address");
  }

  const amountWei = parseEther(input.amount);
  const balance = await publicClient.getBalance({ address: walletAddress });
  const gasEstimate = parseEther("0.01");

  if (balance < amountWei + gasEstimate) {
    return fail("INSUFFICIENT_BALANCE", `Insufficient balance: have ${formatEther(balance)} PROS, need ${input.amount} + gas`, false, "send_payment");
  }
  validation.balanceSufficient = true;

  const usagePct = Number((amountWei * 100n) / balance);
  if (usagePct > MAX_BALANCE_USAGE_PCT) {
    warnings.push(`Using ${usagePct}% of wallet balance; high exposure`);
  }

  const risk = await assessRisk({
    action: "transfer",
    amount: input.amount,
    toAddress: input.toAddress,
    walletAddress,
  });

  // Sole decision point: ONE policy evaluation over all collected evidence,
  // including the advisory risk assessment. Never gate on riskEngine output
  // directly — the policy engine's risk_* checks do that (never-weaken parity
  // with the former direct gates; requireRiskEvidence makes a wiring miss fail
  // closed instead of silently losing the risk gates).
  const policy = evaluateActionPolicy({
    actionType: "send_payment",
    agentId: input.agentId,
    amount: input.amount,
    amountUnit: "PROS",
    recipient: input.toAddress,
    recipientVerified: false,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: IS_MAINNET,
    signerAvailable: true,
    requiresSigner: true,
    risk: riskEvidenceFromAssessment(risk),
  });
  const paymentGate = enforceWriteDecision(policy, { confirmed: input.confirm === true, toolName: "send_payment", requireRiskEvidence: true });
  if (paymentGate) return paymentGate;

  // M2: atomically reserve the daily-spend budget immediately before broadcasting
  // (no await between reserve and send), so concurrent calls can't both exceed the cap.
  const reservation = reserveDailyLimit(walletAddress, amountUsd);
  if (!reservation.allowed) {
    return fail(
      "DAILY_SPEND_LIMIT_EXCEEDED",
      `Daily spend limit reached. Spent $${reservation.currentUsd.toFixed(2)} of $${reservation.limitUsd.toFixed(2)} USD today. Remaining: $${reservation.remainingUsd.toFixed(2)}. Resets at UTC midnight.`,
      false,
      "send_payment"
    );
  }

  try {
    const wallet = createPharosWalletClientFromAccount(signer.account);
    const txHash = await wallet.sendTransaction({
      to: input.toAddress as `0x${string}`,
      value: amountWei,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      releaseReservation(walletAddress, amountUsd);
      return fail("TX_REVERTED", "send_payment transaction was mined but reverted on-chain.", false, "send_payment");
    }

    return ok({
      txHash,
      explorerUrl: getExplorerUrl(txHash),
      amountSent: input.amount,
      signerMode: signer.mode,
      walletAddress,
      gasUsed: receipt.gasUsed.toString(),
      validation,
      policy,
      riskAssessment: {
        riskScore: risk.riskScore,
        wasBlocked: false,
      },
      source: "send_payment",
    });
  } catch (err) {
    releaseReservation(walletAddress, amountUsd);
    return classifyExternalError("pharos_rpc", err);
  }
}
