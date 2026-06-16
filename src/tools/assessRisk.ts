// ─── Tool: assess_risk ─────────────────────────────────────────────────
// Core risk assessment tool. Risk scoring / analysis ONLY — it never writes
// to any registry. To publish an attestation on-chain, use publish_risk_score
// (RiskRegistry V2, gated by WRITE_TOOLS_ENABLED + signer + authorization).
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { assessRisk, type RiskAssessment } from "../lib/riskEngine.js";
import { fail, ok, type ToolResponse } from "../lib/toolResponse.js";
import { validatePositiveAmount, validateAddress } from "../lib/validation.js";

export const assessRiskSchema = z.object({
  action: z.enum(["swap", "transfer"]),
  tokenIn: z.string().optional(),
  tokenOut: z.string().optional(),
  amount: z.string(),
  toAddress: z.string().optional(),
  walletAddress: z.string(),
  agentId: z.string().optional().describe("Optional agent identifier (informational only — assess_risk does not execute or publish)"),
  privateKey: z.string().optional().describe("Deprecated and ignored. assess_risk never signs or publishes. Use publish_risk_score for on-chain attestation."),
}).strict();

export type AssessRiskInput = z.input<typeof assessRiskSchema>;

export type AssessRiskResult = RiskAssessment;

export const assessRiskTool = {
  name: "assess_risk",
  description:
    "Evaluate risk of a planned on-chain action (swap or transfer). Returns 0-100 risk score with 5-dimension breakdown. " +
    "Scoring and analysis only — does not publish on-chain. Use publish_risk_score to attest a result to RiskRegistry V2.",
  inputSchema: assessRiskSchema,
};

export async function handleAssessRisk(raw: AssessRiskInput): Promise<ToolResponse<AssessRiskResult>> {
  let input: z.infer<typeof assessRiskSchema>;
  try {
    input = assessRiskSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `assess_risk input validation failed: ${msg}`, false, "assess_risk");
  }

  const amtErr = validatePositiveAmount(input.amount, "amount");
  if (amtErr) return fail("VALIDATION_ERROR", amtErr, false, "assess_risk");

  const addrErr = validateAddress(input.walletAddress, "walletAddress");
  if (addrErr) return fail("VALIDATION_ERROR", addrErr, false, "assess_risk");

  if (input.action === "swap" && (!input.tokenIn || !input.tokenOut)) {
    return fail("VALIDATION_ERROR", "Swap action requires both tokenIn and tokenOut.", false, "assess_risk");
  }
  if (input.action === "transfer") {
    if (!input.toAddress) {
      return fail("VALIDATION_ERROR", "Transfer action requires toAddress.", false, "assess_risk");
    }
    const toErr = validateAddress(input.toAddress, "toAddress");
    if (toErr) return fail("VALIDATION_ERROR", toErr, false, "assess_risk");
  }

  const assessment = await assessRisk({
    action: input.action,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amount,
    toAddress: input.toAddress,
    walletAddress: input.walletAddress,
  });

  return ok(assessment);
}
