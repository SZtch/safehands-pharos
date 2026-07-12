// ─── Pharos Ecosystem Evidence Classifier (read-only, evidence-only) ───
// Labels a target/intent with an ecosystem category and an HONEST status, from:
// known official addresses (e.g. Chainlink cache), recognized canonical contracts
// (Safe, Phase 5B), and provider/category hints. The evidence EXPLAINS risk and may
// only ESCALATE a decision (cross-chain/WASM → REQUIRE_CONFIRMATION); it can NEVER
// relax policy or make a risky action safe. Pure: no RPC, no keys, no external APIs.
// ───────────────────────────────────────────────────────────────────────

import { getActiveNetwork, getNetworkByChainId, isNetworkName, type NetworkName, type PharosNetwork } from "../networks.js";
import type { GuardianDecision } from "../guardian/decision.js";
import type { EvidenceSource } from "../analysis/types.js";
import {
  ECOSYSTEM_PROVIDERS,
  ecosystemForCanonical,
  lookupEcosystemByAddress,
  lookupEcosystemByName,
  type EcosystemCategory,
  type EcosystemEntry,
  type EcosystemStatus,
} from "./ecosystem.js";

export type EcosystemDecisionImpact = "REQUIRE_CONFIRMATION" | "none";

export interface EcosystemEvidence {
  category: EcosystemCategory;
  providerName: string | null;
  status: EcosystemStatus;
  confidence: "high" | "medium" | "low";
  source: EvidenceSource;
  officialDocsUrl: string | null;
  riskRelevance: string;
  safehandsBehavior: string;
  /** Recommendation only — applied escalate-only; NEVER downgrades a decision. */
  recommendedDecisionImpact: EcosystemDecisionImpact;
  network: NetworkName | null;
  chainId: number | null;
  address: string | null;
}

/** Per-category decision impact. Only cross-chain + WASM-interop escalate. */
const CATEGORY_IMPACT: Record<EcosystemCategory, EcosystemDecisionImpact> = {
  oracle: "none",
  cross_chain: "REQUIRE_CONFIRMATION",
  indexing: "none",
  wallet_infrastructure: "none",
  custody_infrastructure: "none",
  evm_wasm_interop: "REQUIRE_CONFIRMATION",
  payment: "none",
  rpc_provider: "none",
  security: "none",
  identity: "none",
  unknown: "none",
};

/** Generic descriptions for category-only / unknown classifications. */
const CATEGORY_META: Record<EcosystemCategory, { riskRelevance: string; safehandsBehavior: string }> = {
  oracle: { riskRelevance: "Oracle/price dependency.", safehandsBehavior: "Evidence only; SafeHands has no direct oracle analyzer." },
  cross_chain: { riskRelevance: "Cross-chain / bridge-like: relayer/finality risk.", safehandsBehavior: "Bridge-like intent → REQUIRE_CONFIRMATION unless trusted. No cross-chain API is called." },
  indexing: { riskRelevance: "Indexing/data source.", safehandsBehavior: "Optional read-only data source only; not an execution path." },
  wallet_infrastructure: { riskRelevance: "Smart-account / wallet infrastructure.", safehandsBehavior: "Awareness only; SafeHands holds no keys and never custodies." },
  custody_infrastructure: { riskRelevance: "External custody/key management.", safehandsBehavior: "Awareness only; SafeHands holds no keys." },
  evm_wasm_interop: { riskRelevance: "EVM↔WASM interop can bypass EVM-only assumptions.", safehandsBehavior: "Experimental; WASM-interop intent → REQUIRE_CONFIRMATION. No WASM analyzer." },
  payment: { riskRelevance: "Payment intent (x402).", safehandsBehavior: "Route to the x402 preflight analyzer. mainnet-only; never signs/settles." },
  rpc_provider: { riskRelevance: "RPC provider/infrastructure.", safehandsBehavior: "Read-only RPC only; secrets redacted." },
  security: { riskRelevance: "External security/compliance/audit intel.", safehandsBehavior: "Awareness only; SafeHands does not call it and its own verdicts remain the source of truth. An audit/screening is evidence, never a guarantee." },
  identity: { riskRelevance: "Name service / identity / NFT: names can be spoofed; name ≠ address trust.", safehandsBehavior: "Awareness only; SafeHands never resolves or trusts names as identity; address verification is still required." },
  unknown: { riskRelevance: "No ecosystem category recognized.", safehandsBehavior: "No ecosystem awareness applies; base analyzers/policy still govern the decision." },
};

function isEcosystemCategory(v: string): v is EcosystemCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_IMPACT, v);
}

