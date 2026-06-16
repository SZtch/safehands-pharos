import { z } from "zod";
import { formatEther } from "viem";
import { fail, ok, requireWriteToolsEnabled, type ToolResponse } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { handleSafeHandsPreflightCheck } from "./safehandsPreflightCheck.js";
import { handleSendPayment } from "./sendPayment.js";
import { handleApproveToken } from "./approveToken.js";
import { handleExecuteSwap } from "./executeSwap.js";
import { handleX402PayAndFetch } from "./x402PayAndFetch.js";
import { REQUIRE_AUTHORIZED_AGENT_FOR_WRITE, CHAIN_ID } from "../lib/constants.js";
import { checkManagedWalletAuthorization } from "../lib/riskRegistryV2.js";
import { publicClient } from "../lib/pharosClient.js";

export const safehandsSafeExecuteSchema = z.object({
  path: z.enum(["safe_execute_send_payment", "safe_execute_approve_token", "safe_execute_swap", "safe_x402_pay_and_fetch"]),
  execute: z.boolean().optional().default(false).describe("Must be true to execute. false returns dry-run guarded report only."),
  confirmExecution: z.boolean().optional().default(false).describe("Additional explicit runtime confirmation."),
  action: z.record(z.any()).describe("Underlying tool input object"),
}).strict();

export type SafeHandsSafeExecuteInput = z.input<typeof safehandsSafeExecuteSchema>;

function toPreflight(path: string, action: Record<string, unknown>, signerAvailable: boolean) {
  const agentId = typeof action.agentId === "string" ? action.agentId : undefined;
  if (path === "safe_execute_send_payment") {
    return { actionType: "send_payment" as const, agentId, amount: String(action.amount || ""), amountUnit: "PHRS" as const, recipient: String(action.toAddress || ""), recipientVerified: false, requiresSigner: true, signerAvailable };
  }
  if (path === "safe_execute_approve_token") {
    return { actionType: "approve_token" as const, agentId, approvalAmount: String(action.amount || ""), approvalToken: String(action.token || ""), approvalUnlimited: action.amount === "max", spender: String(action.spender || ""), requiresSigner: true, signerAvailable };
  }
  if (path === "safe_execute_swap") {
    return { actionType: "execute_swap" as const, agentId, amount: String(action.amountIn || ""), tokenIn: String(action.tokenIn || ""), tokenOut: String(action.tokenOut || ""), requiresSigner: true, signerAvailable };
  }
  return { actionType: "x402_pay_and_fetch" as const, agentId, url: String(action.url || ""), paymentAmountUsdc: String(action.maxPaymentUsdc || "0.001"), requiresSigner: true, signerAvailable };
}

function resolveMode(signerMode: string | undefined): string {
  if (signerMode === "managed-testnet") return "managed_execution";
  if (signerMode === "env") return "env_wallet";
  return "unknown";
}

export async function handleSafeHandsSafeExecute(raw: SafeHandsSafeExecuteInput): Promise<ToolResponse<unknown>> {
  let input: z.infer<typeof safehandsSafeExecuteSchema>;
  try {
    input = safehandsSafeExecuteSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `safe_execute input validation failed: ${msg}`, false, "safehands_safe_execute");
  }

  const writeGuard = requireWriteToolsEnabled("safehands_safe_execute");
  if (writeGuard) return writeGuard;

  const purpose = input.path === "safe_x402_pay_and_fetch" ? "x402" : "write";
  const agentId = typeof input.action.agentId === "string" ? input.action.agentId : undefined;
  const signerResult = await getSigner(agentId, { purpose });
  const signerAvailable = !isSignerFailure(signerResult);

  if (signerAvailable && signerResult.mode === "managed-testnet" && REQUIRE_AUTHORIZED_AGENT_FOR_WRITE) {
    const authCheck = await checkManagedWalletAuthorization(signerResult.address);
    if (!authCheck.authorized) {
      return fail(
        authCheck.errorCode || "AGENT_WALLET_NOT_AUTHORIZED",
        authCheck.errorMessage || "Managed wallet is not authorized in RiskRegistry V2.",
        false,
        "safehands_safe_execute"
      );
    }

    try {
      const balance = await publicClient.getBalance({ address: signerResult.address });
      if (balance === 0n) {
        return ok({
          executed: false,
          decision: "REQUIRE_FUNDING",
          requiresFunding: true,
          walletAddress: signerResult.address,
          network: "Pharos Atlantic Testnet",
          chainId: CHAIN_ID,
          mode: "managed_execution",
          source: "safehands_safe_execute",
        });
      }
    } catch {
      // RPC failed — continue, let execution attempt surface the real error
    }
  }

  const preflight = await handleSafeHandsPreflightCheck(toPreflight(input.path, input.action, signerAvailable));
  if (!preflight.success) return preflight;
  const report = preflight.data as any;

  if (report.decision === "BLOCK") {
    return ok({
      executed: false,
      blocked: true,
      safetyReport: report,
      executionResult: null,
      mode: signerAvailable ? resolveMode(signerResult.mode) : "unknown",
      source: "safehands_safe_execute",
    });
  }

  if (report.decision !== "ALLOW") {
    return fail(
      report.decision === "REQUIRE_CONFIRMATION" ? "CONFIRMATION_REQUIRED" : "POLICY_BLOCKED",
      `SafeHands did not execute because policy decision is ${report.decision}.`,
      false,
      "safehands_safe_execute"
    );
  }

  if (!input.execute || !input.confirmExecution) {
    return ok({
      executed: false,
      dryRun: true,
      reason: "Set execute=true and confirmExecution=true to execute this allowed testnet action.",
      safetyReport: report,
      executionResult: null,
      mode: signerAvailable ? resolveMode(signerResult.mode) : "unknown",
      source: "safehands_safe_execute",
    });
  }

  let executionResult: unknown;
  if (input.path === "safe_execute_send_payment") executionResult = await handleSendPayment(input.action as any);
  else if (input.path === "safe_execute_approve_token") executionResult = await handleApproveToken(input.action as any);
  else if (input.path === "safe_execute_swap") executionResult = await handleExecuteSwap(input.action as any);
  else executionResult = await handleX402PayAndFetch(input.action as any);

  const execFailed =
    executionResult &&
    typeof executionResult === "object" &&
    "success" in executionResult &&
    (executionResult as { success: unknown }).success === false;

  if (execFailed) {
    const execErr = executionResult as { error?: { code?: string; message?: string } };
    return fail(
      execErr.error?.code || "EXECUTION_FAILED",
      execErr.error?.message || "Underlying execution returned success:false.",
      false,
      "safehands_safe_execute"
    );
  }

  return ok({
    executed: true,
    safetyReport: report,
    executionResult,
    mode: signerAvailable ? resolveMode(signerResult.mode) : "unknown",
    source: "safehands_safe_execute",
  });
}
