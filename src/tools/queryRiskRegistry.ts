import { z } from "zod";
import { isAddress } from "viem";
import { ok, fail } from "../lib/toolResponse.js";
import { SAFEHANDS_REGISTRY_ADDRESS } from "../lib/constants.js";
import { queryRegistryForTarget } from "../lib/safeHandsRegistry.js";

export const queryRiskRegistrySchema = z.object({
  walletAddress: z.string().describe("Wallet address to query risk records for"),
});

export type QueryRiskRegistryInput = z.input<typeof queryRiskRegistrySchema>;

export const queryRiskRegistryTool = {
  name: "query_risk_registry",
  description:
    "Query the on-chain SafeHandsRegistry for a wallet's risk record, risk score, and authorization status. " +
    "Read-only, no private key needed.",
  inputSchema: queryRiskRegistrySchema,
};

export async function handleQueryRiskRegistry(raw: QueryRiskRegistryInput) {
  const input = queryRiskRegistrySchema.parse(raw);

  if (!isAddress(input.walletAddress)) {
    return fail("VALIDATION_ERROR", "walletAddress is not a valid EVM address.", false, "query_risk_registry");
  }

  try {
    const result = await queryRegistryForTarget(input.walletAddress as `0x${string}`);

    if (result.error) {
      return ok({
        walletAddress: input.walletAddress,
        found: false,
        currentMerkleRoot: null,
        currentDataURI: null,
        registry: "safehands-registry",
        registryContract: SAFEHANDS_REGISTRY_ADDRESS || null,
        rpcError: result.error,
        message: "SafeHandsRegistry query failed or registry not configured.",
      });
    }

    if (!result.hasRiskRecord) {
      return ok({
        walletAddress: input.walletAddress,
        found: false,
        currentMerkleRoot: null,
        currentDataURI: null,
        authorized: result.authorized,
        registry: "safehands-registry",
        registryContract: SAFEHANDS_REGISTRY_ADDRESS || null,
        message: "No on-chain Merkle Root found.",
      });
    }

    return ok({
      walletAddress: input.walletAddress,
      found: true,
      currentMerkleRoot: result.currentMerkleRoot,
      currentDataURI: result.currentDataURI,
      authorized: result.authorized,
      registry: "safehands-registry",
      registryContract: SAFEHANDS_REGISTRY_ADDRESS || null,
    });
  } catch (err) {
    return fail("REGISTRY_QUERY_FAILED", `Failed to query registry: ${(err as Error).message}`, true, "query_risk_registry");
  }
}
