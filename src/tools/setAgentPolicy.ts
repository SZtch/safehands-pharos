import { z } from "zod";
import { ok, fail } from "../lib/toolResponse.js";
import { loadAgentPolicy, saveAgentPolicy, POLICY_PROFILES, type AgentPolicy } from "../lib/policy/agentPolicy.js";

export const setAgentPolicySchema = z.object({
  agentId: z.string().min(1).describe("Agent ID to set policy for."),
  profile: z.enum(["conservative", "balanced", "advanced", "custom"]).optional()
    .describe("Named profile to apply. Overrides individual limit/flag fields unless 'custom' is chosen with explicit values."),
  limits: z.object({
    maxPaymentPHRS: z.string().optional(),
    maxSwapPHRS: z.string().optional(),
    maxDailySpendPHRS: z.string().optional(),
    maxX402PaymentUSDC: z.string().optional(),
    maxApprovalUSDC: z.string().optional(),
  }).optional().describe("Custom limits. Only used when profile is 'custom' or to override a named profile's defaults."),
  flags: z.object({
    allowUnknownTokens: z.boolean().optional(),
    allowCustomContractCalls: z.boolean().optional(),
    requireConfirmationAboveRisk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  }).optional().describe("Custom flags. Only used when profile is 'custom' or to override a named profile's defaults."),
}).strict();

export async function handleSetAgentPolicy(params: z.infer<typeof setAgentPolicySchema>) {
  const profileName = params.profile || "custom";

  let base: AgentPolicy;
  if (profileName !== "custom" && profileName in POLICY_PROFILES) {
    base = structuredClone(POLICY_PROFILES[profileName as keyof typeof POLICY_PROFILES]);
  } else {
    base = loadAgentPolicy(params.agentId);
    base.profile = "custom";
  }

  if (params.limits) {
    for (const [key, val] of Object.entries(params.limits)) {
      if (val !== undefined) {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) {
          return fail("VALIDATION_ERROR", `Invalid limit value for ${key}: ${val}`, false, "set_agent_policy");
        }
        (base.limits as unknown as Record<string, string>)[key] = val;
      }
    }
  }

  if (params.flags) {
    if (params.flags.allowUnknownTokens !== undefined) base.flags.allowUnknownTokens = params.flags.allowUnknownTokens;
    if (params.flags.allowCustomContractCalls !== undefined) base.flags.allowCustomContractCalls = params.flags.allowCustomContractCalls;
    if (params.flags.requireConfirmationAboveRisk !== undefined) base.flags.requireConfirmationAboveRisk = params.flags.requireConfirmationAboveRisk;
  }

  if (profileName !== "custom") base.profile = profileName as AgentPolicy["profile"];

  try {
    saveAgentPolicy(params.agentId, base);
  } catch (err) {
    return fail("POLICY_SAVE_FAILED", `Failed to save policy: ${err instanceof Error ? err.message : String(err)}`, false, "set_agent_policy");
  }

  return ok({
    agentId: params.agentId,
    policy: base,
    saved: true,
    source: "set_agent_policy",
  });
}
