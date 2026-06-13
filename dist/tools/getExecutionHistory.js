// ─── Tool: get_execution_history ───────────────────────────────────────
// Uses eth_getLogs for ERC-20 Transfer events (fast, covers token swaps)
// and a parallelised block scan of the last 100 blocks for native PHRS transfers.
// Prior approach scanned 500 blocks sequentially — 500+ RPC calls, always timed out.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, getExplorerUrl } from "../lib/pharosClient.js";
import { DODO_ROUTE_PROXY_ADDRESS, USDC_ADDRESS, USDT_ADDRESS, WBTC_ADDRESS, WETH_ADDRESS, WPHRS_ADDRESS, CIRCLE_USDC_ADDRESS, } from "../lib/constants.js";
import { formatEther, parseAbiItem } from "viem";
import { ok, fail } from "../lib/toolResponse.js";
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
export const getExecutionHistorySchema = z.object({
    walletAddress: z.string(),
    limit: z.number().optional().default(20),
    filter: z.enum(["swap", "transfer", "all"]).optional().default("all"),
});
// All known token addresses to scan for Transfer events (mutable array for viem compatibility)
const KNOWN_TOKEN_ADDRESSES = [
    USDC_ADDRESS,
    USDT_ADDRESS,
    WBTC_ADDRESS,
    WETH_ADDRESS,
    WPHRS_ADDRESS,
    CIRCLE_USDC_ADDRESS,
];
const ERC20_LOG_RANGE = 10000n; // blocks to scan for ERC-20 events
const NATIVE_SCAN_RANGE = 100n; // blocks for native PHRS scan
const NATIVE_BATCH_SIZE = 10; // parallel block fetches per batch
export const getExecutionHistoryTool = {
    name: "get_execution_history",
    description: "Pull on-chain transaction history for a wallet. Uses eth_getLogs for ERC-20 transfers and parallel block scan for native PHRS. Filters by swap, transfer, or all.",
    inputSchema: getExecutionHistorySchema,
};
export async function handleGetExecutionHistory(input) {
    const seen = new Set();
    const history = [];
    try {
        const blockNumber = await publicClient.getBlockNumber();
        const erc20FromBlock = blockNumber > ERC20_LOG_RANGE ? blockNumber - ERC20_LOG_RANGE : 0n;
        const nativeFromBlock = blockNumber > NATIVE_SCAN_RANGE ? blockNumber - NATIVE_SCAN_RANGE : 0n;
        const walletAddr = input.walletAddress;
        // ── ERC-20 Transfer logs ─────────────────────────────────────────────
        // Two queries: wallet as sender (from) and wallet as receiver (to)
        const empty = [];
        const [sentLogs, receivedLogs] = await Promise.all([
            publicClient.getLogs({
                fromBlock: erc20FromBlock,
                toBlock: blockNumber,
                address: KNOWN_TOKEN_ADDRESSES,
                event: TRANSFER_EVENT,
                args: { from: walletAddr },
                strict: true,
            }).catch(() => empty),
            publicClient.getLogs({
                fromBlock: erc20FromBlock,
                toBlock: blockNumber,
                address: KNOWN_TOKEN_ADDRESSES,
                event: TRANSFER_EVENT,
                args: { to: walletAddr },
                strict: true,
            }).catch(() => empty),
        ]);
        const allLogs = [...sentLogs, ...receivedLogs];
        // Resolve block timestamps in bulk for unique block numbers in logs
        const uniqueBlocks = [...new Set(allLogs.map((l) => l.blockNumber))];
        const blockTimestampMap = new Map();
        for (let i = 0; i < uniqueBlocks.length; i += NATIVE_BATCH_SIZE) {
            const batch = uniqueBlocks.slice(i, i + NATIVE_BATCH_SIZE);
            const blocks = await Promise.all(batch.map((bn) => publicClient.getBlock({ blockNumber: bn }).catch(() => null)));
            for (const block of blocks) {
                if (block) {
                    blockTimestampMap.set(block.number, new Date(Number(block.timestamp) * 1000).toISOString());
                }
            }
        }
        for (const log of allLogs) {
            if (history.length >= input.limit)
                break;
            if (!log.transactionHash || seen.has(log.transactionHash))
                continue;
            const isDodoSwap = log.address.toLowerCase() === DODO_ROUTE_PROXY_ADDRESS.toLowerCase()
                || sentLogs.some((l) => l.transactionHash === log.transactionHash && l.address.toLowerCase() === DODO_ROUTE_PROXY_ADDRESS.toLowerCase())
                || receivedLogs.some((l) => l.transactionHash === log.transactionHash && l.address.toLowerCase() === DODO_ROUTE_PROXY_ADDRESS.toLowerCase());
            const txType = isDodoSwap ? "swap" : "transfer";
            if (input.filter !== "all" && txType !== input.filter)
                continue;
            seen.add(log.transactionHash);
            history.push({
                txHash: log.transactionHash,
                explorerUrl: getExplorerUrl(log.transactionHash),
                type: txType,
                timestamp: blockTimestampMap.get(log.blockNumber) ?? "unknown",
                status: "unknown", // receipt not fetched per-log to avoid N+1
                value: "0",
                details: `ERC-20 Transfer on block ${log.blockNumber.toString()}`,
                blockNumber: log.blockNumber.toString(),
            });
        }
        // ── Native PHRS transfers — parallel block scan (last 100 blocks) ───
        if (input.filter !== "swap" && history.length < input.limit) {
            const blockNums = [];
            for (let b = blockNumber; b > nativeFromBlock; b--) {
                blockNums.push(b);
            }
            for (let i = 0; i < blockNums.length && history.length < input.limit; i += NATIVE_BATCH_SIZE) {
                const batch = blockNums.slice(i, i + NATIVE_BATCH_SIZE);
                const blocks = await Promise.all(batch.map((bn) => publicClient.getBlock({ blockNumber: bn, includeTransactions: true }).catch(() => null)));
                for (const block of blocks) {
                    if (!block)
                        continue;
                    const ts = new Date(Number(block.timestamp) * 1000).toISOString();
                    for (const tx of block.transactions) {
                        if (history.length >= input.limit)
                            break;
                        if (typeof tx === "string")
                            continue;
                        if (tx.value === 0n)
                            continue; // no native transfer
                        const isFrom = tx.from.toLowerCase() === input.walletAddress.toLowerCase();
                        const isTo = tx.to?.toLowerCase() === input.walletAddress.toLowerCase();
                        if (!isFrom && !isTo)
                            continue;
                        if (seen.has(tx.hash))
                            continue;
                        seen.add(tx.hash);
                        history.push({
                            txHash: tx.hash,
                            explorerUrl: getExplorerUrl(tx.hash),
                            type: "transfer",
                            timestamp: ts,
                            status: "unknown",
                            value: formatEther(tx.value),
                            details: isFrom
                                ? `Sent ${formatEther(tx.value)} PHRS to ${tx.to}`
                                : `Received ${formatEther(tx.value)} PHRS from ${tx.from}`,
                            blockNumber: block.number.toString(),
                        });
                    }
                }
            }
        }
        // Sort descending by block number
        history.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
    }
    catch (err) {
        return fail("HISTORY_FETCH_FAILED", `Failed to fetch history: ${err.message}`, true, "get_execution_history");
    }
    return ok({
        walletAddress: input.walletAddress,
        totalFetched: history.length,
        history,
        note: "ERC-20 history covers last 10,000 blocks via eth_getLogs. Native PHRS transfers cover last 100 blocks via parallel block scan.",
    });
}
//# sourceMappingURL=getExecutionHistory.js.map