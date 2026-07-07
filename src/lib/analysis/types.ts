// ─── SafeHands Read-Only Analyzers — Shared Types ──────────────────────
// Every analyzer is READ-ONLY. No analyzer signs, sends, approves, swaps,
// publishes, or writes on-chain. Optional chain access is read-only (eth_getCode,
// eth_estimateGas, eth_getGasPrice, eth_getTransactionReceipt) and is omitted in
// offline/pure analysis and tests.
// ────────────────────────────────────────────────────────────────────────

import type { GuardianDecision } from "../guardian/decision.js";

export type AnalyzerRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

/** ok = fully analyzed; partial = recognized but not fully decoded; unavailable = could not analyze. */
export type AnalyzerStatus = "ok" | "partial" | "unavailable";

/**
 * Shared provenance/maturity labels for read-only recognition evidence
 * (canonical contracts, token registry). Recognition is metadata — it is never a
 * safety guarantee for an action.
 *   official_docs    — taken from official Pharos docs (Phase 5A audit).
 *   existing_registry — from the project's existing testnet registry/config.
 *   to_verify        — a valid target that is NOT in any official registry.
 */
export type EvidenceSource = "official_docs" | "existing_registry" | "to_verify";
/** implemented = backed by code + tests; experimental = partial; to_verify = unconfirmed. */
export type EvidenceStatus = "implemented" | "experimental" | "to_verify";

export interface AnalyzerResult<TDetails = Record<string, unknown>> {
  analyzer: string;
  /** Public four-value SafeHands decision. */
  decision: GuardianDecision;
  /** Internal engine-style label kept for explanation only. */
  internalDecision?: string;
  riskLevel: AnalyzerRiskLevel;
  reasons: string[];
  warnings: string[];
  analyzerStatus: AnalyzerStatus;
  /** True when the analyzer is a partial/demo decoder (e.g. deep Safe/Permit2 decode). */
  experimental?: boolean;
  /** Always true — analyzers never write. Lets callers/tests assert read-only. */
  readOnly: true;
  details: TDetails;
}

/**
 * Optional read-only chain access. Pass concrete implementations from
 * pharosClient in tool wiring; omit for offline/pure analysis and smoke tests.
 * None of these may mutate chain state.
 */
export interface ReadOnlyChainAccess {
  getCode?: (address: `0x${string}`) => Promise<string | undefined>;
  estimateGas?: (args: {
    to?: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
    account?: `0x${string}`;
  }) => Promise<bigint>;
  getGasPrice?: () => Promise<bigint>;
  getTransactionReceipt?: (hash: `0x${string}`) => Promise<unknown>;
}

export function makeResult<T>(partial: Omit<AnalyzerResult<T>, "readOnly">): AnalyzerResult<T> {
  return { readOnly: true, ...partial };
}
