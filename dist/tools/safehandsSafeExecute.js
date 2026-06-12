// ─── Tool: safehands_safe_execute ──────────────────────────────────────
// Guarded execution wrapper so AI agents cannot bypass preflight checks.
// ───────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { fail, ok, requireWriteToolsEnabled } from "../lib/toolResponse.js";
import { handleSafeHandsPreflightCheck } from "./safehandsPreflightCheck.js";
import { handleSendPayment } from "./sendPayment.js";
import { handleApproveToken } from "./approveToken.js";
import { handleExecuteSwap } from "./executeSwap.js";
import { handleX402PayAndFetch } from "./x402PayAndFetch.js";
export const safehandsSafeExecuteSchema = z.object({
    path: z.enum(["safe_execute_send_payment", "safe_execute_approve_token", "safe_execute_swap", "safe_x402_pay_and_fetch"]),
    execute: z.boolean().optional().default(false).describe("Must be true to execute. false returns dry-run guarded report only."),
    confirmExecution: z.boolean().optional().default(false).describe("Additional explicit runtime confirmation."),
    action: z.record(z.any()).describe("Underlying tool input object"),
});
function toPreflight(path, action) {
    if (path === "safe_execute_send_payment") {
        return { actionType: "send_payment", amount: String(action.amount || ""), amountUnit: "PHRS", recipient: String(action.toAddress || ""), recipientVerified: false, requiresSigner: true, signerAvailable: true };
    }
    if (path === "safe_execute_approve_token") {
        return { actionType: "approve_token", approvalAmount: String(action.amount || ""), approvalToken: String(action.token || ""), approvalUnlimited: action.amount === "max", requiresSigner: true, signerAvailable: true };
    }
    if (path === "safe_execute_swap") {
        return { actionType: "execute_swap", amount: String(action.amountIn || ""), tokenIn: String(action.tokenIn || ""), tokenOut: String(action.tokenOut || ""), requiresSigner: true, signerAvailable: true };
    }
    return { actionType: "x402_pay_and_fetch", url: String(action.url || ""), paymentAmountUsdc: String(action.maxPaymentUsdc || "0.001"), requiresSigner: true, signerAvailable: true };
}
export async function handleSafeHandsSafeExecute(raw) {
    const input = safehandsSafeExecuteSchema.parse(raw);
    const writeGuard = requireWriteToolsEnabled("safehands_safe_execute");
    if (writeGuard)
        return writeGuard;
    const preflight = await handleSafeHandsPreflightCheck(toPreflight(input.path, input.action));
    if (!preflight.success)
        return preflight;
    const report = preflight.data;
    if (report.decision === "BLOCK") {
        return ok({
            executed: false,
            blocked: true,
            safetyReport: report,
            executionResult: null,
            source: "safehands_safe_execute",
        });
    }
    if (report.decision !== "ALLOW") {
        return fail(report.decision === "REQUIRE_CONFIRMATION" ? "CONFIRMATION_REQUIRED" : "POLICY_BLOCKED", `SafeHands did not execute because policy decision is ${report.decision}.`, false, "safehands_safe_execute");
    }
    if (!input.execute || !input.confirmExecution) {
        return ok({
            executed: false,
            dryRun: true,
            reason: "Set execute=true and confirmExecution=true to execute this allowed testnet action.",
            safetyReport: report,
            executionResult: null,
            source: "safehands_safe_execute",
        });
    }
    let executionResult;
    if (input.path === "safe_execute_send_payment")
        executionResult = await handleSendPayment(input.action);
    else if (input.path === "safe_execute_approve_token")
        executionResult = await handleApproveToken(input.action);
    else if (input.path === "safe_execute_swap")
        executionResult = await handleExecuteSwap(input.action);
    else
        executionResult = await handleX402PayAndFetch(input.action);
    return ok({
        executed: true,
        safetyReport: report,
        executionResult,
        source: "safehands_safe_execute",
    });
}
//# sourceMappingURL=safehandsSafeExecute.js.map