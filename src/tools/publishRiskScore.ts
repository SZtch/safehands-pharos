import { z } from "zod";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import {
  RISK_REGISTRY_V2_ADDRESS, RISK_REGISTRY_V2_ABI,
  CHAIN_ID, PHAROS_ENVIRONMENT, REQUIRE_AUTHORIZED_AGENT_FOR_WRITE,
} from "../lib/constants.js";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { validatePositiveAmount } from "../lib/validation.js";
import { deriveActionHash, checkManagedWalletAuthorization } from "../lib/riskRegistryV2.js";

const PKG_VERSION = "1.6.0";

export const publishRiskScoreSchema = z.object({
  action: z.enum(["swap", "transfer"]).describe("Type of on-chain action to assess"),
  tokenIn: z.string().optional(),
  tokenOut: z.string().optional(),
  amount: z.string().describe("Human-readable amount"),
  toAddress: z.string().optional().describe("Recipient address (for transfers)"),
  agentId: z.string().optional().describe("Managed testnet wallet agentId when WALLET_MODE=managed-testnet"),
  policyVersion: z.string().optional().default(PKG_VERSION),
  evidenceURI: z.string().optional().default(""),
  expiresAt: z.number().optional().default(0),
}).strict();

export type PublishRiskScoreInput = z.input<typeof publishRiskScoreSchema>;

export const publishRiskScoreTool = {
  name: "publish_risk_score",
  description:
    "Run a risk assessment and publish the result to the on-chain RiskRegistry V2. " +
    "Other agents can then query this wallet's risk attestation without re-running the assessment.",
  inputSchema: publishRiskScoreSchema,
};

export async function handlePublishRiskScore(raw: PublishRiskScoreInput) {
  if (process.env.WRITE_TOOLS_ENABLED !== "true") {
    return fail(
      "WRITE_TOOLS_DISABLED",
      "publish_risk_score is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted testnet execution.",
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

  const signer = await getSigner(input.agentId);
  if (isSignerFailure(signer)) {
    return fail(signer.error.code, signer.error.message, false, "publish_risk_score");
  }

  if (signer.mode === "managed-testnet" && REQUIRE_AUTHORIZED_AGENT_FOR_WRITE) {
    const authCheck = await checkManagedWalletAuthorization(signer.address);
    if (!authCheck.authorized) {
      return fail(
        authCheck.errorCode || "AGENT_WALLET_NOT_AUTHORIZED",
        authCheck.errorMessage || "Managed wallet is not authorized in RiskRegistry V2.",
        false,
        "publish_risk_score"
      );
    }
  }

  const policy = evaluateActionPolicy({
    actionType: "publish_risk_score",
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
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

  try {
    const wallet = createPharosWalletClientFromAccount(signer.account);

    const txHash = await wallet.writeContract({
      address: RISK_REGISTRY_V2_ADDRESS,
      abi: RISK_REGISTRY_V2_ABI,
      functionName: "publishRiskRecord",
      args: [
        walletAddress,
        walletAddress,
        actionHash,
        assessment.riskScore,
        assessment.riskLevel,
        assessment.recommendation,
        input.policyVersion,
        input.evidenceURI,
        BigInt(input.expiresAt),
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      return fail(
        "TX_REVERTED",
        "publish_risk_score transaction was mined but reverted on-chain. Ensure the calling wallet is authorized via RiskRegistry V2.",
        false,
        "publish_risk_score"
      );
    }

    return ok({
      assessment,
      policy,
      signerMode: signer.mode,
      riskRegistry: {
        version: "v2",
        address: RISK_REGISTRY_V2_ADDRESS,
        actionHash,
        policyVersion: input.policyVersion,
      },
      onChain: {
        txHash,
        explorerUrl: getExplorerUrl(txHash),
        contractAddress: RISK_REGISTRY_V2_ADDRESS,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber.toString(),
      },
      source: "publish_risk_score",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
