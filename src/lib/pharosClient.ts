// ─── Pharos Chain Client ───────────────────────────────────────────────
// viem publicClient & walletClient factory for Pharos Atlantic Testnet.
// ────────────────────────────────────────────────────────────────────────

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  defineChain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
} from "viem";
import { RPC_URL, CHAIN_ID, EXPLORER_BASE, IS_MAINNET } from "./constants.js";
import { getActiveNetwork } from "./networks.js";

const ACTIVE_NETWORK = getActiveNetwork();

// Support multiple comma-separated RPC URLs for failover.
// PHAROS_RPC_URLS takes priority; falls back to single PHAROS_RPC_URL.
const RPC_URLS: string[] = (process.env.PHAROS_RPC_URLS || RPC_URL)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function buildTransport() {
  const transports = RPC_URLS.map((url) => http(url, { timeout: 10_000, retryCount: 1, retryDelay: 250 }));
  return transports.length > 1 ? fallback(transports) : transports[0];
}

// ─── Chain Definition ──────────────────────────────────────────────────

export const pharosNetwork = defineChain({
  id: CHAIN_ID,
  name: ACTIVE_NETWORK.label,
  nativeCurrency: {
    name: ACTIVE_NETWORK.nativeToken,
    symbol: ACTIVE_NETWORK.nativeToken,
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

export const publicClient: PublicClient<Transport, Chain> = createPublicClient({
  chain: pharosNetwork,
  transport: buildTransport(),
});

// ─── Wallet Client Factory ─────────────────────────────────────────────

export function createPharosWalletClientFromAccount(
  account: Account
): WalletClient<Transport, Chain, Account> {
  return createWalletClient({
    account,
    chain: pharosNetwork,
    transport: buildTransport(),
  });
}

// ─── Utility: Explorer Link ────────────────────────────────────────────

export function getExplorerUrl(txHash: string): string {
  return `${EXPLORER_BASE}${txHash}`;
}
