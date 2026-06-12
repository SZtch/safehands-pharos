// ─── Tool: get_execution_history ───────────────────────────────────────
import { z } from "zod";
import { publicClient, getExplorerUrl } from "../lib/pharosClient.js";
import { DODO_ROUTE_PROXY_ADDRESS } from "../lib/constants.js";
import { formatEther } from "viem";

export const getExecutionHistorySchema = z.object({
  walletAddress: z.string(),
  limit: z.number().optional().default(20),
  filter: z.enum(["swap", "transfer", "all"]).optional().default("all"),
});

export type GetExecutionHistoryInput = z.infer<typeof getExecutionHistorySchema>;

export const getExecutionHistoryTool = {
  name: "get_execution_history",
  description: "Pull on-chain transaction history for a wallet on Pharos. Filters by swap, transfer, or all.",
  inputSchema: getExecutionHistorySchema,
};

export async function handleGetExecutionHistory(input: GetExecutionHistoryInput) {
  const history: Array<{
    txHash: string;
    explorerUrl: string;
    type: "swap" | "transfer" | "other";
    timestamp: string;
    status: "success" | "failed";
    value: string;
    details: string;
  }> = [];

  try {
    const blockNumber = await publicClient.getBlockNumber();
    // Scan last ~500 blocks for transactions
    const fromBlock = blockNumber > 500n ? blockNumber - 500n : 0n;

    // Use eth_getLogs to find transactions involving the wallet
    // For a more complete solution, we'd use an indexer. Here we check recent blocks.
    const batchSize = 50;
    let found = 0;

    for (let b = blockNumber; b > fromBlock && found < input.limit; b -= 1n) {
      try {
        const block = await publicClient.getBlock({
          blockNumber: b,
          includeTransactions: true,
        });

        for (const tx of block.transactions) {
          if (found >= input.limit) break;
          if (typeof tx === "string") continue;

          const isFrom = tx.from.toLowerCase() === input.walletAddress.toLowerCase();
          const isTo = tx.to?.toLowerCase() === input.walletAddress.toLowerCase();

          if (!isFrom && !isTo) continue;

          const isDodoSwap = tx.to?.toLowerCase() === DODO_ROUTE_PROXY_ADDRESS.toLowerCase();
          const txType: "swap" | "transfer" | "other" = isDodoSwap
            ? "swap"
            : tx.value > 0n
              ? "transfer"
              : "other";

          if (input.filter !== "all" && txType !== input.filter) continue;

          // Get receipt for status
          let status: "success" | "failed" = "success";
          try {
            const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
            status = receipt.status === "success" ? "success" : "failed";
          } catch {
            // skip
          }

          history.push({
            txHash: tx.hash,
            explorerUrl: getExplorerUrl(tx.hash),
            type: txType,
            timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
            status,
            value: formatEther(tx.value),
            details: isDodoSwap
              ? `Swap via FaroSwap (DODO)`
              : isFrom
                ? `Sent ${formatEther(tx.value)} PHRS to ${tx.to}`
                : `Received ${formatEther(tx.value)} PHRS from ${tx.from}`,
          });
          found++;
        }
      } catch {
        // skip blocks that fail to load
        continue;
      }
    }
  } catch (err) {
    return {
      walletAddress: input.walletAddress,
      totalFetched: 0,
      history: [],
      error: `Failed to fetch history: ${(err as Error).message}`,
    };
  }

  return {
    walletAddress: input.walletAddress,
    totalFetched: history.length,
    history,
  };
}
