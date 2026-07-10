// ─── Token Analyzer (read-only) ────────────────────────────────────────
// Maps a token (symbol or address) to a public SafeHands decision, PER-NETWORK.
// On Pacific Mainnet it uses the official Pharos token registry
// (constants.PACIFIC_MAINNET_TOKEN_REGISTRY, Phase 5A audit); on Atlantic Testnet
// it uses the existing testnet classifier (unchanged). Tokens are never trusted
// by symbol alone, and a known token NEVER makes a risky action safe.
// ────────────────────────────────────────────────────────────────────────

import { getAddress, isAddress } from "viem";
import { classifyTokenRegistryStatus, type TokenRegistryStatusValue } from "../../tools/tokenRegistryStatus.js";
import { getActiveNetwork, type NetworkName } from "../networks.js";
import { lookupPharosToken, tokenRegistryEvidence, type TokenRegistryEvidence } from "./pharosTokens.js";
import { makeResult, type AnalyzerResult } from "./types.js";

export interface TokenAnalysisDetails {
  input: string;
  resolvedFrom: "symbol" | "address" | "invalid";
  normalizedAddress: string | null;
  symbol: string | null;
  status: TokenRegistryStatusValue;
  verificationStatus: string;
  /** Which network's registry produced this verdict. */
  registryScope: NetworkName;
  /** True — SafeHands now ships a Pacific Mainnet token registry (Phase 5B). */
  mainnetRegistryImplemented: boolean;
  /** Per-network token-registry evidence (null when not a valid token). */
  tokenRegistryEvidence: TokenRegistryEvidence | null;
  activeNetwork: string;
}

export function analyzeToken(token: string): AnalyzerResult<TokenAnalysisDetails> {
  const raw = (token ?? "").trim();
  const active = getActiveNetwork();
  const evidence = tokenRegistryEvidence(raw, active);

  return active.isMainnet ? analyzePacificToken(raw, active.name, evidence) : analyzeAtlanticToken(raw, active.name, evidence);
}

/** Pacific Mainnet: recognize against the official Pharos token registry. */
function analyzePacificToken(raw: string, registryScope: NetworkName, evidence: TokenRegistryEvidence | null): AnalyzerResult<TokenAnalysisDetails> {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const tok = lookupPharosToken(raw, "pacific-mainnet");
  let normalizedAddress: string | null;
  let symbol: string | null;
  let status: TokenRegistryStatusValue;
  let verificationStatus: string;
  let resolvedFrom: TokenAnalysisDetails["resolvedFrom"];
  let internalDecision: "ALLOW" | "BLOCK" | "REQUIRE_CONFIRMATION";
  let riskLevel: AnalyzerResult["riskLevel"];

  if (tok) {
    normalizedAddress = getAddress(tok.address);
    symbol = tok.symbol;
    status = "CANONICAL_MAINNET_TOKEN";
    verificationStatus = "DOCS_VERIFIED";
    resolvedFrom = isAddress(raw) ? "address" : "symbol";
    if (resolvedFrom === "address") {
      // ALLOW requires an address match against the official registry — the caller
      // named the exact canonical contract.
      internalDecision = "ALLOW";
      riskLevel = "LOW";
      reasons.push(`Token is a canonical Pharos Pacific Mainnet token (${symbol}).`);
    } else {
      // Fail-closed (truth-model rule 1): a known NAME alone never produces ALLOW.
      // The symbol resolves to the canonical registry address, but the caller did
      // not identify a contract — confirm the resolved address before acting.
      internalDecision = "REQUIRE_CONFIRMATION";
      riskLevel = "MEDIUM";
      reasons.push(`Symbol "${raw}" resolves to the canonical Pharos Pacific Mainnet token ${symbol} at ${normalizedAddress}, but a symbol alone is not an on-chain guarantee — confirm the resolved address before acting on it.`);
      warnings.push(`Symbol "${raw}" was resolved to the official Pacific Mainnet registry address ${normalizedAddress} — a symbol alone is not an on-chain guarantee.`);
    }
  } else if (isAddress(raw)) {
    normalizedAddress = getAddress(raw);
    symbol = null;
    status = "CUSTOM_NON_REGISTRY";
    verificationStatus = "UNVERIFIED_CUSTOM_TOKEN";
    resolvedFrom = "address";
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "MEDIUM";
    reasons.push("Token is not in the Pacific Mainnet registry — unknown/custom token requires review.");
  } else {
    normalizedAddress = null;
    symbol = null;
    status = "INVALID_ADDRESS";
    verificationStatus = "INVALID_ADDRESS";
    resolvedFrom = "invalid";
    internalDecision = "BLOCK";
    riskLevel = "CRITICAL";
    reasons.push("Token is not a valid EVM address or known Pacific Mainnet symbol.");
  }

  return makeResult<TokenAnalysisDetails>({
    analyzer: "token",
    decision: internalDecision,
    internalDecision,
    riskLevel,
    reasons,
    warnings,
    analyzerStatus: "ok",
    details: { input: raw, resolvedFrom, normalizedAddress, symbol, status, verificationStatus, registryScope, mainnetRegistryImplemented: true, tokenRegistryEvidence: evidence, activeNetwork: registryScope },
  });
}

