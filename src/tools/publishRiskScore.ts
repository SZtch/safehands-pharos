import { z } from "zod";
import { isAddress, keccak256, stringToHex } from "viem";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import {
  SAFEHANDS_REGISTRY_ADDRESS, SAFEHANDS_REGISTRY_ABI,
  CHAIN_ID, PHAROS_ENVIRONMENT, REQUIRE_AUTHORIZED_AGENT_FOR_WRITE,
} from "../lib/constants.js";
import { IS_MAINNET } from "../lib/constants.js";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { validatePositiveAmount } from "../lib/validation.js";
import { deriveActionHash, checkManagedWalletAuthorization, riskLevelToEnum, recommendationToEnum } from "../lib/safeHandsRegistry.js";
import { queueRiskRecord } from "../lib/merkleBatcher.js";

const PKG_VERSION = "2.2.0";

export const publishRiskScoreSchema = z.object({
  action: z.enum(["swap", "transfer"]).describe("Type of on-chain action to assess"),
  tokenIn: z.string().optional(),
  tokenOut: z.string().optional(),
  amount: z.string().describe("Human-readable amount"),
  toAddress: z.string().optional().describe("Recipient address (for transfers)"),
  agentId: z.string().optional().describe("Managed wallet agentId when WALLET_MODE=managed-mainnet"),
  policyVersion: z.string().optional().default(PKG_VERSION),
  evidenceURI: z.string().optional().default(""),
  expiresAt: z.number().int().nonnegative().optional(),
}).strict();

export type PublishRiskScoreInput = z.input<typeof publishRiskScoreSchema>;

export const publishRiskScoreTool = {
  name: "publish_risk_score",
  description:
    "Run a risk assessment and publish the result to the on-chain SafeHandsRegistry. " +
    "Other agents can then query this target's risk record + score without re-running the assessment.",
  inputSchema: publishRiskScoreSchema,
};

export async function handlePublishRiskScore(raw: PublishRiskScoreInput) {
  if (process.env.WRITE_TOOLS_ENABLED !== "true") {
    return fail(
      "WRITE_TOOLS_DISABLED",
      "publish_risk_score is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted execution.",
      false,
      "publish_risk_score"
    );
  }

  let input: z.infer<typeof publishRiskScoreSchema>;
  try {
    input = publishRiskScoreSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `publish_risk_score input validation failed: ${msg}`, false, "publish_risk_score");
  }

  const amtErr = validatePositiveAmount(input.amount, "amount");
  if (amtErr) return fail("VALIDATION_ERROR", amtErr, false, "publish_risk_score");

  if (input.action === "swap" && (!input.tokenIn || !input.tokenOut)) {
    return fail("VALIDATION_ERROR", "Swap action requires both tokenIn and tokenOut.", false, "publish_risk_score");
  }
  if (input.action === "transfer" && !input.toAddress) {
    return fail("VALIDATION_ERROR", "Transfer action requires toAddress.", false, "publish_risk_score");
  }

  if (!input.policyVersion) {
    return fail("VALIDATION_ERROR", "policyVersion is required.", false, "publish_risk_score");
  }

  if (!SAFEHANDS_REGISTRY_ADDRESS || !isAddress(SAFEHANDS_REGISTRY_ADDRESS)) {
    return fail(
      "REGISTRY_NOT_CONFIGURED",
      "SafeHandsRegistry is not deployed/configured. Set SAFEHANDS_REGISTRY_ADDRESS after deploying the contract.",
      false,
      "publish_risk_score"
    );
  }

  const signer = await getSigner(input.agentId);
  if (isSignerFailure(signer)) {
    return fail(signer.error.code, signer.error.message, false, "publish_risk_score");
  }

  if (signer.mode === "managed-mainnet" && REQUIRE_AUTHORIZED_AGENT_FOR_WRITE) {
    const authCheck = await checkManagedWalletAuthorization(signer.address);
    if (!authCheck.authorized) {
      return fail(
        authCheck.errorCode || "AGENT_WALLET_NOT_AUTHORIZED",
        authCheck.errorMessage || "Managed wallet is not authorized in SafeHandsRegistry.",
        false,
        "publish_risk_score"
      );
    }
  }

  const policy = evaluateActionPolicy({
    actionType: "publish_risk_score",
    agentId: input.agentId,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: IS_MAINNET,
    signerAvailable: true,
    requiresSigner: true,
  });
  if (policy.decision === "BLOCK") {
    return fail("POLICY_BLOCKED", policy.reasons.join(" ") || "Publishing blocked by SafeHands policy.", false, "publish_risk_score");
  }

  const walletAddress = signer.address;
  const assessment = await assessRisk({
    action: input.action,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amount,
    toAddress: input.toAddress,
    walletAddress,
  });

  if (assessment.riskScore < 0 || assessment.riskScore > 100) {
    return fail("VALIDATION_ERROR", `Risk score ${assessment.riskScore} is out of valid range 0-100.`, false, "publish_risk_score");
  }

  const actionHash = deriveActionHash(CHAIN_ID, input.action, walletAddress, {
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amount,
    toAddress: input.toAddress,
  });

  const registryAddress = SAFEHANDS_REGISTRY_ADDRESS as `0x${string}`;
  const resolvedExpiresAt = input.expiresAt ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  try {
    queueRiskRecord({
      target: walletAddress,
      actionHash: actionHash,
      score: assessment.riskScore,
      level: riskLevelToEnum(assessment.riskLevel),
      recommendation: recommendationToEnum(assessment.recommendation),
      policyVersionHash: keccak256(stringToHex(input.policyVersion)),
      evidenceHash: keccak256(stringToHex(input.evidenceURI || "none")),
      expiresAt: BigInt(resolvedExpiresAt),
    });

    return ok({
      assessment,
      policy,
      signerMode: signer.mode,
      riskRegistry: {
        version: "safehands-registry",
        address: registryAddress,
        actionHash,
        policyVersion: input.policyVersion,
        expiresAt: String(resolvedExpiresAt),
      },
      onChain: {
        status: "L2_BATCH_QUEUED",
        note: "Risk record queued for next L2 Merkle Batching cycle to save gas.",
      },
      source: "publish_risk_score",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
