// ─── Tool: send_payment ────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { isAddress, parseEther, formatEther } from "viem";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, requireWriteToolsEnabled, classifyExternalError } from "../lib/toolResponse.js";
import { MAX_BALANCE_USAGE_PCT, RISK_BLOCK_THRESHOLD, MAX_TX_AMOUNT_PHRS, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";

export const sendPaymentSchema = z.object({
  toAddress: z.string(),
  amount: z.string(),
  memo: z.string().optional(),
  agentId: z.string().optional().describe("Managed testnet wallet agentId when WALLET_MODE=managed-testnet"),
});

export type SendPaymentInput = z.input<typeof sendPaymentSchema>;

export const sendPaymentTool = {
  name: "send_payment",
  description: "Send native PHRS with pre-flight validation. Checks address validity, balance sufficiency, and warns on high exposure.",
  inputSchema: sendPaymentSchema,
};

export async function handleSendPayment(raw: SendPaymentInput) {
  if (process.env.WRITE_TOOLS_ENABLED !== "true") {
    return fail(
      "WRITE_TOOLS_DISABLED",
      "send_payment is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted testnet execution.",
      false,
      "send_payment"
    );
  }

  const input = sendPaymentSchema.parse(raw);
  const signer = await getSigner(input.agentId);
  if (isSignerFailure(signer)) {
    return fail(signer.error.code, signer.error.message, false, "send_payment");
  }
  const walletAddress = signer.address;

  const policy = evaluateActionPolicy({
    actionType: "send_payment",
    amount: input.amount,
    amountUnit: "PHRS",
    recipient: input.toAddress,
    recipientVerified: false,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
    signerAvailable: true,
    requiresSigner: true,
  });
  if (policy.decision === "BLOCK") {
    return fail("POLICY_BLOCKED", policy.reasons.join(" ") || "Payment blocked by SafeHands policy.", false, "send_payment");
  }

  if (Number(input.amount) > Number(MAX_TX_AMOUNT_PHRS)) {
    return fail("TX_LIMIT_EXCEEDED", `Payment amount exceeds configured testnet limit (${MAX_TX_AMOUNT_PHRS} PHRS).`, false, "send_payment");
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
    return fail("INSUFFICIENT_TESTNET_BALANCE", `Insufficient balance: have ${formatEther(balance)} PHRS, need ${input.amount} + gas`, false, "send_payment");
  }
  validation.balanceSufficient = true;

  const usagePct = Number((amountWei * 100n) / balance);
  if (usagePct > MAX_BALANCE_USAGE_PCT) {
    warnings.push(`Using ${usagePct}% of wallet balance — high exposure`);
  }

  const risk = await assessRisk({
    action: "transfer",
    amount: input.amount,
    toAddress: input.toAddress,
    walletAddress,
  });

  if (risk.riskScore > RISK_BLOCK_THRESHOLD) {
    return fail("POLICY_BLOCKED", `Payment blocked — risk score ${risk.riskScore}/100: ${risk.suggestion}`, false, "send_payment");
  }

  try {
    const wallet = createPharosWalletClientFromAccount(signer.account);
    const txHash = await wallet.sendTransaction({
      to: input.toAddress as `0x${string}`,
      value: amountWei,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return ok({
      txSuccess: receipt.status === "success",
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
    return classifyExternalError("pharos_rpc", err);
  }
}
