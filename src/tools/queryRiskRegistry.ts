// ─── Tool: query_risk_registry ─────────────────────────────────────────
// Queries the on-chain RiskRegistry for a wallet's published risk score.
// Read-only — no private key needed.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient, getExplorerUrl } from "../lib/pharosClient.js";
import { RISK_REGISTRY_ADDRESS, RISK_REGISTRY_ABI } from "../lib/constants.js";
import { ok, fail } from "../lib/toolResponse.js";

export const queryRiskRegistrySchema = z.object({
  walletAddress: z.string().describe("Wallet address to query risk score for"),
});

export type QueryRiskRegistryInput = z.input<typeof queryRiskRegistrySchema>;

export const queryRiskRegistryTool = {
  name: "query_risk_registry",
  description:
    "Query the on-chain RiskRegistry for a wallet's published risk score. " +
    "Read-only, no private key needed. Returns score, level, recommendation, timestamp, and assessor.",
  inputSchema: queryRiskRegistrySchema,
};

export async function handleQueryRiskRegistry(raw: QueryRiskRegistryInput) {
  const input = queryRiskRegistrySchema.parse(raw);

  try {
    const result = (await publicClient.readContract({
      address: RISK_REGISTRY_ADDRESS,
      abi: RISK_REGISTRY_ABI,
      functionName: "query",
      args: [input.walletAddress as `0x${string}`],
    })) as {
      score: bigint;
      riskLevel: string;
      recommendation: string;
      timestamp: bigint;
      assessedBy: `0x${string}`;
    };

    const score = Number(result.score);
    const timestamp = Number(result.timestamp);

    // Check if record exists (timestamp will be 0 if never published)
    if (timestamp === 0) {
      return ok({
        walletAddress: input.walletAddress,
        found: false,
        record: null,
        registryContract: RISK_REGISTRY_ADDRESS,
        message: "No risk score published for this wallet",
      });
    }

    return ok({
      walletAddress: input.walletAddress,
      found: true,
      record: {
        score,
        riskLevel: result.riskLevel,
        recommendation: result.recommendation,
        timestamp: new Date(timestamp * 1000).toISOString(),
        assessedBy: result.assessedBy,
      },
      registryContract: RISK_REGISTRY_ADDRESS,
    });
  } catch (err) {
    return fail("REGISTRY_QUERY_FAILED", `Failed to query registry: ${(err as Error).message}`, true, "query_risk_registry");
  }
}
