// ─── SafeHands Network Registry ────────────────────────────────────────
// Mainnet-first: Pharos Pacific Mainnet is the DEFAULT active network for
// read-only SafeHands checks. Atlantic Testnet remains available via the
// SAFEHANDS_NETWORK env var for demo, compatibility, contract testing, and
// x402 testing.
//
// Read-only by default. No private keys and no premium/keyed RPC URLs are
// hardcoded here — optional provider URLs (ZAN/Alchemy/Nirvana) are read from
// the environment only.
// ────────────────────────────────────────────────────────────────────────

export type NetworkName = "pacific-mainnet" | "atlantic-testnet";

export interface PharosNetwork {
  name: NetworkName;
  label: string;
  chainId: number;
  nativeToken: string;
  /** Public, key-free default RPC endpoint. */
  defaultRpcUrl: string;
  explorerUrl: string;
  socialScanUrl?: string;
  isMainnet: boolean;
  /** Read-only SafeHands checks are always allowed. */
  readOnlyChecks: boolean;
  /** Whether execution/write/payment is permitted on this network at all. */
  executionAllowed: boolean;
}

/** Mainnet-first default. */
export const DEFAULT_NETWORK_NAME: NetworkName = "pacific-mainnet";

export const NETWORKS: Record<NetworkName, PharosNetwork> = {
  "pacific-mainnet": {
    name: "pacific-mainnet",
    label: "Pharos Pacific Mainnet",
    chainId: 1672,
    nativeToken: "PROS",
    defaultRpcUrl: "https://rpc.pharos.xyz",
    explorerUrl: "https://www.pharosscan.xyz",
    socialScanUrl: "https://pharos.socialscan.io",
    isMainnet: true,
    readOnlyChecks: true,
    // Execution at the network level targets Pacific Mainnet (all-mainnet), but
    // every write stays gated by WRITE_TOOLS_ENABLED + MANAGED_WALLET_ENABLED
    // (both default false) — a hosted deployment is read-only by default.
    executionAllowed: true,
  },
  "atlantic-testnet": {
    name: "atlantic-testnet",
    label: "Pharos Atlantic Testnet",
    chainId: 688689,
    nativeToken: "PROS",
    defaultRpcUrl: "https://atlantic.dplabs-internal.com/",
    explorerUrl: "https://atlantic.pharosscan.xyz/",
    socialScanUrl: "https://pharos.socialscan.io",
    isMainnet: false,
    readOnlyChecks: true,
    // No mainnet execution — SafeHands is all-mainnet. Atlantic remains for
    // read-only checks / compatibility only.
    executionAllowed: false,
  },
};

export function isNetworkName(value: string | undefined): value is NetworkName {
  return value === "pacific-mainnet" || value === "atlantic-testnet";
}

/** Resolve the active network name from SAFEHANDS_NETWORK (default mainnet-first). */
export function getActiveNetworkName(): NetworkName {
  const raw = process.env.SAFEHANDS_NETWORK;
  return isNetworkName(raw) ? raw : DEFAULT_NETWORK_NAME;
}

export function getNetwork(name: NetworkName): PharosNetwork {
  return NETWORKS[name];
}

export function getActiveNetwork(): PharosNetwork {
  return NETWORKS[getActiveNetworkName()];
}

export function getNetworkByChainId(chainId: number): PharosNetwork | undefined {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}

/**
 * Resolve the RPC URL for a network. Priority:
 *   1. Network-specific override env var
 *   2. Optional provider env vars (ZAN > Alchemy > Nirvana) — mainnet only
 *   3. The public, key-free default RPC
 * Premium/keyed URLs are NEVER hardcoded — they are only ever read from env.
 */
export function resolveRpcUrl(network: PharosNetwork): string {
  if (network.name === "pacific-mainnet") {
    return (
      process.env.PHAROS_MAINNET_RPC_URL ||
      process.env.PHAROS_PACIFIC_RPC_URL ||
      process.env.PHAROS_RPC_URL ||
      process.env.ZAN_PHAROS_MAINNET_RPC_URL ||
      process.env.PHAROS_ZAN_RPC_URL ||
      process.env.ALCHEMY_PHAROS_MAINNET_RPC_URL ||
      process.env.NIRVANA_PHAROS_MAINNET_RPC_URL ||
      network.defaultRpcUrl
    );
  }
  return process.env.PHAROS_ATLANTIC_RPC_URL || network.defaultRpcUrl;
}

export type RpcProviderName = "zan" | "alchemy" | "nirvana" | "custom" | "pharos-public";

/**
 * Redacted RPC provider descriptor — the provider NAME and whether it came from
 * env, but NEVER the URL or API key. Safe to expose in /public-config and
 * /infra/status. The provider name is inferred from which env var is set (an
 * explicit PHAROS_RPC_PROVIDER label wins for custom URLs).
 */
export interface RpcProviderDescriptor {
  name: RpcProviderName;
  configuredViaEnv: boolean;
  usingPublicDefault: boolean;
}

export function resolveRpcProvider(network: PharosNetwork): RpcProviderDescriptor {
  const explicit = process.env.PHAROS_RPC_PROVIDER?.trim().toLowerCase();
  const labelled = (fallback: RpcProviderName): RpcProviderName =>
    explicit === "zan" || explicit === "alchemy" || explicit === "nirvana" || explicit === "custom" || explicit === "pharos-public"
      ? (explicit as RpcProviderName)
      : fallback;

  if (network.name === "pacific-mainnet") {
    if (process.env.PHAROS_MAINNET_RPC_URL || process.env.PHAROS_PACIFIC_RPC_URL || process.env.PHAROS_RPC_URL) return { name: labelled("custom"), configuredViaEnv: true, usingPublicDefault: false };
    if (process.env.ZAN_PHAROS_MAINNET_RPC_URL || process.env.PHAROS_ZAN_RPC_URL) return { name: "zan", configuredViaEnv: true, usingPublicDefault: false };
    if (process.env.ALCHEMY_PHAROS_MAINNET_RPC_URL) return { name: "alchemy", configuredViaEnv: true, usingPublicDefault: false };
    if (process.env.NIRVANA_PHAROS_MAINNET_RPC_URL) return { name: "nirvana", configuredViaEnv: true, usingPublicDefault: false };
    return { name: "pharos-public", configuredViaEnv: false, usingPublicDefault: true };
  }
  if (process.env.PHAROS_ATLANTIC_RPC_URL) return { name: labelled("custom"), configuredViaEnv: true, usingPublicDefault: false };
  return { name: "pharos-public", configuredViaEnv: false, usingPublicDefault: true };
}

/** Build the explorer transaction-link base (e.g. https://www.pharosscan.xyz/tx/). */
export function explorerTxBase(network: PharosNetwork): string {
  const base = network.explorerUrl.replace(/\/+$/, "");
  return `${base}/tx/`;
}
