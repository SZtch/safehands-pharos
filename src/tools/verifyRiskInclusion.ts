import { z } from "zod";
import { isAddress } from "viem";
import { ok, fail } from "../lib/toolResponse.js";
import { SAFEHANDS_REGISTRY_ADDRESS } from "../lib/constants.js";
import { verifyRiskInclusion } from "../lib/riskInclusion.js";

export const verifyRiskInclusionSchema = z.object({
  target: z.string().describe("The address whose risk record you want to prove is included in the committed on-chain Merkle root."),
  actionHash: z.string().optional().describe("Optional 32-byte action hash to disambiguate when a target has multiple records in the batch."),
  verifyOnchain: z.boolean().optional().default(true).describe("If true (default), also verify the Merkle proof through the contract's verifyRiskRecord view for a trustless result."),
});

export type VerifyRiskInclusionInput = z.input<typeof verifyRiskInclusionSchema>;

export const verifyRiskInclusionTool = {
  name: "verify_risk_inclusion",
  description:
    "Prove a target's SafeHands risk record is included in the currently committed on-chain Merkle root. " +
    "Fetches the committed root + data-availability batch, rebuilds the Merkle proof, and verifies it both " +
    "locally and (by default) through the SafeHandsRegistry.verifyRiskRecord view. Read-only, keyless, composable.",
  inputSchema: verifyRiskInclusionSchema,
};

export async function handleVerifyRiskInclusion(raw: VerifyRiskInclusionInput) {
  const input = verifyRiskInclusionSchema.parse(raw);

  if (!isAddress(input.target)) {
    return fail("VALIDATION_ERROR", "target is not a valid EVM address.", false, "verify_risk_inclusion");
  }

  try {
    const result = await verifyRiskInclusion(
      { target: input.target, actionHash: input.actionHash },
      { verifyOnchain: input.verifyOnchain }
    );

    return ok({
      ...result,
      registryContract: SAFEHANDS_REGISTRY_ADDRESS || null,
      // A single, unambiguous verdict for callers that don't want to interpret the flags themselves.
      included: Boolean(
        result.found &&
          result.rootMatches &&
          result.verifiedLocal &&
          (result.verifiedOnchain === null || result.verifiedOnchain === true) &&
          !result.expired
      ),
    });
  } catch (err) {
    return fail("RISK_INCLUSION_FAILED", `Failed to verify risk inclusion: ${(err as Error).message}`, true, "verify_risk_inclusion");
  }
}
