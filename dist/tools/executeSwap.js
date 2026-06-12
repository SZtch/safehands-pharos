// ─── Tool: execute_swap ────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { getDodoRoute, isNativeToken, resolveTokenAddress, resolveTokenDecimals, toWei } from "../lib/dodoApi.js";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { DODO_APPROVE_ADDRESS, ERC20_ABI, RISK_BLOCK_THRESHOLD, MAX_TX_AMOUNT_PHRS, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
export const executeSwapSchema = z.object({
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string(),
    slippageTolerance: z.number().optional().default(3.225),
    agentId: z.string().optional().describe("Managed testnet wallet agentId when WALLET_MODE=managed-testnet"),
});
export const executeSwapTool = {
    name: "execute_swap",
    description: "Swap tokens via FaroSwap with built-in risk gate. Runs risk assessment first, blocks if score > 80.",
    inputSchema: executeSwapSchema,
};
export async function handleExecuteSwap(raw) {
    if (process.env.WRITE_TOOLS_ENABLED !== "true") {
        return fail("WRITE_TOOLS_DISABLED", "execute_swap is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted testnet execution.", false, "execute_swap");
    }
    const input = executeSwapSchema.parse(raw);
    const signer = await getSigner(input.agentId);
    if (isSignerFailure(signer)) {
        return fail(signer.error.code, signer.error.message, false, "execute_swap");
    }
    const walletAddress = signer.address;
    const policy = evaluateActionPolicy({
        actionType: "execute_swap",
        amount: input.amountIn,
        amountUnit: "TOKEN",
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        chainId: CHAIN_ID,
        environment: PHAROS_ENVIRONMENT,
        isMainnet: false,
        signerAvailable: true,
        requiresSigner: true,
    });
    if (policy.decision === "BLOCK") {
        return fail("POLICY_BLOCKED", policy.reasons.join(" ") || "Swap blocked by SafeHands policy.", false, "execute_swap");
    }
    if (Number(input.amountIn) > Number(MAX_TX_AMOUNT_PHRS) && input.tokenIn.toUpperCase() === "PHRS") {
        return fail("TX_LIMIT_EXCEEDED", `Swap amount exceeds configured testnet limit (${MAX_TX_AMOUNT_PHRS}).`, false, "execute_swap");
    }
    const risk = await assessRisk({
        action: "swap",
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amount: input.amountIn,
        walletAddress,
    });
    if (risk.riskScore > RISK_BLOCK_THRESHOLD) {
        return fail("POLICY_BLOCKED", `Swap blocked — risk score ${risk.riskScore}/100: ${risk.suggestion}`, false, "execute_swap");
    }
    try {
        const quote = await getDodoRoute({
            fromToken: input.tokenIn,
            toToken: input.tokenOut,
            amountHuman: input.amountIn,
            walletAddress,
            slippage: input.slippageTolerance,
        });
        if (!quote.routeAvailable) {
            return fail("NO_ROUTE_AVAILABLE", "No swap route available — insufficient liquidity", true, "dodo_api");
        }
        const wallet = createPharosWalletClientFromAccount(signer.account);
        if (!isNativeToken(input.tokenIn)) {
            const tokenAddr = resolveTokenAddress(input.tokenIn);
            const decimals = resolveTokenDecimals(input.tokenIn);
            const amountWei = BigInt(toWei(input.amountIn, decimals));
            const allowance = (await publicClient.readContract({
                address: tokenAddr,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [walletAddress, DODO_APPROVE_ADDRESS],
            }));
            if (allowance < amountWei) {
                const approvalPolicy = evaluateActionPolicy({
                    actionType: "approve_token",
                    approvalAmount: input.amountIn,
                    spender: DODO_APPROVE_ADDRESS,
                    spenderVerified: true,
                    chainId: CHAIN_ID,
                    environment: PHAROS_ENVIRONMENT,
                    isMainnet: false,
                    signerAvailable: true,
                    requiresSigner: true,
                });
                if (approvalPolicy.decision === "BLOCK") {
                    return fail("POLICY_BLOCKED", `Swap approval blocked: ${approvalPolicy.reasons.join(" ")}`, false, "execute_swap");
                }
                const approveHash = await wallet.writeContract({
                    address: tokenAddr,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    args: [DODO_APPROVE_ADDRESS, amountWei],
                });
                await publicClient.waitForTransactionReceipt({ hash: approveHash });
            }
        }
        const txHash = await wallet.sendTransaction({
            to: quote.to,
            value: BigInt(quote.value),
            data: quote.calldata,
            gas: BigInt(quote.gasLimit),
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        return ok({
            txSuccess: receipt.status === "success",
            txHash,
            explorerUrl: getExplorerUrl(txHash),
            amountOut: quote.amountOut,
            signerMode: signer.mode,
            walletAddress,
            gasUsed: receipt.gasUsed.toString(),
            policy,
            riskAssessment: { riskScore: risk.riskScore, wasBlocked: false },
            source: "execute_swap",
        });
    }
    catch (err) {
        return classifyExternalError("pharos_rpc", err);
    }
}
//# sourceMappingURL=executeSwap.js.map