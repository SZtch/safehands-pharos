// ─── Tool: publish_risk_score ──────────────────────────────────────────
// Publishes a risk assessment result to the on-chain RiskRegistry.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { RISK_REGISTRY_ADDRESS, RISK_REGISTRY_ABI, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
export const publishRiskScoreSchema = z.object({
    action: z.enum(["swap", "transfer"]).describe("Type of on-chain action to assess"),
    tokenIn: z.string().optional(),
    tokenOut: z.string().optional(),
    amount: z.string().describe("Human-readable amount"),
    toAddress: z.string().optional().describe("Recipient address (for transfers)"),
    agentId: z.string().optional().describe("Managed testnet wallet agentId when WALLET_MODE=managed-testnet"),
});
export const publishRiskScoreTool = {
    name: "publish_risk_score",
    description: "Run a risk assessment and publish the result to the on-chain RiskRegistry. " +
        "Other agents can then query this wallet's risk score without re-running the assessment.",
    inputSchema: publishRiskScoreSchema,
};
export async function handlePublishRiskScore(raw) {
    if (process.env.WRITE_TOOLS_ENABLED !== "true") {
        return fail("WRITE_TOOLS_DISABLED", "publish_risk_score is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted testnet execution.", false, "publish_risk_score");
    }
    const input = publishRiskScoreSchema.parse(raw);
    const signer = await getSigner(input.agentId);
    if (isSignerFailure(signer)) {
        return fail(signer.error.code, signer.error.message, false, "publish_risk_score");
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
    try {
        const wallet = createPharosWalletClientFromAccount(signer.account);
        const txHash = await wallet.writeContract({
            address: RISK_REGISTRY_ADDRESS,
            abi: RISK_REGISTRY_ABI,
            functionName: "publish",
            args: [
                walletAddress,
                BigInt(assessment.riskScore),
                assessment.riskLevel,
                assessment.recommendation,
            ],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
            return fail("TX_REVERTED", "publish_risk_score transaction was mined but reverted on-chain. Ensure the calling wallet is authorized via RiskRegistry.setAuthorizedAgent() by the contract owner.", false, "publish_risk_score");
        }
        return ok({
            assessment,
            policy,
            signerMode: signer.mode,
            onChain: {
                txHash,
                explorerUrl: getExplorerUrl(txHash),
                contractAddress: RISK_REGISTRY_ADDRESS,
                gasUsed: receipt.gasUsed.toString(),
                blockNumber: receipt.blockNumber.toString(),
            },
            source: "publish_risk_score",
        });
    }
    catch (err) {
        return classifyExternalError("pharos_rpc", err);
    }
}
//# sourceMappingURL=publishRiskScore.js.map