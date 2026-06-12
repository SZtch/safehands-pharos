// ─── Tool: safehands_risk_report ───────────────────────────────────────

import { z } from "zod";
import { ok, type ToolResponse } from "../lib/toolResponse.js";
import { explainPolicyResult } from "../lib/policy/actionPolicyEngine.js";
import { handleSafeHandsPreflightCheck, safehandsPreflightCheckSchema } from "./safehandsPreflightCheck.js";

export const safehandsRiskReportSchema = safehandsPreflightCheckSchema.extend({
  includeChecks: z.boolean().optional().default(true),
});

export type SafeHandsRiskReportInput = z.input<typeof safehandsRiskReportSchema>;

export async function handleSafeHandsRiskReport(raw: SafeHandsRiskReportInput): Promise<ToolResponse<unknown>> {
  const input = safehandsRiskReportSchema.parse(raw);
  const preflight = await handleSafeHandsPreflightCheck(input);
  if (!preflight.success) return preflight;
  const data = preflight.data as any;
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
    source: "safehands_risk_report",
  });
}
