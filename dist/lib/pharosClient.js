// ─── Pharos Chain Client ───────────────────────────────────────────────
// viem publicClient & walletClient factory for Pharos Atlantic Testnet.
// ────────────────────────────────────────────────────────────────────────
import { createPublicClient, createWalletClient, http, fallback, defineChain, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RPC_URL, CHAIN_ID, EXPLORER_BASE, PHAROS_ENVIRONMENT, IS_MAINNET } from "./constants.js";
// Support multiple comma-separated RPC URLs for failover.
// PHAROS_RPC_URLS takes priority; falls back to single PHAROS_RPC_URL.
const RPC_URLS = (process.env.PHAROS_RPC_URLS || RPC_URL)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
function buildTransport() {
    const transports = RPC_URLS.map((url) => http(url, { timeout: 10_000, retryCount: 1, retryDelay: 250 }));
    return transports.length > 1 ? fallback(transports) : transports[0];
}
// ─── Chain Definition ──────────────────────────────────────────────────
export const pharosAtlantic = defineChain({
    id: CHAIN_ID,
    name: `Pharos ${PHAROS_ENVIRONMENT}`,
    nativeCurrency: {
        name: "PHRS",
        symbol: "PHRS",
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: [RPC_URL],
        },
    },
    blockExplorers: {
        default: {
            name: "PharosScan",
            url: EXPLORER_BASE.replace("/tx/", ""),
        },
    },
    testnet: !IS_MAINNET,
});
// ─── Public Client (read-only) ─────────────────────────────────────────
export const publicClient = createPublicClient({
    chain: pharosAtlantic,
    transport: buildTransport(),
});
// ─── Wallet Client Factory ─────────────────────────────────────────────
/**
 * Creates a wallet client for signing and sending transactions.
 * Private key is passed per-request and NEVER stored.
 */
export function createPharosWalletClient(privateKey) {
    const account = privateKeyToAccount(privateKey);
    return createPharosWalletClientFromAccount(account);
}
export function createPharosWalletClientFromAccount(account) {
    return createWalletClient({
        account,
        chain: pharosAtlantic,
        transport: buildTransport(),
    });
}
// ─── Utility: Explorer Link ────────────────────────────────────────────
export function getExplorerUrl(txHash) {
    return `${EXPLORER_BASE}${txHash}`;
}
//# sourceMappingURL=pharosClient.js.map