// ─── Tool: assess_risk ─────────────────────────────────────────────────
// Core risk assessment tool. Optional on-chain publishing uses SignerProvider
// and never accepts or returns raw private keys.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { assessRisk } from "../lib/riskEngine.js";
import { createPharosWalletClientFromAccount, publicClient, getExplorerUrl } from "../lib/pharosClient.js";
import { RISK_REGISTRY_ADDRESS, RISK_REGISTRY_ABI } from "../lib/constants.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { requireWriteToolsEnabled } from "../lib/toolResponse.js";
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
});
export const assessRiskTool = {
    name: "assess_risk",
    description: "Evaluate risk of a planned on-chain action (swap or transfer). Returns 0-100 risk score with 5-dimension breakdown. " +
        "Optional RiskRegistry publishing uses SignerProvider when autoPublish=true.",
    inputSchema: assessRiskSchema,
};
export async function handleAssessRisk(raw) {
    const input = assessRiskSchema.parse(raw);
    if (input.action === "swap" && (!input.tokenIn || !input.tokenOut)) {
        throw new Error("Swap action requires both tokenIn and tokenOut");
    }
    if (input.action === "transfer" && !input.toAddress) {
        throw new Error("Transfer action requires toAddress");
    }
    const assessment = await assessRisk({
        action: input.action,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amount: input.amount,
        toAddress: input.toAddress,
        walletAddress: input.walletAddress,
    });
    const result = { ...assessment };
    const wantsPublish = input.autoPublish || Boolean(input.privateKey);
    if (wantsPublish) {
        if (input.privateKey) {
            result.registryPublish = {
                published: false,
                error: "Direct privateKey input is deprecated and ignored. Use WALLET_MODE=managed-testnet with agentId or WALLET_MODE=env through SignerProvider.",
            };
            return result;
        }
        const writeGuard = requireWriteToolsEnabled("assess_risk_auto_publish");
        if (writeGuard) {
            result.registryPublish = { published: false, error: `${writeGuard.error.code}: ${writeGuard.error.message}` };
            return result;
        }
        const signer = await getSigner(input.agentId);
        if (isSignerFailure(signer)) {
            result.registryPublish = { published: false, error: `${signer.error.code}: ${signer.error.message}` };
            return result;
        }
        try {
            const wallet = createPharosWalletClientFromAccount(signer.account);
            const txHash = await wallet.writeContract({
                address: RISK_REGISTRY_ADDRESS,
                abi: RISK_REGISTRY_ABI,
                functionName: "publish",
                args: [
                    input.walletAddress,
                    BigInt(assessment.riskScore),
                    assessment.riskLevel,
                    assessment.recommendation,
                ],
            });
            await publicClient.waitForTransactionReceipt({ hash: txHash });
            result.registryPublish = {
                published: true,
                txHash,
                explorerUrl: getExplorerUrl(txHash),
                signerMode: signer.mode,
            };
        }
        catch (err) {
            result.registryPublish = {
                published: false,
                error: `Registry publish failed: ${err.message}`,
            };
        }
    }
    return result;
}
//# sourceMappingURL=assessRisk.js.map