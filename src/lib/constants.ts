// ─── SafeHands Constants ───────────────────────────────────────────────
// Pharos Pacific Mainnet-first defaults with Atlantic Testnet compatibility.
// Official references reviewed during QA (USDC re-verified against Circle's
// contract-addresses page on 2026-07-10):
// - Pharos Hardhat guide: Atlantic Testnet chain ID 688689, RPC https://atlantic.dplabs-internal.com
// - Official Pharos Skill Engine tokens.json: USDC = 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8
// - Circle USDC contract addresses page (developers.circle.com/stablecoins/usdc-contract-addresses):
//     Pharos (Mainnet) = 0xC879C018dB60520F4355C26eD1a6D572cdAC1815 (= PACIFIC_USDC_ADDRESS)
//     Pharos Testnet   = 0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B (= CIRCLE_USDC_ADDRESS)
//   (An earlier comment here mislabeled 0xcfC8… as mainnet — it is Circle's TESTNET USDC.)
// - For Pharos Skill Engine testnet compatibility, the Atlantic token list defaults to the
//   Skill Engine list; the mainnet canonical USDC is the Circle/Pharos-docs 0xC879… address.
// ────────────────────────────────────────────────────────────────────────

// ─── Network ───────────────────────────────────────────────────────────
// Mainnet-first: defaults resolve from the active network in networks.ts
// (default pacific-mainnet). Existing PHAROS_* env vars still override for
// backward compatibility and Atlantic testnet selection.

import { parseAbi } from "viem";
import { getActiveNetwork, resolveRpcUrl, explorerTxBase } from "./networks.js";
import { ECOSYSTEM_REGISTRY_ITEMS } from "../data/ecosystemRegistry.data.js";

const ACTIVE_NETWORK = getActiveNetwork();

export const PHAROS_ENVIRONMENT = process.env.PHAROS_ENVIRONMENT || ACTIVE_NETWORK.name;
export const CHAIN_ID = Number(process.env.PHAROS_CHAIN_ID || ACTIVE_NETWORK.chainId);
export const RPC_URL = process.env.PHAROS_RPC_URL || resolveRpcUrl(ACTIVE_NETWORK);
export const EXPLORER_BASE = process.env.PHAROS_EXPLORER_BASE || explorerTxBase(ACTIVE_NETWORK);
export const IS_MAINNET = ACTIVE_NETWORK.isMainnet;

// ─── Token Addresses ───────────────────────────────────────────────────
// These are the ATLANTIC-TESTNET / Skill-Engine-compat addresses (activeTokenMap
// switches to the Pacific registry on mainnet). The one evidenced canonical
// mainnet USDC is PACIFIC_USDC_ADDRESS (0xC879…), confirmed by BOTH the Pharos
// docs token registry AND Circle's contract-addresses page (re-checked 2026-07-10).

/** Native PROS — sentinel address used by DODO API for native token */
export const PROS_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
export const USDT_ADDRESS = "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5" as const;

/** Skill-Engine-compat USDC (official pharos-skill-engine tokens.json); testnet compat list only. */
export const USDC_ADDRESS = "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8" as const;

/** Circle's Pharos TESTNET USDC (per Circle's contract-addresses page). Used only as the Atlantic alt-USDC route fallback — never a mainnet claim. */
export const CIRCLE_USDC_ADDRESS = "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B" as const;

export const WBTC_ADDRESS = "0x0c64F03EEa5c30946D5c55B4b532D08ad74638a4" as const;
export const WETH_ADDRESS = "0x7d211F77525ea39A0592794f793cC1036eEaccD5" as const;
export const WPROS_ADDRESS = "0x838800b758277CC111B2d48Ab01e5E164f8E9471" as const;

