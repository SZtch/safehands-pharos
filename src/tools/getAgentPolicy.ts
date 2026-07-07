import { z } from "zod";
import { ok } from "../lib/toolResponse.js";
import { loadAgentPolicy, POLICY_PROFILES } from "../lib/policy/agentPolicy.js";

export const getAgentPolicySchema = z.object({
  agentId: z.string().optional().describe("Agent ID to load policy for. Uses 'default' policy if not specified."),
});

export async function handleGetAgentPolicy(params: z.infer<typeof getAgentPolicySchema>) {
  const policy = loadAgentPolicy(params.agentId);
  return ok({
    agentId: params.agentId || "default",
    policy,
    availableProfiles: Object.keys(POLICY_PROFILES),
    source: "get_agent_policy",
  });
}
