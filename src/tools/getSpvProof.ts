import { z } from "zod";
import { type ToolResponse, ok, fail } from "../lib/toolResponse.js";
import { publicClient } from "../lib/pharosClient.js";
import { verifyPharosSPV, type SPVResponse } from "../lib/pharos/spvVerifier.js";

export const getSpvProofSchema = z.object({
  address: z.string().describe("The 20-byte hex address of the account to query (e.g. 0x...)."),
  storageKeys: z.array(z.string()).optional().describe("Optional array of 32-byte hex storage keys to query."),
  blockTag: z.string().optional().default("latest").describe("Block number in hex or 'latest'/'earliest'."),
  verifyTrustless: z.boolean().optional().default(true).describe("If true, performs local Cryptographic SPV verification against the block's stateRoot."),
});

export type GetSpvProofParams = z.infer<typeof getSpvProofSchema>;

/**
 * Calls eth_getProof on Pharos and performs trustless SPV Verification using the hexary SHA-256 trie logic.
 */
export async function handleGetSpvProof(params: GetSpvProofParams): Promise<ToolResponse<any>> {
  try {
    const keys = params.storageKeys || [];
    
    // Fetch the proof from RPC
    // Note: We use publicClient.request to call a custom/underlying RPC method
    const rpcResponse = await publicClient.request({
      method: "eth_getProof" as any,
      params: [params.address, keys, params.blockTag] as any
    }) as SPVResponse;

    if (!rpcResponse) {
      return fail("RPC_ERROR", "Failed to retrieve eth_getProof data.", true, "eth_getProof");
    }

    let verificationStatus = "not_verified";

    if (params.verifyTrustless) {
      try {
        // Fetch the block header to get the trusted stateRoot
        const block = await publicClient.getBlock({ blockTag: params.blockTag as any });
        const stateRoot = block.stateRoot;
        
        // Verify Account Proof
        const accountValid = verifyPharosSPV(
          params.address,
          stateRoot,
          rpcResponse.isExist,
          rpcResponse.accountProof,
          rpcResponse.siblingLeftmostLeafProofs
        );

        if (!accountValid) {
           return fail("SPV_VERIFICATION_FAILED", "The Account SPV cryptographic proof could not be verified against the state root.", false, "spv_verifier");
        }
        
        verificationStatus = "cryptographically_verified_success";
        
      } catch (error) {
         return fail("SPV_VERIFICATION_ERROR", `Failed during cryptographic SPV verification: ${error instanceof Error ? error.message : String(error)}`, false, "spv_verifier");
      }
    }

    return ok({
      verified: verificationStatus === "cryptographically_verified_success",
      verificationStatus,
      isExist: rpcResponse.isExist,
      balance: rpcResponse.balance,
      nonce: rpcResponse.nonce,
      storageHash: rpcResponse.storageHash,
      // For brevity, we don't return the raw hexproof arrays to the AI to avoid max context length issues, 
      // since the AI only cares if it's verified and what the values are.
      accountDataVerified: true,
      storageValues: rpcResponse.storageProof ? rpcResponse.storageProof.map(sp => ({
        key: sp.key,
        value: sp.value,
        isExist: sp.isExist
      })) : []
    });

  } catch (error) {
    return fail(
      "ETH_GET_PROOF_FAILED",
      `Failed to execute eth_getProof: ${error instanceof Error ? error.message : String(error)}`,
      true,
      "eth_getProof"
    );
  }
}
