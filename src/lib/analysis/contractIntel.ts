// ─── Contract Intelligence Analyzer (read-only, decode-only) ───────────
// Recognizes well-known canonical contracts by address and reports on-chain
// code presence via read-only eth_getCode. It does NOT verify source code, does
// NOT call explorer verification APIs, and does NOT confirm a contract is
// deployed/verified on the active Pharos network. Recognition is by canonical
// address only.
//
// Recognition is PER-NETWORK. Pacific Mainnet uses the Pharos-official canonical
// addresses recorded from the Phase 5A Pharos docs audit — Pharos deploys
// Safe/SafeL2/MultiSend at Pharos-specific addresses and ships CreateX, so the
// standard-Ethereum Safe addresses are NOT used as Pharos defaults. Deterministic
// CREATE2 contracts (Permit2/Multicall3/EntryPoint) share one address across EVM
// chains and are recognized on every network.
// ────────────────────────────────────────────────────────────────────────

import { getAddress, isAddress } from "viem";
import { getActiveNetwork, type NetworkName, type PharosNetwork } from "../networks.js";
import { makeResult, type AnalyzerResult, type EvidenceSource, type EvidenceStatus, type ReadOnlyChainAccess } from "./types.js";

export type CanonicalStandard =
  | "Safe"
  | "SafeL2"
  | "MultiSend"
  | "MultiSendCallOnly"
  | "MultiCall3"
  | "Permit2"
  | "ERC4337EntryPoint"
  | "CreateX";

export type CanonicalCategory =
  | "smart-account"
  | "batching"
  | "approval-router"
  | "account-abstraction"
  | "deployer";

export interface CanonicalContract {
  /** Human label (kept stable — back-compat for spender/allowance recognition). */
  label: string;
  standard: CanonicalStandard;
  category: CanonicalCategory;
  /** Networks on which this canonical address is recognized (per-network). */
  networks: NetworkName[];
  /** Same address across EVM chains by deterministic deployment (CREATE2). */
  deterministic: boolean;
  source: EvidenceSource;
  status: EvidenceStatus;
  riskRelevance: string;
  recommendedSafeHandsBehavior: string;
  note?: string;
}

const ALL_NETWORKS: NetworkName[] = ["pacific-mainnet", "pacific-mainnet"];
const PACIFIC_ONLY: NetworkName[] = ["pacific-mainnet"];

/**
 * Known canonical addresses. Recognition is by canonical address only —
 * deployment/verification on the active network is NOT asserted. Addresses are
 * lowercase keys. Pharos-specific Safe/SafeL2/MultiSend + CreateX are taken from
 * the official Pharos canonical-contracts page (Phase 5A audit) and scoped to
 * Pacific Mainnet; deterministic CREATE2 contracts apply to all networks.
 */
