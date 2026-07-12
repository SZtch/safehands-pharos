import { z } from "zod";
import { isAddress } from "viem";
import { ok, fail } from "../lib/toolResponse.js";
import { getAgentReputation } from "../lib/pharos/attestationPublisher.js";
import { queryRegistryForTarget } from "../lib/safeHandsRegistry.js";

export const getAgentReputationSchema = z.object({
  address: z.string().describe("Agent/wallet address to read on-chain SafeHands reputation for"),
});

export type GetAgentReputationInput = z.input<typeof getAgentReputationSchema>;

export const getAgentReputationTool = {
  name: "get_agent_reputation",
  description:
    "Read an address's on-chain SafeHands reputation: the count of SafeHands-verified safe broadcasts " +
    "attributed to it (+ recency) from the SafeHandsAttestation contract, plus registry authorization context. " +
    "Read-only, keyless, composable: any agent can use it as a trust signal. A zero count means NEUTRAL " +
    "(no track record yet), never negative.",
  inputSchema: getAgentReputationSchema,
};

export async function handleGetAgentReputation(raw: GetAgentReputationInput) {
  const input = getAgentReputationSchema.parse(raw);

  if (!isAddress(input.address)) {
    return fail("VALIDATION_ERROR", "address is not a valid EVM address.", false, "get_agent_reputation");
  }

  try {
    const [reputation, registry] = await Promise.all([
      getAgentReputation(input.address),
      queryRegistryForTarget(input.address as `0x${string}`),
    ]);

    return ok({
      address: input.address,
      verifiedActionCount: reputation.verifiedCount,
      lastVerifiedActionAt: reputation.lastAttestationAt,
      configured: reputation.configured,
      source: reputation.source,
      isAuthorizedAgent: registry.authorized,
      hasRiskRecord: registry.hasRiskRecord,
      interpretation:
        reputation.verifiedCount > 0
          ? `${reputation.verifiedCount} SafeHands-verified on-chain action(s); positive track record.`
          : "No SafeHands-verified actions yet: NEUTRAL. Absence of record is not negative.",
    });
  } catch (err) {
    return fail("REPUTATION_QUERY_FAILED", `Failed to read reputation: ${(err as Error).message}`, true, "get_agent_reputation");
  }
}
