// ─── Tool: assess_risk ─────────────────────────────────────────────────
// Core risk assessment tool. Optional on-chain publishing uses SignerProvider
// and never accepts or returns raw private keys.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { assessRisk, type RiskAssessment } from "../lib/riskEngine.js";
import { createPharosWalletClientFromAccount, publicClient, getExplorerUrl } from "../lib/pharosClient.js";
import { RISK_REGISTRY_ADDRESS, RISK_REGISTRY_ABI } from "../lib/constants.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { fail, ok, requireWriteToolsEnabled, type ToolResponse } from "../lib/toolResponse.js";
import { validatePositiveAmount, validateAddress } from "../lib/validation.js";

export const assessRiskSchema = z.object({
  action: z.enum(["swap", "transfer"]),
  tokenIn: z.string().optional(),
  tokenOut: z.string().optional(),
  amount: z.string(),
  toAddress: z.string().optional(),
  walletAddress: z.string(),
  agentId: z.string().optional().describe("Managed testnet wallet agentId for optional registry publishing"),
  autoPublish: z.boolean().optional().default(false).describe("If true, publish to RiskRegistry through SignerProvider when write tools are enabled"),
  privateKey: z.string().optional().describe("Deprecated and ignored. Use SignerProvider via WALLET_MODE/agentId instead."),
}).strict();

export type AssessRiskInput = z.input<typeof assessRiskSchema>;

export interface AssessRiskResult extends RiskAssessment {
  registryPublish?: {
    published: boolean;
    txHash?: string;
    explorerUrl?: string;
    error?: string;
    signerMode?: string;
  };
}

export const assessRiskTool = {
  name: "assess_risk",
  description:
    "Evaluate risk of a planned on-chain action (swap or transfer). Returns 0-100 risk score with 5-dimension breakdown. " +
    "Optional RiskRegistry publishing uses SignerProvider when autoPublish=true.",
  inputSchema: assessRiskSchema,
};

export async function handleAssessRisk(raw: AssessRiskInput): Promise<ToolResponse<AssessRiskResult>> {
  let input: z.infer<typeof assessRiskSchema>;
  try {
    input = assessRiskSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `assess_risk input validation failed: ${msg}`, false, "assess_risk");
  }

  const amtErr = validatePositiveAmount(input.amount, "amount");
  if (amtErr) return fail("VALIDATION_ERROR", amtErr, false, "assess_risk");

  const addrErr = validateAddress(input.walletAddress, "walletAddress");
  if (addrErr) return fail("VALIDATION_ERROR", addrErr, false, "assess_risk");

  if (input.action === "swap" && (!input.tokenIn || !input.tokenOut)) {
    return fail("VALIDATION_ERROR", "Swap action requires both tokenIn and tokenOut.", false, "assess_risk");
  }
  if (input.action === "transfer") {
    if (!input.toAddress) {
      return fail("VALIDATION_ERROR", "Transfer action requires toAddress.", false, "assess_risk");
    }
    const toErr = validateAddress(input.toAddress, "toAddress");
    if (toErr) return fail("VALIDATION_ERROR", toErr, false, "assess_risk");
  }

  const assessment = await assessRisk({
    action: input.action,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amount,
    toAddress: input.toAddress,
    walletAddress: input.walletAddress,
  });

  const result: AssessRiskResult = { ...assessment };

  const wantsPublish = input.autoPublish || Boolean(input.privateKey);
  if (wantsPublish) {
    if (input.privateKey) {
      result.registryPublish = {
        published: false,
        error: "Direct privateKey input is deprecated and ignored. Use WALLET_MODE=managed-testnet with agentId or WALLET_MODE=env through SignerProvider.",
      };
      return ok(result);
    }

    const writeGuard = requireWriteToolsEnabled("assess_risk_auto_publish");
    if (writeGuard) {
      result.registryPublish = { published: false, error: `${writeGuard.error.code}: ${writeGuard.error.message}` };
      return ok(result);
    }

    const signer = await getSigner(input.agentId);
    if (isSignerFailure(signer)) {
      result.registryPublish = { published: false, error: `${signer.error.code}: ${signer.error.message}` };
      return ok(result);
    }

    try {
      const wallet = createPharosWalletClientFromAccount(signer.account);
      const txHash = await wallet.writeContract({
        address: RISK_REGISTRY_ADDRESS,
        abi: RISK_REGISTRY_ABI,
        functionName: "publish",
        args: [
          input.walletAddress as `0x${string}`,
          BigInt(assessment.riskScore),
          assessment.riskLevel,
          assessment.recommendation,
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== "success") {
        result.registryPublish = {
          published: false,
          txHash,
          explorerUrl: getExplorerUrl(txHash),
          error: "TX_REVERTED: transaction was mined but reverted. Ensure the calling wallet is authorized via RiskRegistry.setAuthorizedAgent() by the contract owner.",
          signerMode: signer.mode,
        };
      } else {
        result.registryPublish = {
          published: true,
          txHash,
          explorerUrl: getExplorerUrl(txHash),
          signerMode: signer.mode,
        };
      }
    } catch (err) {
      result.registryPublish = {
        published: false,
        error: `Registry publish failed: ${(err as Error).message}`,
      };
    }
  }

  return ok(result);
}
