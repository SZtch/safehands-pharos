// ─── SafeHands Constants ───────────────────────────────────────────────
// Pharos Atlantic Testnet defaults. Values are labeled as testnet-only.
// Official references reviewed during QA:
// - Pharos Hardhat guide: Atlantic Testnet chain ID 688689, RPC https://atlantic.dplabs-internal.com
// - Official Pharos Skill Engine tokens.json: USDC = 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8
// - Circle USDC contract addresses page: Pharos Testnet = 0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B
// - For Pharos Skill Engine compatibility, SafeHands defaults to the Skill Engine token list.
// ────────────────────────────────────────────────────────────────────────

// ─── Network ───────────────────────────────────────────────────────────

export const PHAROS_ENVIRONMENT = process.env.PHAROS_ENVIRONMENT || "atlantic-testnet";
export const CHAIN_ID = Number(process.env.PHAROS_CHAIN_ID || "688689");
export const RPC_URL = process.env.PHAROS_RPC_URL || "https://atlantic.dplabs-internal.com/";
export const EXPLORER_BASE = process.env.PHAROS_EXPLORER_BASE || "https://atlantic.pharosscan.xyz/tx/";
export const IS_MAINNET = false;

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
// lists 0xE0BE... as USDC for atlantic-testnet.
// Circle's USDC contract addresses page lists 0xcfC8... for Pharos Testnet.
// For Skill Engine hackathon compatibility, SafeHands defaults to the Skill Engine list.
// Both addresses are documented; neither is deleted.

/** Native PHRS — sentinel address used by DODO API for native token */
export const PHRS_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
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
export const WPHRS_ADDRESS = "0x838800b758277CC111B2d48Ab01e5E164f8E9471" as const;