export const TOKEN_REGISTRY = {
  PROS: {
    symbol: "PROS",
    address: PROS_ADDRESS,
    decimals: 18,
    chainId: 688689,
    environment: "atlantic-testnet",
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "native PROS sentinel address for DODO route API",
    docsSource: "https://docs.pharos.xyz/",
  },
  USDC: {
    symbol: "USDC",
    address: USDC_ADDRESS,
    decimals: 6,
    chainId: 688689,
    environment: "atlantic-testnet",
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "Pharos Skill Engine USDC — the USDC listed in the official pharos-skill-engine-0.1.0 assets/tokens.json for pacific-mainnet",
    docsSource: "pharos-skill-engine-0.1.0/assets/tokens.json",
    verificationStatus: "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE",
  },
  CIRCLE_USDC: {
    symbol: "CIRCLE_USDC",
    address: CIRCLE_USDC_ADDRESS,
    decimals: 6,
    chainId: 688689,
    environment: "atlantic-testnet",
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "Circle's Pharos TESTNET USDC (Circle contract-addresses page, re-checked 2026-07-10); Atlantic alt-USDC route fallback, not the primary Skill-Engine token",
    docsSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
    verificationStatus: "CIRCLE_DOCS_VERIFIED_TESTNET",
  },
  USDT: {
    symbol: "USDT",
    address: USDT_ADDRESS,
    decimals: 6,
    chainId: 688689,
    environment: "atlantic-testnet",
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "canonical Pharos Atlantic Testnet USDT (Tether USD)",
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
  WBTC: {
    symbol: "WBTC",
    address: WBTC_ADDRESS,
    decimals: 18,
    chainId: 688689,
    environment: "atlantic-testnet",
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "canonical Pharos Atlantic Testnet WBTC (Wrapped BTC)",
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
  WETH: {
    symbol: "WETH",
    address: WETH_ADDRESS,
    decimals: 18,
    chainId: 688689,
    environment: "atlantic-testnet",
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "canonical Pharos Atlantic Testnet WETH (Wrapped ETH)",
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
  WPROS: {
    symbol: "WPROS",
    address: WPROS_ADDRESS,
    decimals: 18,
    chainId: 688689,
    environment: "atlantic-testnet",
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "canonical Pharos Atlantic Testnet WPROS (Wrapped PROS)",
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
} as const;

// ─── Pharos Pacific Mainnet token registry (chain 1672) ────────────────
// Official addresses from docs.pharos.xyz/getting-started/token-registry,
// recorded from the Phase 5A Pharos docs audit. Read-only metadata only —
// recognition is by registry address; it is NOT a safety guarantee for an action.
// Decimals follow the ERC-20 standard for each token type (USDC = 6; wrapped = 18).
export const PACIFIC_WPROS_ADDRESS = "0x52c48d4213107b20bc583832b0d951fb9ca8f0b0" as const;
// Circle-deployed — dual-evidenced: Pharos docs token registry AND Circle's own
// contract-addresses page list this address for Pharos (Mainnet). Re-checked 2026-07-10.
export const PACIFIC_USDC_ADDRESS = "0xc879c018db60520f4355c26ed1a6d572cdac1815" as const;
export const PACIFIC_LINK_ADDRESS = "0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29" as const;
export const PACIFIC_WETH_ADDRESS = "0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9" as const;

export const PACIFIC_MAINNET_TOKEN_REGISTRY = {
  WPROS: {
    symbol: "WPROS",
    name: "Wrapped PROS",
    address: PACIFIC_WPROS_ADDRESS,
    decimals: 18,
    chainId: 1672,
    environment: "pacific-mainnet",
    isMainnet: true,
    isCanonical: true,
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin (Circle-deployed)",
    address: PACIFIC_USDC_ADDRESS,
    decimals: 6,
    chainId: 1672,
    environment: "pacific-mainnet",
    isMainnet: true,
    isCanonical: true,
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry and https://developers.circle.com/stablecoins/usdc-contract-addresses",
    verificationStatus: "DOCS_VERIFIED",
  },
  LINK: {
    symbol: "LINK",
    name: "ChainLink Token",
    address: PACIFIC_LINK_ADDRESS,
    decimals: 18,
    chainId: 1672,
    environment: "pacific-mainnet",
    isMainnet: true,
    isCanonical: true,
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: PACIFIC_WETH_ADDRESS,
    decimals: 18,
    chainId: 1672,
    environment: "pacific-mainnet",
    isMainnet: true,
    isCanonical: true,
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
} as const;

// ─── Token Decimals ────────────────────────────────────────────────────

export const TOKEN_DECIMALS: Record<string, number> = {
  PROS: 18,
  USDT: 6,
  USDC: 6,
  CIRCLE_USDC: 6,
  WBTC: 18,
  WETH: 18,
  WPROS: 18,
  [PROS_ADDRESS.toLowerCase()]: 18,
  [USDT_ADDRESS.toLowerCase()]: 6,
  [USDC_ADDRESS.toLowerCase()]: 6,
  [CIRCLE_USDC_ADDRESS.toLowerCase()]: 6,
  [WBTC_ADDRESS.toLowerCase()]: 18,
  [WETH_ADDRESS.toLowerCase()]: 18,
  [WPROS_ADDRESS.toLowerCase()]: 18,
};

// ─── Token Symbol → Address Mapping ────────────────────────────────────

export const TOKEN_MAP: Record<string, `0x${string}`> = {
  PROS: PROS_ADDRESS,
  USDT: USDT_ADDRESS,
  USDC: USDC_ADDRESS,
  CIRCLE_USDC: CIRCLE_USDC_ADDRESS,
  WBTC: WBTC_ADDRESS,
  WETH: WETH_ADDRESS,
  WPROS: WPROS_ADDRESS,
};

// ─── Pacific Mainnet token map (chain 1672) ────────────────────────────
// Used for swaps / market data on mainnet. PROS/PROS share the native sentinel
// that DODO expects; canonical ERC-20s come from PACIFIC_MAINNET_TOKEN_REGISTRY.
export const PACIFIC_TOKEN_MAP: Record<string, `0x${string}`> = {
  PROS: PROS_ADDRESS,
  WPROS: PACIFIC_WPROS_ADDRESS,
  USDC: PACIFIC_USDC_ADDRESS,
  WETH: PACIFIC_WETH_ADDRESS,
  LINK: PACIFIC_LINK_ADDRESS,
};

export const PACIFIC_TOKEN_DECIMALS: Record<string, number> = {
  PROS: 18,
  WPROS: 18,
  USDC: 6,
  WETH: 18,
  LINK: 18,
  [PROS_ADDRESS.toLowerCase()]: 18,
  [PACIFIC_WPROS_ADDRESS.toLowerCase()]: 18,
  [PACIFIC_USDC_ADDRESS.toLowerCase()]: 6,
  [PACIFIC_WETH_ADDRESS.toLowerCase()]: 18,
  [PACIFIC_LINK_ADDRESS.toLowerCase()]: 18,
};

/** Network-aware token symbol→address map (mainnet-first). */
export function activeTokenMap(): Record<string, `0x${string}`> {
  return getActiveNetwork().isMainnet ? PACIFIC_TOKEN_MAP : TOKEN_MAP;
}

/** Network-aware token decimals (mainnet-first). */
export function activeTokenDecimals(): Record<string, number> {
  return getActiveNetwork().isMainnet ? PACIFIC_TOKEN_DECIMALS : TOKEN_DECIMALS;
}

/** Active canonical USDC address (mainnet 0xc879…, else Skill-Engine USDC). */
export function activeUsdcAddress(): `0x${string}` {
  return getActiveNetwork().isMainnet ? PACIFIC_USDC_ADDRESS : USDC_ADDRESS;
}


/** Active network token registry metadata (mainnet-first). */
export function activeTokenRegistry(): Record<string, { symbol: string; address: `0x${string}`; decimals: number; [key: string]: unknown }> {
  return getActiveNetwork().isMainnet
    ? (PACIFIC_MAINNET_TOKEN_REGISTRY as unknown as Record<string, { symbol: string; address: `0x${string}`; decimals: number; [key: string]: unknown }>)
    : (TOKEN_REGISTRY as unknown as Record<string, { symbol: string; address: `0x${string}`; decimals: number; [key: string]: unknown }>);
}

/** x402 payment assets SafeHands recognizes for the active network. */
export function activeX402AllowedTokenAddresses(): `0x${string}`[] {
  return getActiveNetwork().isMainnet
    ? [PACIFIC_USDC_ADDRESS, PACIFIC_WPROS_ADDRESS]
    : [USDC_ADDRESS, WPROS_ADDRESS];
}

// ─── FaroSwap / DODO Protocol ──────────────────────────────────────────
// PROVENANCE: these addresses originate from the pre-registry Atlantic-testnet
// FaroSwap integration and are NOT in the canonical ecosystem registry — the
// registry's FaroSwap mainnet entry (protocol:pacific-mainnet:faroswap) is
// UNVERIFIED with no bundled contracts. They are RESTRICTION-ONLY values: the
// write path uses them as allowlists that constrain which router/spender a DODO
// quote may execute against (fail-closed containment). They must NEVER be used
// as trust/"known"/verified signals — spender/counterparty trust comes only from
// addressTrustEvidence() in lib/ecosystemRegistry.ts.

export const DODO_APPROVE_ADDRESS = "0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9" as const;
export const DODO_ROUTE_PROXY_ADDRESS = "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2" as const;

function parseAddressCsv(value: string | undefined, fallback: readonly string[]): `0x${string}`[] {
  const source = value && value.trim().length > 0 ? value.split(",") : [...fallback];
  return source
    .map((item) => item.trim())
    .filter((item): item is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(item));
}

export function activeDodoSpenderAllowlist(): `0x${string}`[] {
  return parseAddressCsv(process.env.DODO_SPENDER_ALLOWLIST || process.env.SAFEHANDS_DODO_SPENDER_ALLOWLIST, [DODO_APPROVE_ADDRESS]);
}

export function activeDodoRouterAllowlist(): `0x${string}`[] {
  return parseAddressCsv(process.env.DODO_ROUTER_ALLOWLIST || process.env.SAFEHANDS_DODO_ROUTER_ALLOWLIST, [DODO_ROUTE_PROXY_ADDRESS]);
}

export function isAllowedDodoSpender(address: string): boolean {
  return activeDodoSpenderAllowlist().some((allowed) => allowed.toLowerCase() === address.toLowerCase());
}

export function isAllowedDodoRouter(address: string): boolean {
  return activeDodoRouterAllowlist().some((allowed) => allowed.toLowerCase() === address.toLowerCase());
}

// ─── DODO API ──────────────────────────────────────────────────────────

export const DODO_API_BASE = process.env.DODO_API_BASE || "https://api.dodoex.io";
export const DODO_API_KEY = process.env.DODO_API_KEY;
export const DODO_DEFAULT_SLIPPAGE = 3;
export const DODO_ROUTE_ENDPOINT = "/route-service/v2/widget/getdodoroute";

// ─── Risk Engine Thresholds ────────────────────────────────────────────

// Weighted risk-engine block boundary (block when score > 80). NOTE: the hosted
// Anvita engine deliberately blocks earlier (score ≥ 70) — see
// docs/DECISION_CONTRACT.md §Thresholds for the documented divergence.
export const RISK_BLOCK_THRESHOLD = 80;
export const MAX_SLIPPAGE_PCT = 5;
export const MAX_BALANCE_USAGE_PCT = 90;

// ─── Safety Limits ─────────────────────────────────────────────────────

export const MAX_TX_AMOUNT_PROS = process.env.MAX_TX_AMOUNT_PROS || "0.1";
export const MAX_APPROVAL_AMOUNT_USDC = process.env.MAX_APPROVAL_AMOUNT_USDC || "10";
export const MAX_DAILY_SPEND_USD = process.env.MAX_DAILY_SPEND_USD || "10";
export const MAX_X402_PAYMENT_USDC = process.env.MAX_X402_PAYMENT_USDC || "0.01";
export const X402_PAYMENT_TOKEN_ADDRESS = (process.env.X402_PAYMENT_TOKEN_ADDRESS || activeUsdcAddress()) as `0x${string}`;

// ─── Risk Weights ──────────────────────────────────────────────────────

export const RISK_WEIGHTS = {
  liquidityRisk: 0.25,
  slippageRisk: 0.25,
  counterpartyRisk: 0.20,
  balanceRisk: 0.15,
  marketConditionRisk: 0.15,
} as const;

// ─── ERC-20 Minimal ABI ────────────────────────────────────────────────

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ─── Managed-execution authorization gates ─────────────────────────
// NOTE: RiskRegistryV2 was retired in the P12 two-contract refactor. Managed-wallet
// authorization now reads from SafeHandsRegistry (see lib/safeHandsRegistry.ts);
// the former RISK_REGISTRY_V2_ADDRESS / RISK_REGISTRY_V2_ABI / DEFAULT_RISK_REGISTRY_VERSION
// exports were dead (unreferenced) and have been removed.

export const REQUIRE_AUTHORIZED_AGENT_FOR_WRITE =
  (process.env.REQUIRE_AUTHORIZED_AGENT_FOR_WRITE ?? "true") === "true";

// x402 is permissionless-first: self-signed x402 (the agent's own key) never needed
// registry authorization, and a managed/custodial x402 payment is allowlist-gated
// ONLY when this is explicitly opted in. Default OFF so x402 stays frictionless;
// the heavier managed write paths (swap/payment/approve) keep the default-on
// REQUIRE_AUTHORIZED_AGENT_FOR_WRITE gate above.
export const REQUIRE_AUTHORIZED_AGENT_FOR_X402 =
  process.env.REQUIRE_AUTHORIZED_AGENT_FOR_X402 === "true";

export const AUTO_AUTHORIZE_AGENT_WALLET =
  process.env.AUTO_AUTHORIZE_AGENT_WALLET === "true";

// ─── SafeHands on-chain layer (2-contract architecture) ────────────────
// SafeHandsRegistry    — trust + reputation oracle
// SafeHandsAttestation — immutable proof ledger (see pharos/attestationPublisher.ts)
// Deployed on Pharos Pacific mainnet (chainId 1672) and baked as READ-path
// defaults below. Env vars still override; a chainId guard keeps the baked
// defaults Pacific-only (any other chain resolves to "" → fail-closed). Write
// availability is gated separately (WRITE_TOOLS_ENABLED + attester key) via
// process.env reads, so baking these read defaults never enables a write.

const SAFEHANDS_REGISTRY_ADDRESS_PACIFIC = "0x428e02bf85412e7242d991cd6725ec59e8b06c8d";
const SAFEHANDS_ATTESTATION_ADDRESS_PACIFIC = "0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c";
const PACIFIC_MAINNET_CHAIN_ID = 1672;

/** Read-path resolver: env override → Pacific-mainnet baked default → "" (chainId-guarded, fail-closed). */
export function resolveSafeHandsRegistryAddress(chainId: number = CHAIN_ID): string {
  const env = process.env.SAFEHANDS_REGISTRY_ADDRESS || process.env.SAFEHANDS_RISK_REGISTRY_ADDRESS || "";
  if (env) return env;
  return chainId === PACIFIC_MAINNET_CHAIN_ID ? SAFEHANDS_REGISTRY_ADDRESS_PACIFIC : "";
}

/**
 * Read-path resolver: env override → Pacific-mainnet baked default → "" (chainId-guarded, fail-closed).
 * NOTE: the legacy SAFEHANDS_RISK_REGISTRY_ADDRESS var aliases the REGISTRY contract only and is
 * deliberately NOT accepted here — the attestation ledger is a different contract, and aliasing
 * both to one address produced ABI-mismatch reads.
 */
export function resolveSafeHandsAttestationAddress(chainId: number = CHAIN_ID): string {
  const env = process.env.SAFEHANDS_ATTESTATION_ADDRESS || "";
  if (env) return env;
  return chainId === PACIFIC_MAINNET_CHAIN_ID ? SAFEHANDS_ATTESTATION_ADDRESS_PACIFIC : "";
}

// Back-compat consts — existing reporting consumers keep importing these unchanged.
export const SAFEHANDS_REGISTRY_ADDRESS = resolveSafeHandsRegistryAddress();
export const SAFEHANDS_ATTESTATION_ADDRESS = resolveSafeHandsAttestationAddress();

// NOTE: the former NO_RISK_SCORE = 255 sentinel was removed — the Merkle-batched
// SafeHandsRegistry has no per-record riskScoreOf read, and no code path consumed
// the sentinel (its last import in agentEnrich.ts was dead).

export const SAFEHANDS_REGISTRY_ABI = parseAbi([
  "function owner() view returns (address)",
  "function isAuthorizedOperator(address) view returns (bool)",
  "function isAuthorizedAgent(address) view returns (bool)",
  "function setAuthorizedAgent(address agent, bool authorized)",
  "function setAuthorizedAgents(address[] agents, bool authorized)",
  "function setOperator(address operator, bool authorized)",
  "function currentMerkleRoot() view returns (bytes32)",
  "function currentDataURI() view returns (string)",
  "function commitRiskRoot(bytes32 root, string dataURI)",
  "function verifyRiskRecord(address target, bytes32 actionHash, uint8 score, uint8 level, uint8 recommendation, bytes32 policyVersionHash, bytes32 evidenceHash, uint64 expiresAt, bytes32[] proof) view returns (bool)",
]);

// ─── Canonical Infrastructure Contracts ─────────────────────────────────
// Recognized as safe by the SafeHands Policy Engine to reduce false positives.
// Derived from the canonical ecosystem registry (src/data/ecosystemRegistry.data.ts)
// so the policy engine, the read-API analyzer (contractIntel), and the Anvita
// hosted-skill assets all recognize the same set — the registry is the single
// source of truth for these addresses.
function canonicalRegistryAddresses(itemId: string): string[] {
  const item = ECOSYSTEM_REGISTRY_ITEMS.find((i) => i.id === itemId);
  return (item?.contracts ?? []).map((c) => c.address.toLowerCase());
}

export const PACIFIC_CANONICAL_CONTRACTS = canonicalRegistryAddresses(
  "infrastructure:pacific-mainnet:canonical-contracts",
);

export const ATLANTIC_CANONICAL_CONTRACTS = canonicalRegistryAddresses(
  "infrastructure:atlantic-testnet:canonical-contracts",
);

export function isCanonicalInfrastructure(address: string, isMainnet: boolean): boolean {
  if (!address) return false;
  const list = isMainnet ? PACIFIC_CANONICAL_CONTRACTS : ATLANTIC_CANONICAL_CONTRACTS;
  return list.includes(address.toLowerCase());
}