export const CANONICAL_CONTRACTS: Record<string, CanonicalContract> = {
  // ── Deterministic CREATE2 deployments (same address on every EVM chain) ──
  "0x000000000022d473030f116ddee9f6b43ac78ba3": {
    label: "Uniswap Permit2",
    standard: "Permit2",
    category: "approval-router",
    networks: ALL_NETWORKS,
    deterministic: true,
    source: "official_docs",
    status: "implemented",
    riskRelevance:
      "Permit2 manages ERC-20 allowances and can later authorize transfers via signatures; an approval to Permit2 delegates allowance management to it.",
    recommendedSafeHandsBehavior:
      "Recognize as canonical, but do NOT treat as automatically safe — unlimited approvals still REQUIRE_CONFIRMATION (deep Permit2 decode is experimental).",
  },
  "0xca11bde05977b3631167028862be2a173976ca11": {
    label: "Multicall3",
    standard: "MultiCall3",
    category: "batching",
    networks: ALL_NETWORKS,
    deterministic: true,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Aggregates multiple calls into one; the batch's inner calls determine the real risk.",
    recommendedSafeHandsBehavior: "Recognize as canonical batching contract; inspect the inner calls, not just the entrypoint.",
  },
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789": {
    label: "ERC-4337 EntryPoint v0.6",
    standard: "ERC4337EntryPoint",
    category: "account-abstraction",
    networks: ALL_NETWORKS,
    deterministic: true,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "ERC-4337 account-abstraction entrypoint; executes bundled UserOperations.",
    recommendedSafeHandsBehavior: "Recognize as canonical; UserOperation contents are not decoded — treat the action as REQUIRE_CONFIRMATION.",
  },
  "0x0000000071727de22e5e9d8baf0edac6f37da032": {
    label: "ERC-4337 EntryPoint v0.7",
    standard: "ERC4337EntryPoint",
    category: "account-abstraction",
    networks: ALL_NETWORKS,
    deterministic: true,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "ERC-4337 account-abstraction entrypoint; executes bundled UserOperations.",
    recommendedSafeHandsBehavior: "Recognize as canonical; UserOperation contents are not decoded — treat the action as REQUIRE_CONFIRMATION.",
  },

  // ── Pharos Pacific Mainnet official addresses (canonical-contracts page) ──
  // Pharos deploys Safe v1.3.0 at Pharos-specific addresses (NOT the standard
  // Ethereum Safe addresses), so those are used here for Pacific Mainnet.
  "0x69f4d1788e39c87893c980c06edf4b7f686e2938": {
    label: "Pharos Safe Singleton (GnosisSafe v1.3.0)",
    standard: "Safe",
    category: "smart-account",
    networks: PACIFIC_ONLY,
    deterministic: false,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Safe smart-account singleton; transactions execute via the Safe's owners/threshold.",
    recommendedSafeHandsBehavior:
      "Recognize as the canonical Safe singleton on Pacific Mainnet; Safe execTransaction / MultiSend batch contents are decoded separately (experimental).",
    note: "Pharos-specific deployment address (differs from the standard-Ethereum Safe 1.3.0 address).",
  },
  "0xfb1bffc9d739b8d520daf37df666da4c687191ea": {
    label: "Pharos SafeL2 Singleton (GnosisSafeL2 v1.3.0)",
    standard: "SafeL2",
    category: "smart-account",
    networks: PACIFIC_ONLY,
    deterministic: false,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "SafeL2 smart-account singleton (emits L2 events); transactions execute via the Safe's owners/threshold.",
    recommendedSafeHandsBehavior:
      "Recognize as the canonical SafeL2 singleton on Pacific Mainnet; Safe execTransaction / MultiSend batch contents are decoded separately (experimental).",
    note: "Pharos-specific deployment address (differs from the standard-Ethereum SafeL2 1.3.0 address).",
  },
  "0x998739bfdaadde7c933b942a68053933098f9eda": {
    label: "Pharos Safe MultiSend (v1.3.0)",
    standard: "MultiSend",
    category: "batching",
    networks: PACIFIC_ONLY,
    deterministic: false,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Batches multiple calls within a Safe transaction; the inner calls determine the real risk.",
    recommendedSafeHandsBehavior:
      "Recognize as the canonical MultiSend on Pacific Mainnet; decode the batch's inner calls before trusting it (experimental).",
    note: "Pharos-specific deployment address (differs from the standard-Ethereum MultiSend 1.3.0 address).",
  },
  "0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed": {
    label: "CreateX Factory",
    standard: "CreateX",
    category: "deployer",
    networks: PACIFIC_ONLY,
    deterministic: false,
    source: "official_docs",
    status: "implemented",
    riskRelevance: "Deterministic contract-deployment factory (CREATE2/CREATE3); can deploy arbitrary contracts.",
    recommendedSafeHandsBehavior:
      "Recognize as the canonical CreateX deployer on Pacific Mainnet; deployment payloads are not decoded — treat the action as REQUIRE_CONFIRMATION.",
    note: "Listed for Pacific Mainnet in the Pharos canonical-contracts page; Atlantic deployment not asserted.",
  },
};

/**
 * Raw, network-agnostic lookup by address (returns the entry if the address is a
 * known canonical contract on ANY network). Kept for back-compat with spender /
 * allowance recognition. Use {@link canonicalContractEvidence} for per-network
 * recognition.
 */
export function lookupCanonical(address: string): CanonicalContract | undefined {
  if (!isAddress(address)) return undefined;
  return CANONICAL_CONTRACTS[address.toLowerCase()];
}

export interface CanonicalContractEvidence {
  name: string;
  category: CanonicalCategory;
  standard: CanonicalStandard;
  network: NetworkName;
  chainId: number;
  address: string;
  deterministic: boolean;
  source: EvidenceSource;
  status: EvidenceStatus;
  riskRelevance: string;
  recommendedSafeHandsBehavior: string;
}

/**
 * Per-network canonical recognition evidence. Returns evidence ONLY when the
 * address is a known canonical contract recognized on `network`. A known address
 * that is not recognized on this network (e.g. a Pacific-only Safe address while
 * the active network is Atlantic) returns `null` — fail-safe under-recognition,
 * never a false positive. Recognition is metadata, not a safety guarantee.
 */