function evidenceFromEntry(
  entry: EcosystemEntry,
  ctx: { confidence: EcosystemEvidence["confidence"]; network?: NetworkName | null; chainId?: number | null; address?: string | null },
): EcosystemEvidence {
  return {
    category: entry.category,
    providerName: entry.name,
    status: entry.status,
    confidence: ctx.confidence,
    source: entry.source,
    officialDocsUrl: entry.officialDocsUrl ?? null,
    riskRelevance: entry.riskRelevance,
    safehandsBehavior: entry.safehandsBehavior,
    recommendedDecisionImpact: CATEGORY_IMPACT[entry.category],
    network: ctx.network ?? null,
    chainId: ctx.chainId ?? null,
    address: ctx.address ?? null,
  };
}

function evidenceFromCategory(category: EcosystemCategory, source: EvidenceSource, address: string | null): EcosystemEvidence {
  const meta = CATEGORY_META[category];
  return {
    category,
    providerName: null,
    status: category === "unknown" ? "not_implemented" : "to_verify",
    confidence: "low",
    source,
    officialDocsUrl: null,
    riskRelevance: meta.riskRelevance,
    safehandsBehavior: meta.safehandsBehavior,
    recommendedDecisionImpact: CATEGORY_IMPACT[category],
    network: null,
    chainId: null,
    address,
  };
}

export interface EcosystemClassifyInput {
  address?: string;
  /** Provider name/alias hint (e.g. "LayerZero"). */
  provider?: string;
  /** Direct ecosystem category hint. */
  category?: string;
  network?: PharosNetwork;
}

/**
 * Classify an ecosystem target. Priority: known official address → recognized
 * canonical Safe → provider-name hint → category hint → unknown.
 */
export function classifyEcosystem(input: EcosystemClassifyInput): EcosystemEvidence {
  const network = input.network ?? getActiveNetwork();
  const address = input.address?.trim() || null;

  // 1) Known official ecosystem address (e.g. Chainlink price-feed cache).
  if (address) {
    const byAddr = lookupEcosystemByAddress(address);
    if (byAddr) {
      return evidenceFromEntry(byAddr.entry, { confidence: "high", network: byAddr.network, chainId: byAddr.chainId, address });
    }
    // 2) Recognized canonical contract that maps to an ecosystem (Safe → wallet infra).
    const canonicalEco = ecosystemForCanonical(address, network);
    if (canonicalEco) {
      return evidenceFromEntry(canonicalEco, { confidence: "high", network: network.name, chainId: network.chainId, address });
    }
  }

  // 3) Provider name/alias hint.
  if (input.provider) {
    const byName = lookupEcosystemByName(input.provider);
    if (byName) return evidenceFromEntry(byName, { confidence: "medium", address });
  }

  // 4) Direct category hint.
  if (input.category) {
    const c = input.category.trim().toLowerCase();
    if (isEcosystemCategory(c) && c !== "unknown") return evidenceFromCategory(c, "to_verify", address);
  }

  // 5) Nothing recognized.
  return evidenceFromCategory("unknown", "to_verify", address);
}

/** Minimal request shape (structurally compatible with AgentRequest / parsed API input). */
export interface EcosystemRequestLike {
  to?: string;
  address?: string;
  token?: string;
  provider?: string;
  ecosystemCategory?: string;
  network?: string;
}

/** Classify ecosystem evidence for a request (address/target + optional hints). */
export function ecosystemEvidenceForRequest(req: EcosystemRequestLike): EcosystemEvidence {
  const network = req.network && isNetworkName(req.network)
    ? getNetworkByChainId(req.network === "pacific-mainnet" ? 1672 : 688689) ?? getActiveNetwork()
    : getActiveNetwork();
  return classifyEcosystem({
    address: req.address ?? req.to ?? req.token,
    provider: req.provider,
    category: req.ecosystemCategory,
    network,
  });
}

const SEVERITY: Record<GuardianDecision, number> = { BLOCK: 3, REQUIRE_CONFIRMATION: 2, PREPARE_ONLY: 1, ALLOW: 0 };

/**
 * Apply ecosystem evidence to a decision — ESCALATE-ONLY. Returns the more severe
 * of the current decision and the evidence's recommended impact; it NEVER downgrades
 * (a BLOCK stays BLOCK; an unlimited-approval BLOCK is never relaxed).
 */
export function applyEcosystemEscalation(decision: GuardianDecision, evidence: EcosystemEvidence): GuardianDecision {
  if (evidence.recommendedDecisionImpact !== "REQUIRE_CONFIRMATION") return decision;
  return SEVERITY[decision] >= SEVERITY.REQUIRE_CONFIRMATION ? decision : "REQUIRE_CONFIRMATION";
}

/** Re-export the registry for callers that want the full provider list. */
export { ECOSYSTEM_PROVIDERS };
