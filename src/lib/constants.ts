// ─── SafeHands Constants ───────────────────────────────────────────────
// Pharos Pacific Mainnet-first defaults with Atlantic Testnet compatibility.
// Official references reviewed during QA:
// - Pharos Hardhat guide: Atlantic Testnet chain ID 688689, RPC https://atlantic.dplabs-internal.com
// - Official Pharos Skill Engine tokens.json: USDC = 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8
// - Circle USDC contract addresses page: Pharos Mainnet = 0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B
// - For Pharos Skill Engine compatibility, SafeHands defaults to the Skill Engine token list.
// ────────────────────────────────────────────────────────────────────────

// ─── Network ───────────────────────────────────────────────────────────
// Mainnet-first: defaults resolve from the active network in networks.ts
// (default pacific-mainnet). Existing PHAROS_* env vars still override for
// backward compatibility and Atlantic testnet selection.

import { parseAbi } from "viem";
import { getActiveNetwork, resolveRpcUrl, explorerTxBase } from "./networks.js";

const ACTIVE_NETWORK = getActiveNetwork();

export const PHAROS_ENVIRONMENT = process.env.PHAROS_ENVIRONMENT || ACTIVE_NETWORK.name;
export const CHAIN_ID = Number(process.env.PHAROS_CHAIN_ID || ACTIVE_NETWORK.chainId);
export const RPC_URL = process.env.PHAROS_RPC_URL || resolveRpcUrl(ACTIVE_NETWORK);
export const EXPLORER_BASE = process.env.PHAROS_EXPLORER_BASE || explorerTxBase(ACTIVE_NETWORK);
export const IS_MAINNET = ACTIVE_NETWORK.isMainnet;

export const CHAIN_REGISTRY = {
  pharosAtlanticTestnet: {
    environment: "atlantic-testnet",
    chainId: 688689,
    isMainnet: false,
    rpcUrlEnv: "PHAROS_RPC_URL",
    defaultRpcUrl: "https://atlantic.dplabs-internal.com/",
    explorerUrl: "https://atlantic.pharosscan.xyz/",
    docsSource: "https://docs.pharosnetwork.xyz/developer-guide/hardhat/write-your-first-nft",
  },
} as const;

// ─── Token Addresses ───────────────────────────────────────────────────
// The official Pharos Skill Engine (pharos-skill-engine-0.1.0) assets/tokens.json
// lists 0xE0BE... as USDC for pacific-mainnet.
// Circle's USDC contract addresses page lists 0xcfC8... for Pharos Mainnet.
// For Skill Engine hackathon compatibility, SafeHands defaults to the Skill Engine list.
// Both addresses are documented; neither is deleted.

/** Native PROS — sentinel address used by DODO API for native token */
export const PROS_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
export const USDT_ADDRESS = "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5" as const;

/** Primary USDC for Pharos Skill Engine (from official tokens.json) */
export const USDC_ADDRESS = "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8" as const;

/** Alternate USDC listed by Circle's contract addresses page (not in Skill Engine tokens.json) */
export const CIRCLE_USDC_ADDRESS = "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B" as const;

/** @deprecated Use USDC_ADDRESS instead. Kept for backward compatibility. */
export const X402_DEMO_USDC_ADDRESS = USDC_ADDRESS;
export const TEST_USDC_ADDRESS = USDC_ADDRESS;

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
    purpose: "Alternate USDC listed by Circle contract addresses page and Pharos docs token registry; not the primary token in Skill Engine tokens.json",
    docsSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses and https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "CIRCLE_REFERENCED_USDC",
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
export const PACIFIC_USDC_ADDRESS = "0xc879c018db60520f4355c26ed1a6d572cdac1815" as const; // Circle-deployed
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
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
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

export const DODO_APPROVE_ADDRESS = "0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9" as const;
export const DODO_ROUTE_PROXY_ADDRESS = "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2" as const;
export const POSITION_MANAGER_ADDRESS = "0x1c430d84DD6185b1Ea2d4693e0033799d193542f" as const;

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

export const RISK_BLOCK_THRESHOLD = 80;
export const RISK_WARN_THRESHOLD = 60;
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

/** Read-path resolver: env override → Pacific-mainnet baked default → "" (chainId-guarded, fail-closed). */
export function resolveSafeHandsAttestationAddress(chainId: number = CHAIN_ID): string {
  const env = process.env.SAFEHANDS_ATTESTATION_ADDRESS || process.env.SAFEHANDS_RISK_REGISTRY_ADDRESS || "";
  if (env) return env;
  return chainId === PACIFIC_MAINNET_CHAIN_ID ? SAFEHANDS_ATTESTATION_ADDRESS_PACIFIC : "";
}

