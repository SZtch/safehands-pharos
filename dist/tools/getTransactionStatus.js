// ─── Tool: get_transaction_status ──────────────────────────────────────
// Checks on-chain transaction status by hash via viem.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, getExplorerUrl } from "../lib/pharosClient.js";
export const getTransactionStatusSchema = z.object({
    txHash: z.string().describe("Transaction hash to look up"),
});
export const getTransactionStatusTool = {
    name: "get_transaction_status",
    description: "Check the on-chain status of a transaction by its hash. Returns status, block number, gas used, and explorer link.",
    inputSchema: getTransactionStatusSchema,
};
export async function handleGetTransactionStatus(raw) {
    const input = getTransactionStatusSchema.parse(raw);
    const hash = input.txHash;
    // Try to get the receipt first (only exists if tx is mined)
    try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        const tx = await publicClient.getTransaction({ hash });
        return {
            txHash: input.txHash,
            status: receipt.status === "success" ? "success" : "failed",
            blockNumber: receipt.blockNumber.toString(),
            blockHash: receipt.blockHash,
            from: receipt.from,
            to: receipt.to,
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: receipt.effectiveGasPrice.toString(),
            value: tx.value.toString(),
            explorerUrl: getExplorerUrl(input.txHash),
        };
    }
    catch {
        // Receipt not found — check if the tx exists at all (pending)
        try {
            const tx = await publicClient.getTransaction({ hash });
            return {
                txHash: input.txHash,
                status: "pending",
                blockNumber: null,
                blockHash: null,
                from: tx.from,
                to: tx.to,
                gasUsed: null,
                effectiveGasPrice: null,
                value: tx.value.toString(),
                explorerUrl: getExplorerUrl(input.txHash),
            };
        }
        catch {
            return {
                txHash: input.txHash,
                status: "not_found",
                blockNumber: null,
                blockHash: null,
                from: null,
                to: null,
                gasUsed: null,
                effectiveGasPrice: null,
                value: null,
                explorerUrl: getExplorerUrl(input.txHash),
                error: "Transaction not found on chain",
            };
        }
    }
}
//# sourceMappingURL=getTransactionStatus.js.map