// ─── Tool: estimate_gas ────────────────────────────────────────────────
// Estimates gas cost for a swap or transfer before executing.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { getDodoRoute, isNativeToken } from "../lib/dodoApi.js";
import { formatEther, formatGwei, isAddress, parseEther } from "viem";
import { CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";
export const estimateGasSchema = z.object({
    action: z.enum(["swap", "transfer"]).describe("Type of action to estimate gas for"),
    tokenIn: z.string().optional().describe("Token to swap from (for swaps)"),
    tokenOut: z.string().optional().describe("Token to swap to (for swaps)"),
    amount: z.string().describe("Human-readable amount"),
    walletAddress: z.string().describe("Sender wallet address"),
    toAddress: z.string().optional().describe("Recipient address (for transfers)"),
});
export const estimateGasTool = {
    name: "estimate_gas",
    description: "Estimate gas cost for a swap or transfer before executing. Returns gas units, cost in PHRS/USD, and whether the wallet has sufficient gas.",
    inputSchema: estimateGasSchema,
};
const QUOTE_WALLET = "0x0000000000000000000000000000000000000001";
export async function handleEstimateGas(raw) {
    const input = estimateGasSchema.parse(raw);
    if (!isAddress(input.walletAddress)) {
        return fail("INVALID_WALLET_ADDRESS", `Invalid wallet address: ${input.walletAddress}`, false, "estimate_gas");
    }
    const walletAddr = input.walletAddress;
    try {
        const gasPrice = await publicClient.getGasPrice();
        const balance = await publicClient.getBalance({ address: walletAddr });
        let gasEstimate;
        if (input.action === "transfer") {
            if (!input.toAddress) {
                return fail("MISSING_TO_ADDRESS", "toAddress is required for transfer gas estimation.", false, "estimate_gas");
            }
            if (!isAddress(input.toAddress)) {
                return fail("INVALID_RECIPIENT_ADDRESS", `Invalid recipient address: ${input.toAddress}`, false, "estimate_gas");
            }
            try {
                gasEstimate = await publicClient.estimateGas({
                    to: input.toAddress,
                    value: parseEther(input.amount),
                    account: walletAddr,
                });
            }
            catch {
                gasEstimate = 21000n;
            }
        }
        else {
            if (!input.tokenIn || !input.tokenOut) {
                return fail("MISSING_SWAP_TOKENS", "tokenIn and tokenOut are required for swap gas estimation.", false, "estimate_gas");
            }
            try {
                const quote = await getDodoRoute({
                    fromToken: input.tokenIn,
                    toToken: input.tokenOut,
                    amountHuman: input.amount,
                    walletAddress: input.walletAddress,
                });
                if (!quote.routeAvailable) {
                    return fail("NO_ROUTE_AVAILABLE", "No swap route available; cannot estimate gas.", true, "dodo_api");
                }
                gasEstimate = BigInt(quote.gasLimit);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message.includes("DODO_API_AUTH_REQUIRED")) {
                    return fail("DODO_API_AUTH_REQUIRED", "DODO/FaroSwap route API rejected public mode. Configure DODO_API_KEY only if this endpoint requires authenticated access.", false, "dodo_api");
                }
                if (message.includes("DODO_API_RATE_LIMITED")) {
                    return fail("DODO_API_RATE_LIMITED", message, true, "dodo_api");
                }
                return classifyExternalError("dodo_api", err);
            }
        }
        const gasCostWei = gasEstimate * gasPrice;
        const gasCostPHRS = formatEther(gasCostWei);
        let gasCostUsd = null;
        let priceSourceStatus = "unavailable";
        try {
            const priceQuote = await getDodoRoute({
                fromToken: "PHRS",
                toToken: "USDC",
                amountHuman: "1",
                walletAddress: QUOTE_WALLET,
            });
            if (priceQuote.routeAvailable) {
                gasCostUsd = (parseFloat(gasCostPHRS) * parseFloat(priceQuote.amountOut)).toFixed(6);
                priceSourceStatus = "ok";
            }
            else {
                priceSourceStatus = "no_route_available";
            }
        }
        catch {
            priceSourceStatus = "unavailable";
        }
        let totalNeeded = gasCostWei;
        if (input.action === "transfer" || (input.action === "swap" && isNativeToken(input.tokenIn || ""))) {
            totalNeeded += parseEther(input.amount);
        }
        const isSufficient = balance >= totalNeeded;
        return ok({
            action: input.action,
            gasEstimate: { value: gasEstimate.toString(), unit: "gas" },
            gasPrice: { value: formatGwei(gasPrice), unit: "gwei" },
            gasCostPHRS: { value: gasCostPHRS, unit: "PHRS" },
            gasCostUsd: gasCostUsd ? { value: gasCostUsd, unit: "USD" } : null,
            walletBalance: { value: formatEther(balance), unit: "PHRS" },
            isSufficient,
            priceSourceStatus,
            chainId: CHAIN_ID,
            environment: PHAROS_ENVIRONMENT,
            isMainnet: false,
            source: "pharos_rpc",
        });
    }
    catch (err) {
        return classifyExternalError("pharos_rpc", err);
    }
}
//# sourceMappingURL=estimateGas.js.map