export const TOKEN_REGISTRY = {
  PHRS: {
    symbol: "PHRS",
    address: PHRS_ADDRESS,
    decimals: 18,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "native PHRS sentinel address for DODO route API",
    docsSource: "https://docs.pharos.xyz/",
  },
  USDC: {
    symbol: "USDC",
    address: USDC_ADDRESS,
    decimals: 6,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "Pharos Skill Engine USDC — the USDC listed in the official pharos-skill-engine-0.1.0 assets/tokens.json for atlantic-testnet",
    docsSource: "pharos-skill-engine-0.1.0/assets/tokens.json",
    verificationStatus: "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE",
  },
  CIRCLE_USDC: {
    symbol: "CIRCLE_USDC",
    address: CIRCLE_USDC_ADDRESS,
    decimals: 6,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
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
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
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
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
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
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "canonical Pharos Atlantic Testnet WETH (Wrapped ETH)",
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
  WPHRS: {
    symbol: "WPHRS",
    address: WPHRS_ADDRESS,
    decimals: 18,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
    isCanonical: true,
    isTestToken: true,
    purpose: "canonical Pharos Atlantic Testnet WPHRS (Wrapped PHRS)",
    docsSource: "https://docs.pharos.xyz/getting-started/token-registry",
    verificationStatus: "DOCS_VERIFIED",
  },
} as const;

// ─── Token Decimals ────────────────────────────────────────────────────

export const TOKEN_DECIMALS: Record<string, number> = {
  PHRS: 18,
  USDT: 6,
  USDC: 6,
  CIRCLE_USDC: 6,
  WBTC: 18,
  WETH: 18,
  WPHRS: 18,
  [PHRS_ADDRESS.toLowerCase()]: 18,
  [USDT_ADDRESS.toLowerCase()]: 6,
  [USDC_ADDRESS.toLowerCase()]: 6,
  [CIRCLE_USDC_ADDRESS.toLowerCase()]: 6,
  [WBTC_ADDRESS.toLowerCase()]: 18,
  [WETH_ADDRESS.toLowerCase()]: 18,
  [WPHRS_ADDRESS.toLowerCase()]: 18,
};

// ─── Token Symbol → Address Mapping ────────────────────────────────────

export const TOKEN_MAP: Record<string, `0x${string}`> = {
  PHRS: PHRS_ADDRESS,
  USDT: USDT_ADDRESS,
  USDC: USDC_ADDRESS,
  CIRCLE_USDC: CIRCLE_USDC_ADDRESS,
  WBTC: WBTC_ADDRESS,
  WETH: WETH_ADDRESS,
  WPHRS: WPHRS_ADDRESS,
};

// ─── FaroSwap / DODO Protocol ──────────────────────────────────────────

export const DODO_APPROVE_ADDRESS = "0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9" as const;
export const DODO_ROUTE_PROXY_ADDRESS = "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2" as const;
export const POSITION_MANAGER_ADDRESS = "0x1c430d84DD6185b1Ea2d4693e0033799d193542f" as const;

// ─── DODO API ──────────────────────────────────────────────────────────

export const DODO_API_BASE = process.env.DODO_API_BASE || "https://api.dodoex.io";
export const DODO_API_KEY = process.env.DODO_API_KEY;
export const DODO_DEFAULT_SLIPPAGE = 3.225;
export const DODO_ROUTE_ENDPOINT = "/route-service/v2/widget/getdodoroute";

// ─── Risk Engine Thresholds ────────────────────────────────────────────

export const RISK_BLOCK_THRESHOLD = 80;
export const RISK_WARN_THRESHOLD = 60;
export const MAX_SLIPPAGE_PCT = 5;
export const MAX_BALANCE_USAGE_PCT = 90;

// ─── Safety Limits ─────────────────────────────────────────────────────

export const MAX_TX_AMOUNT_PHRS = process.env.MAX_TX_AMOUNT_PHRS || "0.1";
export const MAX_APPROVAL_AMOUNT_USDC = process.env.MAX_APPROVAL_AMOUNT_USDC || "10";
export const MAX_DAILY_SPEND_USD = process.env.MAX_DAILY_SPEND_USD || "10";
export const MAX_X402_PAYMENT_USDC = process.env.MAX_X402_PAYMENT_USDC || "0.01";
export const X402_PAYMENT_TOKEN_ADDRESS = (process.env.X402_PAYMENT_TOKEN_ADDRESS || USDC_ADDRESS) as `0x${string}`;

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

// ─── RiskRegistry V2 Config ───────────────────────────────────────

export const RISK_REGISTRY_V2_ADDRESS = (process.env.RISK_REGISTRY_V2_ADDRESS ||
  "0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25") as `0x${string}`;

export const REQUIRE_AUTHORIZED_AGENT_FOR_WRITE =
  (process.env.REQUIRE_AUTHORIZED_AGENT_FOR_WRITE ?? "true") === "true";

export const AUTO_AUTHORIZE_AGENT_WALLET =
  process.env.AUTO_AUTHORIZE_AGENT_WALLET === "true";

export const DEFAULT_RISK_REGISTRY_VERSION = "v2";

export const RISK_REGISTRY_V2_ABI = [
  { name: "isAuthorizedAgent", type: "function", stateMutability: "view", inputs: [{ name: "agent", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { name: "setAuthorizedAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agent", type: "address" }, { name: "authorized", type: "bool" }], outputs: [] },
  { name: "publishRiskRecord", type: "function", stateMutability: "nonpayable", inputs: [{ name: "wallet", type: "address" }, { name: "agent", type: "address" }, { name: "actionHash", type: "bytes32" }, { name: "score", type: "uint8" }, { name: "riskLevel", type: "string" }, { name: "recommendation", type: "string" }, { name: "policyVersion", type: "string" }, { name: "evidenceURI", type: "string" }, { name: "expiresAt", type: "uint256" }], outputs: [{ name: "recordId", type: "uint256" }] },
  { name: "getRiskRecord", type: "function", stateMutability: "view", inputs: [{ name: "recordId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "recordId", type: "uint256" }, { name: "wallet", type: "address" }, { name: "agent", type: "address" }, { name: "actionHash", type: "bytes32" }, { name: "score", type: "uint8" }, { name: "riskLevel", type: "string" }, { name: "recommendation", type: "string" }, { name: "policyVersion", type: "string" }, { name: "evidenceURI", type: "string" }, { name: "createdAt", type: "uint256" }, { name: "expiresAt", type: "uint256" }, { name: "revoked", type: "bool" }] }] },
  { name: "getLatestRiskRecordForWallet", type: "function", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ name: "", type: "tuple", components: [{ name: "recordId", type: "uint256" }, { name: "wallet", type: "address" }, { name: "agent", type: "address" }, { name: "actionHash", type: "bytes32" }, { name: "score", type: "uint8" }, { name: "riskLevel", type: "string" }, { name: "recommendation", type: "string" }, { name: "policyVersion", type: "string" }, { name: "evidenceURI", type: "string" }, { name: "createdAt", type: "uint256" }, { name: "expiresAt", type: "uint256" }, { name: "revoked", type: "bool" }] }] },
  { name: "getRiskRecordsForWallet", type: "function", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ name: "", type: "uint256[]" }] },
  { name: "getRiskRecordByActionHash", type: "function", stateMutability: "view", inputs: [{ name: "actionHash", type: "bytes32" }], outputs: [{ name: "", type: "tuple", components: [{ name: "recordId", type: "uint256" }, { name: "wallet", type: "address" }, { name: "agent", type: "address" }, { name: "actionHash", type: "bytes32" }, { name: "score", type: "uint8" }, { name: "riskLevel", type: "string" }, { name: "recommendation", type: "string" }, { name: "policyVersion", type: "string" }, { name: "evidenceURI", type: "string" }, { name: "createdAt", type: "uint256" }, { name: "expiresAt", type: "uint256" }, { name: "revoked", type: "bool" }] }] },
  { name: "isRiskRecordValid", type: "function", stateMutability: "view", inputs: [{ name: "recordId", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