export function canonicalContractEvidence(
  address: string,
  network: PharosNetwork = getActiveNetwork(),
): CanonicalContractEvidence | null {
  const entry = lookupCanonical(address);
  if (!entry || !entry.networks.includes(network.name)) return null;
  return {
    name: entry.label,
    category: entry.category,
    standard: entry.standard,
    network: network.name,
    chainId: network.chainId,
    address: getAddress(address),
    deterministic: entry.deterministic,
    source: entry.source,
    status: entry.status,
    riskRelevance: entry.riskRelevance,
    recommendedSafeHandsBehavior: entry.recommendedSafeHandsBehavior,
  };
}

export interface ContractIntelDetails {
  address: string | null;
  recognized: boolean;
  label: string | null;
  standard: CanonicalStandard | null;
  recognitionSource: "canonical-address" | "none";
  /** Recognition is by address only; on-chain source verification is NOT performed. */
  sourceVerified: false;
  /** Per-network canonical evidence (null when not recognized on the active network). */
  canonicalContractEvidence: CanonicalContractEvidence | null;
  network: NetworkName;
  chainId: number;
  codePresent: boolean | "unknown";
  isContract: boolean | "unknown";
}

export async function analyzeContract(
  address: string,
  access?: ReadOnlyChainAccess,
): Promise<AnalyzerResult<ContractIntelDetails>> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const network = getActiveNetwork();

  if (!isAddress(address)) {
    return makeResult<ContractIntelDetails>({
      analyzer: "contract_intel",
      decision: "BLOCK",
      internalDecision: "BLOCK",
      riskLevel: "CRITICAL",
      reasons: ["Not a valid EVM address."],
      warnings: [],
      analyzerStatus: "ok",
      details: { address: null, recognized: false, label: null, standard: null, recognitionSource: "none", sourceVerified: false, canonicalContractEvidence: null, network: network.name, chainId: network.chainId, codePresent: "unknown", isContract: "unknown" },
    });
  }

  const checksum = getAddress(address);
  const knownEntry = lookupCanonical(address);
  const evidence = canonicalContractEvidence(checksum, network);
  const recognizedOnNetwork = evidence !== null;

  let codePresent: boolean | "unknown" = "unknown";
  if (access?.getCode) {
    try {
      const code = await access.getCode(checksum as `0x${string}`);
      codePresent = !(code === undefined || code === null || code === "0x" || code === "");
    } catch {
      codePresent = "unknown";
    }
  }
  const isContract = codePresent;

  let internalDecision: "ALLOW" | "REQUIRE_CONFIRMATION";
  let riskLevel: AnalyzerResult["riskLevel"];

  if (recognizedOnNetwork && evidence) {
    reasons.push(`Address matches the canonical ${evidence.name} address on ${network.label} (recognized by address; deployment/verification on the active network is NOT confirmed).`);
    if (codePresent === false) warnings.push("No code found at this canonical address on the active network — it may not be deployed here.");
    internalDecision = "ALLOW";
    riskLevel = "LOW";
  } else if (knownEntry) {
    // Known canonical address, but not recognized on the ACTIVE network — do not auto-allow.
    reasons.push(`Address matches the canonical ${knownEntry.label} address, but that contract is not recognized on ${network.label} — treat as an unknown contract and confirm.`);
    if (knownEntry.note) warnings.push(knownEntry.note);
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "MEDIUM";
  } else if (codePresent === true) {
    reasons.push(`Contract at ${checksum} is not a recognized canonical contract — unknown contract requires confirmation.`);
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "MEDIUM";
  } else if (codePresent === false) {
    reasons.push(`No code at ${checksum} (EOA) — not a contract.`);
    internalDecision = "ALLOW";
    riskLevel = "LOW";
  } else {
    reasons.push(`Code presence for ${checksum} not verified (no read-only client) — treat unknown contracts with confirmation.`);
    warnings.push("Provide a read-only RPC client to confirm code presence.");
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "UNKNOWN";
  }

  return makeResult<ContractIntelDetails>({
    analyzer: "contract_intel",
    decision: internalDecision,
    internalDecision,
    riskLevel,
    reasons,
    warnings,
    analyzerStatus: codePresent === "unknown" ? "partial" : "ok",
    details: {
      address: checksum,
      recognized: recognizedOnNetwork,
      label: evidence?.name ?? knownEntry?.label ?? null,
      standard: evidence?.standard ?? knownEntry?.standard ?? null,
      recognitionSource: recognizedOnNetwork ? "canonical-address" : "none",
      sourceVerified: false,
      canonicalContractEvidence: evidence,
      network: network.name,
      chainId: network.chainId,
      codePresent,
      isContract,
    },
  });
}
