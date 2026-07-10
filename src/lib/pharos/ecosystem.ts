// ─── Pharos Ecosystem Registry (read-only, awareness-only) ─────────────
// A registry of Pharos ecosystem providers SafeHands is AWARE of. It does NOT
// integrate with, call, or hold keys for any of them. Each entry records what the
// official Pharos docs say (Phase 5A audit) and SafeHands' honest status —
// `implemented` is used ONLY where SafeHands has code + tests; everything SafeHands
// merely recognizes is `roadmap` / `experimental` / `to_verify`. No addresses are
// invented: only official addresses from the audit are included. Pure data — no RPC,
// no keys, no external API calls.
// ───────────────────────────────────────────────────────────────────────

import { getActiveNetwork, type NetworkName, type PharosNetwork } from "../networks.js";
import { canonicalContractEvidence } from "../analysis/contractIntel.js";
import type { EvidenceSource } from "../analysis/types.js";

export type EcosystemCategory =
  | "oracle"
  | "cross_chain"
  | "indexing"
  | "wallet_infrastructure"
  | "custody_infrastructure"
  | "evm_wasm_interop"
  | "payment"
  | "rpc_provider"
  | "security"
  | "identity"
  | "unknown";

export type EcosystemStatus = "implemented" | "experimental" | "roadmap" | "to_verify" | "not_implemented";

export interface EcosystemAddress {
  network: NetworkName;
  chainId: number;
  address: string;
  label?: string;
}

export interface EcosystemEntry {
  name: string;
  category: EcosystemCategory;
  /** Official addresses (only when present in the Phase 5A audit). */
  addresses?: EcosystemAddress[];
  officialDocsUrl?: string;
  /** Provenance of the recognition data. */
  source: EvidenceSource;
  /** SafeHands' HONEST status — `implemented` only with code + tests. */
  status: EcosystemStatus;
  riskRelevance: string;
  /** What SafeHands does (awareness/evidence) — never a direct integration claim. */
  safehandsBehavior: string;
  overclaimRisk: string;
  /** Alternate names/aliases for provider-name hint matching. */
  aliases?: string[];
}

const DOCS = {
  chainlink: "https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe",
  crossChain: "https://docs.pharos.xyz/tooling-and-infrastructure/cross-chain",
  goldsky: "https://docs.pharos.xyz/tooling-and-infrastructure/indexing/goldsky",
  wallets: "https://docs.pharos.xyz/tooling-and-infrastructure/wallets",
  wasm: "https://docs.pharos.xyz/developer-guide/interoperability/call-evm-from-wasm",
  x402: "https://docs.pharos.xyz/developer-guide/x402",
  zan: "https://docs.pharos.xyz/tooling-and-infrastructure/rpc/zan",
} as const;

const BRIDGE_BEHAVIOR =
  "Bridge-like / cross-chain intent → REQUIRE_CONFIRMATION unless explicitly trusted by policy. SafeHands does NOT call this provider or any cross-chain API.";

/**
 * The Pharos ecosystem providers SafeHands is aware of. Order is informational.
 * `status` reflects SafeHands' implementation, NOT the provider's deployment:
 * Pharos may have deployed Chainlink, but SafeHands has no Chainlink integration,
 * so its status here is `roadmap` (awareness only).
 */
