// ─── Network-aware Pharos Token Registry (read-only) ───────────────────
// Single source of truth for token-registry *evidence*. Pacific Mainnet uses the
// official Pharos token list (constants.PACIFIC_MAINNET_TOKEN_REGISTRY); Atlantic
// Testnet delegates to the existing testnet classifier (unchanged). Recognition is
// by registry address only — it is NOT a safety guarantee for an action. Pure: no
// RPC, no keys, no writes.
// ────────────────────────────────────────────────────────────────────────

import { getAddress, isAddress } from "viem";
import { PACIFIC_MAINNET_TOKEN_REGISTRY } from "../constants.js";
import { getActiveNetwork, type NetworkName, type PharosNetwork } from "../networks.js";
import { classifyTokenRegistryStatus } from "../../tools/tokenRegistryStatus.js";
import type { EvidenceSource, EvidenceStatus } from "./types.js";

export interface TokenRegistryEvidence {
  symbol: string | null;
  name: string | null;
  network: NetworkName;
  chainId: number;
  address: string | null;
  decimals: number | null;
  source: EvidenceSource;
  status: EvidenceStatus;
  riskRelevance: string;
}

const RISK_RELEVANCE =
  "Recognized via the network token registry by address; recognition is metadata, not a safety guarantee; a known token does not make a risky action safe.";

interface ResolvedToken {
  symbol: string;
  name: string | null;
  address: string;
  decimals: number | null;
  source: EvidenceSource;
}

/** Resolve a token (symbol or address) within a network's official registry. */
export function lookupPharosToken(input: string, network: NetworkName): ResolvedToken | undefined {
  const raw = (input ?? "").trim();
  if (!raw) return undefined;

  if (network === "pacific-mainnet") {
    const upper = raw.toUpperCase();
    const entries = Object.values(PACIFIC_MAINNET_TOKEN_REGISTRY);
    const bySymbol = entries.find((t) => t.symbol === upper);
    if (bySymbol) {
      return { symbol: bySymbol.symbol, name: bySymbol.name, address: bySymbol.address, decimals: bySymbol.decimals, source: "official_docs" };
    }
    if (isAddress(raw)) {
      const lower = raw.toLowerCase();
      const byAddr = entries.find((t) => t.address.toLowerCase() === lower);
      if (byAddr) {
        return { symbol: byAddr.symbol, name: byAddr.name, address: byAddr.address, decimals: byAddr.decimals, source: "official_docs" };
      }
    }
    return undefined;
  }

  // Atlantic Testnet — delegate to the existing classifier (behavior preserved).
  const cls = classifyTokenRegistryStatus(raw);
  if (cls.symbol && cls.normalizedAddress && (cls.status === "CANONICAL_MAINNET_TOKEN" || cls.status === "SKILL_ENGINE_CANONICAL_TOKEN")) {
    return { symbol: cls.symbol, name: null, address: cls.normalizedAddress, decimals: null, source: "existing_registry" };
  }
  return undefined;
}

/**
 * Build read-only token-registry evidence for a token on a network.
 *  - recognized official token → status `implemented`
 *  - valid but unknown address  → status `to_verify` (never silently trusted)
 *  - invalid / unknown symbol   → `null`
 */
export function tokenRegistryEvidence(input: string, network: PharosNetwork = getActiveNetwork()): TokenRegistryEvidence | null {
  const raw = (input ?? "").trim();
  const tok = lookupPharosToken(raw, network.name);
  if (tok) {
    return {
      symbol: tok.symbol,
      name: tok.name,
      network: network.name,
      chainId: network.chainId,
      address: tok.address,
      decimals: tok.decimals,
      source: tok.source,
      status: "implemented",
      riskRelevance: RISK_RELEVANCE,
    };
  }
  if (isAddress(raw)) {
    return {
      symbol: null,
      name: null,
      network: network.name,
      chainId: network.chainId,
      address: getAddress(raw),
      decimals: null,
      source: "to_verify",
      status: "to_verify",
      riskRelevance: "Token is a valid address but not in the official network registry; treat as unverified/custom (TO_VERIFY).",
    };
  }
  return null;
}
