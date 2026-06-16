import { z } from "zod";
import { isAddress } from "viem";
import { ok, type ToolResponse } from "../lib/toolResponse.js";
import { explainPolicyResult } from "../lib/policy/actionPolicyEngine.js";
import { handleSafeHandsPreflightCheck, safehandsPreflightCheckSchema } from "./safehandsPreflightCheck.js";
import { queryV2ForWallet } from "../lib/riskRegistryV2.js";

export const safehandsRiskReportSchema = safehandsPreflightCheckSchema.extend({
  includeChecks: z.boolean().optional().default(true),
  walletAddress: z.string().optional(),
});

export type SafeHandsRiskReportInput = z.input<typeof safehandsRiskReportSchema>;

export async function handleSafeHandsRiskReport(raw: SafeHandsRiskReportInput): Promise<ToolResponse<unknown>> {
  const input = safehandsRiskReportSchema.parse(raw);
  const preflight = await handleSafeHandsPreflightCheck(input);
  if (!preflight.success) return preflight;
  const data = preflight.data as any;

  let riskRegistry = null;
  const walletAddr = input.walletAddress || input.recipient;
  if (walletAddr && isAddress(walletAddr)) {
    try {
      riskRegistry = await queryV2ForWallet(walletAddr as `0x${string}`);
    } catch {
      riskRegistry = {
        version: "v2",
        error: "RiskRegistry unavailable; local risk evaluation still completed.",
      };
    }
  }

  return ok({
    decision: data.decision,
    riskLevel: data.riskLevel,
    safeToExecute: data.safeToExecute,
    summary: explainPolicyResult(data),
    reasons: data.reasons,
    requiredActions: data.requiredActions,
    checks: input.includeChecks ? data.checks : undefined,
    environment: data.environment,
    chainId: data.chainId,
    isMainnet: data.isMainnet,
    riskRegistry,
    source: "safehands_risk_report",
  });
}
