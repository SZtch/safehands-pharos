// ─── Pharos Chain Client ───────────────────────────────────────────────
// viem publicClient & walletClient factory for Pharos Atlantic Testnet.
// ────────────────────────────────────────────────────────────────────────

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RPC_URL, CHAIN_ID, EXPLORER_BASE, PHAROS_ENVIRONMENT, IS_MAINNET } from "./constants.js";

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

export const publicClient: PublicClient<Transport, Chain> = createPublicClient({
  chain: pharosAtlantic,
  transport: http(RPC_URL, { timeout: 10_000, retryCount: 2, retryDelay: 250 }),
});

// ─── Wallet Client Factory ─────────────────────────────────────────────

/**
 * Creates a wallet client for signing and sending transactions.
 * Private key is passed per-request and NEVER stored.
 */
export function createPharosWalletClient(
  privateKey: `0x${string}`
): WalletClient<Transport, Chain, Account> {
  const account = privateKeyToAccount(privateKey);
  return createPharosWalletClientFromAccount(account);
}

export function createPharosWalletClientFromAccount(
  account: Account
): WalletClient<Transport, Chain, Account> {
  return createWalletClient({
    account,
    chain: pharosAtlantic,
    transport: http(RPC_URL, { timeout: 10_000, retryCount: 2, retryDelay: 250 }),
  });
}

// ─── Utility: Explorer Link ────────────────────────────────────────────

export function getExplorerUrl(txHash: string): string {
  return `${EXPLORER_BASE}${txHash}`;
}
