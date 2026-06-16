import { z } from "zod";
import { isAddress } from "viem";
import { ok, fail } from "../lib/toolResponse.js";
import { RISK_REGISTRY_V2_ADDRESS } from "../lib/constants.js";
import { queryV2ForWallet } from "../lib/riskRegistryV2.js";

export const queryRiskRegistrySchema = z.object({
  walletAddress: z.string().describe("Wallet address to query risk records for"),
});

export type QueryRiskRegistryInput = z.input<typeof queryRiskRegistrySchema>;

export const queryRiskRegistryTool = {
  name: "query_risk_registry",
  description:
    "Query the on-chain RiskRegistry V2 for a wallet's risk attestations and authorization status. " +
    "Read-only, no private key needed.",
  inputSchema: queryRiskRegistrySchema,
};

export async function handleQueryRiskRegistry(raw: QueryRiskRegistryInput) {
  const input = queryRiskRegistrySchema.parse(raw);

  if (!isAddress(input.walletAddress)) {
    return fail("VALIDATION_ERROR", "walletAddress is not a valid EVM address.", false, "query_risk_registry");
  }

  try {
    const result = await queryV2ForWallet(input.walletAddress as `0x${string}`);

    if (result.error) {
      return ok({
        walletAddress: input.walletAddress,
        found: false,
        record: null,
        registryVersion: "v2",
        registryContract: RISK_REGISTRY_V2_ADDRESS,
        rpcError: result.error,
        message: "RiskRegistry V2 query failed; RPC may be unavailable.",
      });
    }

    if (!result.hasRiskRecord) {
      return ok({
        walletAddress: input.walletAddress,
        found: false,
        record: null,
        authorized: result.authorized,
        registryVersion: "v2",
        registryContract: RISK_REGISTRY_V2_ADDRESS,
        message: "No on-chain risk record found for this wallet.",
      });
    }

    return ok({
      walletAddress: input.walletAddress,
      found: true,
      record: result.latestRecord,
      authorized: result.authorized,
      registryVersion: "v2",
      registryContract: RISK_REGISTRY_V2_ADDRESS,
    });
  } catch (err) {
    return fail("REGISTRY_QUERY_FAILED", `Failed to query registry: ${(err as Error).message}`, true, "query_risk_registry");
  }
}
