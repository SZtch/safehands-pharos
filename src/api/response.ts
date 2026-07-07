// ─── SafeHands API — Response Helpers (read-only) ─────────────
// Shared response shaping for the read-only SafeHands API. `readOnlyMeta()`
// stamps every payload as read-only and reports executionAvailable (false by
// default — mainnet executionAllowed=false and all gates default off). No helper
// here can sign, send, or publish.
// ────────────────────────────────────────────────────────────────────────

import { isExecutionAvailable } from "../lib/config.js";
import type { PharosNetwork } from "../lib/networks.js";
import type { GuardianDecision } from "../lib/guardian/decision.js";
import { rpcEvidence, gasEvidence, type RpcEvidence, type GasEvidence } from "../lib/pharos/rpcEvidence.js";
import type { ReadOnlyChainAccess } from "../lib/analysis/types.js";

export { ok, fail } from "../lib/toolResponse.js";

export interface ReadOnlyMeta {
  /** Always true — the API never writes, signs, sends, or publishes. */
  readOnly: true;
  /** False by default (mainnet execution disabled + gates off). */
  executionAvailable: boolean;
}

/** Stamp a payload as read-only and report whether execution is available. */
export function readOnlyMeta(): ReadOnlyMeta {
  return { readOnly: true, executionAvailable: isExecutionAvailable() };
}

export interface RpcMeta {
  rpcEvidence: RpcEvidence;
  gasEvidence: GasEvidence;
  /** Alias of `rpcEvidence` for spec-compliance (same content). */
  pharosEvidence: RpcEvidence;
}

/**
 * Read-only RPC + gas capability evidence for a response. Deterministic, offline,
 * and secret-free (no RPC URL/API key — only the redacted provider name). Evidence
 * is metadata: it never relaxes a SafeHands decision.
 */
export function rpcMeta(network: PharosNetwork, access?: ReadOnlyChainAccess): RpcMeta {
  const evidence = rpcEvidence(network, access);
  return { rpcEvidence: evidence, gasEvidence: gasEvidence(access), pharosEvidence: evidence };
}

export interface ExplorerLinks {
  address?: string;
  tx?: string;
  socialScanAddress?: string;
  socialScanTx?: string;
}

/** Build read-only explorer links from a network's public explorer URLs. */
export function explorerLinks(
  network: PharosNetwork,
  ref: { address?: string | null; txHash?: string | null },
): ExplorerLinks {
  const base = network.explorerUrl.replace(/\/+$/, "");
  const social = network.socialScanUrl?.replace(/\/+$/, "");
  const links: ExplorerLinks = {};
  if (ref.address) {
    links.address = `${base}/address/${ref.address}`;
    if (social) links.socialScanAddress = `${social}/address/${ref.address}`;
  }
  if (ref.txHash) {
    links.tx = `${base}/tx/${ref.txHash}`;
    if (social) links.socialScanTx = `${social}/tx/${ref.txHash}`;
  }
  return links;
}

// Severity order: most severe wins when aggregating multiple analyzers.
const SEVERITY: Record<GuardianDecision, number> = {
  BLOCK: 3,
  REQUIRE_CONFIRMATION: 2,
  PREPARE_ONLY: 1,
  ALLOW: 0,
};

/** Aggregate analyzer decisions to the most severe public decision. */
export function worstDecision(decisions: GuardianDecision[]): GuardianDecision {
  if (decisions.length === 0) return "REQUIRE_CONFIRMATION";
  return decisions.reduce((worst, d) => (SEVERITY[d] > SEVERITY[worst] ? d : worst), "ALLOW");
}
