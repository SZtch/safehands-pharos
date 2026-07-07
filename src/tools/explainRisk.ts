// ─── Tool: explain_risk ────────────────────────────────────────────────

import { z } from "zod";
import { ok, type ToolResponse } from "../lib/toolResponse.js";
import { explainPolicyResult, type PolicyDecision, type PolicyRiskLevel } from "../lib/policy/actionPolicyEngine.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET } from "../lib/constants.js";

export const explainRiskSchema = z.object({
  decision: z.enum(["ALLOW", "WARN", "BLOCK", "REQUIRE_CONFIRMATION", "PREPARE_ONLY", "REQUIRE_FUNDING", "REQUIRE_TOKEN_REVIEW"]),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]),
  reasons: z.array(z.string()).optional().default([]),
  requiredActions: z.array(z.string()).optional().default([]),
  environment: z.string().optional().default(PHAROS_ENVIRONMENT),
  chainId: z.number().optional().default(CHAIN_ID),
  isMainnet: z.boolean().optional().default(IS_MAINNET),
});

export type ExplainRiskInput = z.input<typeof explainRiskSchema>;

export async function handleExplainRisk(raw: ExplainRiskInput): Promise<ToolResponse<unknown>> {
  const input = explainRiskSchema.parse(raw);
  const result = {
    decision: input.decision as PolicyDecision,
    riskLevel: input.riskLevel as PolicyRiskLevel,
    safeToExecute: input.decision === "ALLOW",
    reasons: input.reasons,
    requiredActions: input.requiredActions,
    checks: [],
    environment: input.environment,
    chainId: input.chainId,
    isMainnet: input.isMainnet,
  };
  return ok({
    explanation: explainPolicyResult(result),
    ...result,
    source: "explain_risk",
  });
}
