// ─── Tool: explain_risk ────────────────────────────────────────────────
import { z } from "zod";
import { ok } from "../lib/toolResponse.js";
import { explainPolicyResult } from "../lib/policy/actionPolicyEngine.js";
export const explainRiskSchema = z.object({
    decision: z.enum(["ALLOW", "WARN", "BLOCK", "REQUIRE_CONFIRMATION", "REQUIRE_FUNDING", "REQUIRE_TOKEN_REVIEW"]),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]),
    reasons: z.array(z.string()).optional().default([]),
    requiredActions: z.array(z.string()).optional().default([]),
    environment: z.string().optional().default("atlantic-testnet"),
    chainId: z.number().optional().default(688689),
    isMainnet: z.boolean().optional().default(false),
});
export async function handleExplainRisk(raw) {
    const input = explainRiskSchema.parse(raw);
    const result = {
        decision: input.decision,
        riskLevel: input.riskLevel,
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
//# sourceMappingURL=explainRisk.js.map