export const ECOSYSTEM_PROVIDERS: EcosystemEntry[] = [
  {
    name: "Chainlink Price Feeds (CRE)",
    category: "oracle",
    aliases: ["chainlink", "chainlink-pe", "chainlink price feed", "cre"],
    addresses: [
      { network: "pacific-mainnet", chainId: 1672, address: "0xc71f7d98d3d9a000Fdfe307fBdb9d94AbD56424B", label: "Chainlink price-feed cache (Pacific)" },
      { network: "atlantic-testnet", chainId: 688689, address: "0x5456fD07A1622d33969f833d52aA5AD2c68C3Fa2", label: "Chainlink price-feed cache (Atlantic)" },
    ],
    officialDocsUrl: DOCS.chainlink,
    source: "official_docs",
    status: "roadmap",
    riskRelevance: "Oracle price dependency — a contract that reads Chainlink feeds inherits oracle/price risk (staleness, manipulation).",
    safehandsBehavior:
      "Recognize as Pharos-native oracle ecosystem (price-feed cache) — evidence only. SafeHands does NOT query Chainlink feeds and has no direct oracle analyzer.",
    overclaimRisk: "HIGH — Chainlink is Pharos-native; do NOT claim a Chainlink integration.",
  },
  {
    name: "Chainlink CCIP",
    category: "cross_chain",
    aliases: ["ccip", "chainlink ccip"],
    officialDocsUrl: DOCS.crossChain,
    source: "official_docs",
    status: "roadmap",
    riskRelevance: "Cross-chain messaging/transfer — bridge/relayer trust and finality risk.",
    safehandsBehavior: BRIDGE_BEHAVIOR,
    overclaimRisk: "Do NOT claim a CCIP integration.",
  },
  {
    name: "Circle CCTP",
    category: "cross_chain",
    aliases: ["cctp", "circle cctp"],
    officialDocsUrl: DOCS.crossChain,
    source: "official_docs",
    status: "roadmap",
    riskRelevance: "Cross-chain USDC transfer — bridge trust, attestation, and finality risk.",
    safehandsBehavior: BRIDGE_BEHAVIOR,
    overclaimRisk: "Do NOT claim a Circle/CCTP integration.",
  },
  {
    name: "LayerZero",
    category: "cross_chain",
    aliases: ["layerzero", "lz"],
    officialDocsUrl: DOCS.crossChain,
    source: "official_docs",
    status: "roadmap",
    riskRelevance: "Cross-chain messaging — relayer/oracle trust and replay risk.",
    safehandsBehavior: BRIDGE_BEHAVIOR,
    overclaimRisk: "Do NOT claim a LayerZero integration.",
  },
  {
    name: "LI.FI",
    category: "cross_chain",
    aliases: ["lifi", "li.fi", "li fi"],
    officialDocsUrl: undefined,
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Bridge aggregation risk if present.",
    safehandsBehavior:
      "NOT named on the official Pharos cross-chain page (Phase 5A). Treat any LI.FI-like bridge call as a generic cross-chain intent → REQUIRE_CONFIRMATION. No integration.",
    overclaimRisk: "HIGH — do NOT list LI.FI as a Pharos/SafeHands integration without official confirmation.",
  },
  {
    name: "Jumper",
    category: "cross_chain",
    aliases: ["jumper"],
    officialDocsUrl: undefined,
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Bridge UI / aggregation risk if present.",
    safehandsBehavior:
      "NOT named on the official Pharos cross-chain page (Phase 5A). Treat any Jumper-like bridge call as a generic cross-chain intent → REQUIRE_CONFIRMATION. No integration.",
    overclaimRisk: "HIGH — do NOT list Jumper as a Pharos/SafeHands integration without official confirmation.",
  },
  {
    name: "Goldsky",
    category: "indexing",
    aliases: ["goldsky", "subgraph", "mirror"],
    officialDocsUrl: DOCS.goldsky,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Indexing/data source — could enrich historical evidence; NOT an execution path.",
    safehandsBehavior:
      "SafeHands MCP provides a native query_goldsky_subgraph tool, allowing AI agents to fetch real-time historical indexing data via GraphQL if a Goldsky endpoint is configured.",
    overclaimRisk: "Do NOT claim a live Goldsky integration; indexing ≠ guardrail logic.",
  },
  {
    name: "Safe (Safe MultiSig)",
    category: "wallet_infrastructure",
    aliases: ["safe", "gnosis safe", "safe multisig", "safel2"],
    officialDocsUrl: DOCS.wallets,
    source: "official_docs",
    status: "experimental",
    riskRelevance: "Smart-account / multisig treasury flows benefit from pre-sign checks (owners/threshold, batch contents).",
    safehandsBehavior:
      "Recognize canonical Safe/SafeL2 addresses (Phase 5B) and decode Safe/MultiSend batches (experimental). SafeHands holds NO keys, never co-signs, and never custodies — pre-sign verdicts only.",
    overclaimRisk: "Do NOT claim a Safe partnership or any custody capability.",
  },
  {
    name: "Fordefi",
    category: "custody_infrastructure",
    aliases: ["fordefi"],
    officialDocsUrl: DOCS.wallets,
    source: "official_docs",
    status: "roadmap",
    riskRelevance: "MPC custody — treasury/custody flows carry external key-management risk.",
    safehandsBehavior:
      "External MPC-custody awareness only. SafeHands holds NO keys and never creates/imports/exports/manages private keys; it surfaces pre-sign verdicts to custody UIs.",
    overclaimRisk: "Do NOT claim a Fordefi partnership or custody capability.",
  },
  {
    name: "Dora VM (EVM ↔ WASM interop)",
    category: "evm_wasm_interop",
    aliases: ["dora", "dora vm", "wasm", "stylus", "evm-wasm"],
    officialDocsUrl: DOCS.wasm,
    source: "official_docs",
    status: "experimental",
    riskRelevance: "WASM↔EVM interop calls can bypass naive EVM-only assumptions; relevant once analyzed.",
    safehandsBehavior:
      "EVM analysis is implemented/aligned; EVM↔WASM interop is experimental (testnet examples; mainnet TO_VERIFY). A WASM-originated/interop intent → REQUIRE_CONFIRMATION. No WASM analyzer exists.",
    overclaimRisk: "Do NOT claim WASM analysis support.",
  },
  {
    name: "x402 payments",
    category: "payment",
    aliases: ["x402"],
    officialDocsUrl: DOCS.x402,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Payment-before-fetch for agents — URL/SSRF, amount, and token risk.",
    safehandsBehavior:
      "Support for x402 is recognized primarily on Pharos Atlantic Testnet (Chain ID 688689). SafeHands never signs or settles a payment natively. x402 intents → REQUIRE_CONFIRMATION unless pre-authorized.",
    overclaimRisk: "Do NOT claim mainnet x402 automatic settlement.",
  },
  {
    name: "ZAN RPC",
    category: "rpc_provider",
    aliases: ["zan"],
    officialDocsUrl: DOCS.zan,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Optional read-only RPC provider; premium keys must never leak.",
    safehandsBehavior:
      "Optional read-only RPC provider (Phase 5C). Read from env only; the URL/API key is never exposed (only a redacted provider name). Not required by default.",
    overclaimRisk: "Do NOT hardcode/ship ZAN keys.",
  },
  {
    name: "Public Pharos RPC",
    category: "rpc_provider",
    aliases: ["pharos-public", "public rpc", "rpc.pharos.xyz"],
    officialDocsUrl: "https://docs.pharos.xyz/api-and-sdk/json-rpc-methods",
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Default read-only RPC for SafeHands checks.",
    safehandsBehavior: "Default hosted read-only RPC; read methods only (Phase 5C whitelist). No keys required.",
    overclaimRisk: "None.",
  },

  // ── Ecosystem awareness from the public Pharos ecosystem list ────────────
  // Recognized by name only (no official docs URL / addresses bundled), so
  // status/source are `to_verify`. SafeHands does NOT integrate with, call,
  // hold keys for, or execute against any of these — awareness/pre-sign
  // verdicts only. Everything stays read-only and fail-closed.

  // Wallets
  {
    name: "OKX Wallet",
    category: "wallet_infrastructure",
    aliases: ["okx", "okx wallet"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Self-custody wallet UI; pre-sign checks (recipient, calldata, approvals) benefit the signer.",
    safehandsBehavior: "Recognized Pharos-ecosystem wallet (awareness only). SafeHands holds no keys, never custodies or co-signs — pre-sign verdicts only.",
    overclaimRisk: "Do NOT claim an OKX Wallet integration or partnership.",
  },
  {
    name: "TopNod",
    category: "wallet_infrastructure",
    aliases: ["topnod"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Wallet UI; pre-sign checks benefit the signer.",
    safehandsBehavior: "Recognized Pharos-ecosystem wallet (awareness only). SafeHands holds no keys and never custodies — pre-sign verdicts only.",
    overclaimRisk: "Do NOT claim a TopNod integration or partnership.",
  },
  {
    name: "OneKey",
    category: "wallet_infrastructure",
    aliases: ["onekey"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Hardware/self-custody wallet; pre-sign checks benefit the signer.",
    safehandsBehavior: "Recognized Pharos-ecosystem wallet (awareness only). SafeHands holds no keys and never custodies — pre-sign verdicts only.",
    overclaimRisk: "Do NOT claim a OneKey integration or partnership.",
  },
  {
    name: "KuCoin Wallet",
    category: "wallet_infrastructure",
    aliases: ["kucoin", "kucoin wallet"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Self-custody wallet UI; pre-sign checks benefit the signer.",
    safehandsBehavior: "Recognized Pharos-ecosystem wallet (awareness only). SafeHands holds no keys and never custodies — pre-sign verdicts only.",
    overclaimRisk: "Do NOT claim a KuCoin Wallet integration or partnership.",
  },

  // Custody
  {
    name: "Anchorage",
    category: "custody_infrastructure",
    aliases: ["anchorage", "anchorage digital"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Institutional custody — treasury/custody flows carry external key-management risk.",
    safehandsBehavior: "External custody awareness only. SafeHands holds no keys and never creates/imports/exports/manages private keys; it surfaces pre-sign verdicts to custody UIs.",
    overclaimRisk: "Do NOT claim an Anchorage partnership or custody capability.",
  },

  // Payment
  {
    name: "Alchemy Pay",
    category: "payment",
    aliases: ["alchemy pay", "alchemypay"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Fiat on/off-ramp & payment rail — amount, token, and counterparty risk.",
    safehandsBehavior: "Recognized Pharos-ecosystem payment rail (awareness only). Distinct from Alchemy (RPC). SafeHands never signs or settles a payment; payment intents → REQUIRE_CONFIRMATION.",
    overclaimRisk: "Do NOT claim an Alchemy Pay integration or automatic settlement.",
  },

  // Oracle / RPC / indexer
  {
    name: "Supra",
    category: "oracle",
    aliases: ["supra", "supra oracle"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Oracle price dependency — a contract reading Supra feeds inherits oracle/price risk (staleness, manipulation).",
    safehandsBehavior: "Recognized Pharos-ecosystem oracle (awareness only). SafeHands does NOT query Supra feeds and has no Supra analyzer.",
    overclaimRisk: "Do NOT claim a Supra integration.",
  },
  {
    name: "Alchemy",
    category: "rpc_provider",
    aliases: ["alchemy", "alchemy rpc"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Optional read-only RPC/data provider; premium keys must never leak.",
    safehandsBehavior: "Recognized Pharos-ecosystem RPC provider (awareness only). Distinct from Alchemy Pay (payment). Not wired as a default provider; keys are never bundled.",
    overclaimRisk: "Do NOT claim an Alchemy integration or ship Alchemy keys.",
  },
  {
    name: "Nirvana",
    category: "rpc_provider",
    aliases: ["nirvana"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Optional read-only RPC/data provider; keys must never leak.",
    safehandsBehavior: "Recognized Pharos-ecosystem RPC/data provider (awareness only). Not wired as a default provider; keys are never bundled.",
    overclaimRisk: "Do NOT claim a Nirvana integration.",
  },
  {
    name: "Hemera",
    category: "indexing",
    aliases: ["hemera"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Indexing/data source — could enrich historical evidence; NOT an execution path.",
    safehandsBehavior: "Recognized Pharos-ecosystem indexer (awareness only). SafeHands does NOT query Hemera; indexing ≠ guardrail logic.",
    overclaimRisk: "Do NOT claim a Hemera integration.",
  },

  // Security / compliance
  {
    name: "Trusta Labs",
    category: "security",
    aliases: ["trusta", "trusta labs"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "External security/reputation intel — could inform risk, not decide it.",
    safehandsBehavior: "Recognized Pharos-ecosystem security provider (awareness only). SafeHands does NOT call Trusta Labs; its own verdicts remain the source of truth.",
    overclaimRisk: "Do NOT claim a Trusta Labs integration, audit, or endorsement.",
  },
  {
    name: "Hypernative",
    category: "security",
    aliases: ["hypernative"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "External threat-detection intel — could inform risk, not decide it.",
    safehandsBehavior: "Recognized Pharos-ecosystem security provider (awareness only). SafeHands does NOT call Hypernative; its own verdicts remain the source of truth.",
    overclaimRisk: "Do NOT claim a Hypernative integration or endorsement.",
  },
  {
    name: "Zellic",
    category: "security",
    aliases: ["zellic"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Security audit firm — an audit is evidence about a contract, never a guarantee.",
    safehandsBehavior: "Recognized Pharos-ecosystem audit firm (awareness only). SafeHands does NOT claim any Zellic audit of its own or others' contracts.",
    overclaimRisk: "Do NOT claim a Zellic audit or endorsement.",
  },
  {
    name: "ExVul Security",
    category: "security",
    aliases: ["exvul", "exvul security"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Security audit/monitoring firm — evidence about a contract, never a guarantee.",
    safehandsBehavior: "Recognized Pharos-ecosystem security firm (awareness only). SafeHands does NOT call ExVul or claim an ExVul audit.",
    overclaimRisk: "Do NOT claim an ExVul Security audit or endorsement.",
  },
  {
    name: "OpenZeppelin",
    category: "security",
    aliases: ["openzeppelin", "oz"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Audit firm & contract libraries — recognizing an OZ pattern is not proof of safety.",
    safehandsBehavior: "Recognized Pharos-ecosystem security firm/library (awareness only). SafeHands does NOT claim an OpenZeppelin audit; library usage alone never lowers risk.",
    overclaimRisk: "Do NOT claim an OpenZeppelin audit, partnership, or endorsement.",
  },
  {
    name: "TRM",
    category: "security",
    aliases: ["trm", "trm labs"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Compliance/AML screening intel — could inform risk, not decide it.",
    safehandsBehavior: "Recognized Pharos-ecosystem compliance provider (awareness only). SafeHands does NOT call TRM; its own verdicts remain the source of truth.",
    overclaimRisk: "Do NOT claim a TRM integration or compliance certification.",
  },

  // Identity / NFT / navigation
  {
    name: "PNS",
    category: "identity",
    aliases: ["pns", "pharos name service"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Name service — resolved names can be spoofed/homoglyphed; name ≠ address trust.",
    safehandsBehavior: "Recognized Pharos-ecosystem naming service (awareness only). SafeHands does NOT resolve or trust names as identity; address verification remains required.",
    overclaimRisk: "Do NOT claim a PNS integration or name-resolution capability.",
  },
  {
    name: "ZNS Connect",
    category: "identity",
    aliases: ["zns", "zns connect"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Name service — resolved names can be spoofed/homoglyphed; name ≠ address trust.",
    safehandsBehavior: "Recognized Pharos-ecosystem naming service (awareness only). SafeHands does NOT resolve or trust names as identity; address verification remains required.",
    overclaimRisk: "Do NOT claim a ZNS Connect integration or name-resolution capability.",
  },
  {
    name: "Grandline",
    category: "identity",
    aliases: ["grandline"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Identity/NFT app — recognizing the name grants no trust in its contracts.",
    safehandsBehavior: "Recognized Pharos-ecosystem identity/NFT app (awareness only). SafeHands does NOT integrate; intents to its contracts fail closed without address verification.",
    overclaimRisk: "Do NOT claim a Grandline integration or partnership.",
  },
  {
    name: "Pharosverse",
    category: "identity",
    aliases: ["pharosverse"],
    source: "to_verify",
    status: "to_verify",
    riskRelevance: "Ecosystem navigation/NFT hub — recognizing the name grants no trust in linked contracts.",
    safehandsBehavior: "Recognized Pharos-ecosystem navigation/NFT hub (awareness only). SafeHands does NOT integrate; intents to linked contracts fail closed without address verification.",
    overclaimRisk: "Do NOT claim a Pharosverse integration or partnership.",
  },
];

/** Address index (lowercased) → { entry, network, chainId } for official addresses. */
const ADDRESS_INDEX: Map<string, { entry: EcosystemEntry; network: NetworkName; chainId: number }> = (() => {
  const m = new Map<string, { entry: EcosystemEntry; network: NetworkName; chainId: number }>();
  for (const entry of ECOSYSTEM_PROVIDERS) {
    for (const a of entry.addresses ?? []) {
      m.set(a.address.toLowerCase(), { entry, network: a.network, chainId: a.chainId });
    }
  }
  return m;
})();

/** Look up an ecosystem provider by a known official address (any network). */
export function lookupEcosystemByAddress(address: string): { entry: EcosystemEntry; network: NetworkName; chainId: number } | undefined {
  if (!address) return undefined;
  return ADDRESS_INDEX.get(address.toLowerCase());
}

/** Look up an ecosystem provider by name/alias (case-insensitive). */
export function lookupEcosystemByName(name: string): EcosystemEntry | undefined {
  const q = (name ?? "").trim().toLowerCase();
  if (!q) return undefined;
  return ECOSYSTEM_PROVIDERS.find(
    (e) => e.name.toLowerCase() === q || (e.aliases ?? []).some((a) => a.toLowerCase() === q),
  );
}

/** Map a recognized canonical contract (Phase 5B) to an ecosystem entry, when applicable. */
export function ecosystemForCanonical(address: string, network: PharosNetwork = getActiveNetwork()): EcosystemEntry | undefined {
  const canonical = canonicalContractEvidence(address, network);
  if (!canonical) return undefined;
  if (canonical.standard === "Safe" || canonical.standard === "SafeL2") {
    return lookupEcosystemByName("safe");
  }
  return undefined;
}

export interface EcosystemRegistrySummary {
  providers: number;
  byCategory: Record<EcosystemCategory, number>;
  byStatus: Record<EcosystemStatus, number>;
}

/** Secret-free registry summary for /infra/status and /public-config. */
export function ecosystemRegistrySummary(): EcosystemRegistrySummary {
  const byCategory = {} as Record<EcosystemCategory, number>;
  const byStatus = {} as Record<EcosystemStatus, number>;
  for (const e of ECOSYSTEM_PROVIDERS) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
  }
  return { providers: ECOSYSTEM_PROVIDERS.length, byCategory, byStatus };
}