// Back-compat consts — existing reporting consumers keep importing these unchanged.
export const SAFEHANDS_REGISTRY_ADDRESS = resolveSafeHandsRegistryAddress();
export const SAFEHANDS_ATTESTATION_ADDRESS = resolveSafeHandsAttestationAddress();

/** Sentinel returned by SafeHandsRegistry.riskScoreOf when no valid record exists. */
export const NO_RISK_SCORE = 255;

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
export const PACIFIC_CANONICAL_CONTRACTS = [
  "0x13b0D85CcB8bf860b6b79AF3029fCA081AE9beF2", // Create2Deployer
  "0x4e59b44847b379578588920ca78fbf26c0b4956c", // Foundry Deterministic Deploy
  "0xcA11bde05977b3631167028862bE2a173976CA11", // MultiCall3
  "0x69f4D1788e39c87893C980c06EdF4b7f686e2938", // GnosisSafe (v1.3.0)
  "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA", // GnosisSafeL2 (v1.3.0)
  "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7", // SafeSingletonFactory
  "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed", // CreateX
  "0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B", // MultiSendCallOnly (v1.3.0)
  "0x998739BFdAAdde7C933B942a68053933098f9EDa", // MultiSend (v1.3.0)
  "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Permit2
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // EntryPoint (v0.7)
  "0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C", // SenderCreator (v0.7)
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", // EntryPoint (v0.6)
  "0x7fc98430eAEdbb6070B35B39D798725049088348", // SenderCreator (v0.6)
].map(a => a.toLowerCase());

export const ATLANTIC_CANONICAL_CONTRACTS = [
  "0x13b0D85CcB8bf860b6b79AF3029fCA081AE9beF2", // Create2Deployer
  "0x4e59b44847b379578588920ca78fbf26c0b4956c", // DeterministicDeploymentProxy
  "0xcA11bde05977b3631167028862bE2a173976CA11", // MultiCall3
  "0x69f4D1788e39c87893C980c06EdF4b7f686e2938", // GnosisSafe
  "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA", // GnosisSafeL2
  "0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B", // MultiSendCallOnly
  "0x998739BFdAAdde7C933B942a68053933098f9EDa", // MultiSend
  "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Permit2
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // EntryPoint (v0.7)
  "0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C", // SenderCreator (v0.7)
  // DODO infrastructure
  "0x0246DffDa649e877CFd0951837332B4690fAD1EB", // DODOV2
  "0x701855ae3a8b2A989DC8ACCf02Dd2b96f8B21671", // MulticallWithValid
  "0x27D4236CF46842E5eC1A21C585654F07B00932a1", // DODOSellHelper
  "0xF8FCF810B5DC0715655A1Ed2ef75d6e35e3C0f25", // DODOSwapCalcHelper
  "0x9AC12A5a3AAF3d71b2beFE1F3eE8bA9820F4a591", // ERC20Helper
  "0x091341395E94517E6960c5fAF95e81CdAD92Fe0d", // DODOCalleeHelper
  "0x75EF0F8c1c31dD307451B3A11B324b3125471Ee2", // DODOV1PmmHelper
  "0xe9Fc1c26901AF258EdCC60a258A7f0228b3639d8", // DODOV2RouteHelper
  "0x114CD7D3f8a994139620aF07a4cEA444ab28968c", // CloneFactory
  "0x73CAfc894dBfC181398264934f7Be4e482fc9d40", // DODOApprove
  "0x7c25C06777305e632218aDFF9763E3fC049Dd0Db", // DODOApproveProxy
  "0x4b177AdEd3b8bD1D5D747F91B9E853513838Cd49", // DODOV2Proxy02
  "0x3b5C0f0ca61d9C92e676C369B31545f4Fe003b56", // DODODspProxy
  "0xf05Af5E9dC3b1dd3ad0C087BD80D7391283775e0", // UniswapV2Router02
  "0x259C9EBBE307bb0aF410e103202662667254d062", // SwapRouter
].map(a => a.toLowerCase());

export function isCanonicalInfrastructure(address: string, isMainnet: boolean): boolean {
  if (!address) return false;
  const list = isMainnet ? PACIFIC_CANONICAL_CONTRACTS : ATLANTIC_CANONICAL_CONTRACTS;
  return list.includes(address.toLowerCase());
}