/** Atlantic Testnet: existing testnet classifier (behavior preserved). */
function analyzeAtlanticToken(raw: string, registryScope: NetworkName, evidence: TokenRegistryEvidence | null): AnalyzerResult<TokenAnalysisDetails> {
  const cls = classifyTokenRegistryStatus(raw);
  const reasons: string[] = [];
  const warnings: string[] = [];

  const resolvedFrom: TokenAnalysisDetails["resolvedFrom"] =
    cls.status === "INVALID_ADDRESS" ? "invalid" : isAddress(raw) ? "address" : "symbol";

  if (resolvedFrom === "symbol" && cls.normalizedAddress) {
    warnings.push(`Symbol "${raw}" was resolved to the project's testnet registry address ${cls.normalizedAddress} — a symbol alone is not an on-chain guarantee.`);
  }

  let internalDecision: "ALLOW" | "BLOCK" | "REQUIRE_CONFIRMATION";
  let riskLevel: AnalyzerResult["riskLevel"];

  switch (cls.status) {
    case "INVALID_ADDRESS":
      internalDecision = "BLOCK";
      riskLevel = "CRITICAL";
      reasons.push("Token is not a valid EVM address or known symbol.");
      break;
    case "SKILL_ENGINE_CANONICAL_TOKEN":
    case "CANONICAL_MAINNET_TOKEN":
      if (resolvedFrom === "symbol") {
        // Fail-closed (truth-model rule 1): a known NAME alone never produces ALLOW.
        internalDecision = "REQUIRE_CONFIRMATION";
        riskLevel = "MEDIUM";
        reasons.push(`Symbol "${raw}" resolves to the registry token ${cls.symbol ?? "?"} at ${cls.normalizedAddress ?? "?"}, but a symbol alone is not an on-chain guarantee — confirm the resolved address before acting on it.`);
      } else {
        internalDecision = "ALLOW";
        riskLevel = "LOW";
        reasons.push(`Token is a canonical Atlantic-mainnet token (${cls.symbol ?? "?"}).`);
      }
      break;
    case "ALTERNATE_SOURCE_TOKEN":
      internalDecision = "REQUIRE_CONFIRMATION";
      riskLevel = "MEDIUM";
      reasons.push("Token is an alternate-source token (not the primary registry entry) — confirm before use.");
      break;
    case "CUSTOM_NON_REGISTRY":
    case "UNKNOWN":
    default:
      internalDecision = "REQUIRE_CONFIRMATION";
      riskLevel = "MEDIUM";
      reasons.push("Token is not in the SafeHands registry — unknown/custom token requires review.");
      break;
  }

  return makeResult<TokenAnalysisDetails>({
    analyzer: "token",
    decision: internalDecision,
    internalDecision,
    riskLevel,
    reasons,
    warnings,
    analyzerStatus: "ok",
    details: {
      input: raw,
      resolvedFrom,
      normalizedAddress: cls.normalizedAddress,
      symbol: cls.symbol,
      status: cls.status,
      verificationStatus: cls.verificationStatus,
      registryScope,
      mainnetRegistryImplemented: true,
      tokenRegistryEvidence: evidence,
      activeNetwork: registryScope,
    },
  });
}
