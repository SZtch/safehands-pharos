import { z } from "zod";
import { isAddress } from "viem";
import { ok, type ToolResponse } from "../lib/toolResponse.js";
import { explainPolicyResult } from "../lib/policy/actionPolicyEngine.js";
import { handleSafeHandsPreflightCheck, safehandsPreflightCheckSchema } from "./safehandsPreflightCheck.js";
import { queryRegistryForTarget } from "../lib/safeHandsRegistry.js";

export const safehandsRiskReportSchema = safehandsPreflightCheckSchema.extend({
  includeChecks: z.boolean().optional().default(true),
  walletAddress: z.string().optional(),
});

export type SafeHandsRiskReportInput = z.input<typeof safehandsRiskReportSchema>;

export async function handleSafeHandsRiskReport(raw: SafeHandsRiskReportInput): Promise<ToolResponse<unknown>> {
  const input = safehandsRiskReportSchema.parse(raw);
  // Delegate to the preflight core with only its recognized fields. The preflight
  // schema is strict, so the risk-report-only key (includeChecks) must be stripped
  // before delegation; it is still used below to shape the report.
  const { includeChecks, ...preflightInput } = input;
  const preflight = await handleSafeHandsPreflightCheck(preflightInput);
  if (!preflight.success) return preflight;
  const data = preflight.data as any;

  let riskRegistry = null;
  const walletAddr = input.walletAddress || input.recipient;
  if (walletAddr && isAddress(walletAddr)) {
    try {
      riskRegistry = await queryRegistryForTarget(walletAddr as `0x${string}`);
    } catch {
      riskRegistry = {
        version: "safehands-registry",
        error: "SafeHandsRegistry unavailable; local risk evaluation still completed.",
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
    checks: includeChecks ? data.checks : undefined,
    environment: data.environment,
    chainId: data.chainId,
    isMainnet: data.isMainnet,
    riskRegistry,
    source: "safehands_risk_report",
  });
}
