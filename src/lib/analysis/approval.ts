// ─── Approval Analyzer (read-only) ─────────────────────────────────────
// Decodes ERC-20 approve(address,uint256) calldata and classifies risk. Permit2
// is recognized; deep Permit2 (PermitSingle/PermitBatch) decode is Experimental.
// Never approves, signs, or sends.
// ────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, getAddress, isAddress } from "viem";
import { isUnlimitedApprovalAmount } from "../policy/actionPolicyEngine.js";
import { DODO_APPROVE_ADDRESS, DODO_ROUTE_PROXY_ADDRESS } from "../constants.js";
import { canonicalContractEvidence, type CanonicalContractEvidence } from "./contractIntel.js";
import { tokenRegistryEvidence, type TokenRegistryEvidence } from "./pharosTokens.js";
import { makeResult, type AnalyzerResult } from "./types.js";

export const APPROVE_SELECTOR = "0x095ea7b3";
const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";

const APPROVE_ABI = [
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
] as const;

/** Trusted spenders recognized by SafeHands config (canonical + project routers). */
function classifySpender(spender: string): { known: boolean; label: string | null; isPermit2: boolean; canonical: CanonicalContractEvidence | null } {
  const canonical = isAddress(spender) ? canonicalContractEvidence(spender) : null;
  const lower = spender.toLowerCase();
  const isPermit2 = lower === PERMIT2_ADDRESS;
  const configured: Record<string, string> = {
    [DODO_APPROVE_ADDRESS.toLowerCase()]: "DODO/FaroSwap approve proxy (testnet)",
    [DODO_ROUTE_PROXY_ADDRESS.toLowerCase()]: "DODO/FaroSwap route proxy (testnet)",
  };
  if (canonical) return { known: true, label: canonical.name, isPermit2, canonical };
  if (configured[lower]) return { known: true, label: configured[lower], isPermit2, canonical: null };
  return { known: false, label: null, isPermit2, canonical: null };
}

export interface ApprovalAnalysisDetails {
  isApproval: boolean;
  selector: string | null;
  token: string | null;
  spender: string | null;
  spenderKnown: boolean;
  spenderLabel: string | null;
  isPermit2Spender: boolean;
  amountRaw: string | null;
  unlimited: boolean;
  isRevoke: boolean;
  /** Per-network canonical recognition of the spender (null when not canonical). */
  canonicalContractEvidence: CanonicalContractEvidence | null;
  /** Per-network token-registry evidence for the approved token (null when unknown). */
  tokenRegistryEvidence: TokenRegistryEvidence | null;
}

/**
 * @param data  ERC-20 calldata (expected approve(address,uint256))
 * @param token optional token contract address the approval targets
 */
export function analyzeApproval(data: string, token?: string): AnalyzerResult<ApprovalAnalysisDetails> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const hex = (data?.startsWith("0x") ? data : `0x${data ?? ""}`).toLowerCase();
  const selector = hex.length >= 10 ? hex.slice(0, 10) : null;
  // Read-only metadata only — a known token NEVER makes a risky approval safe.
  const tokenEvidence = token ? tokenRegistryEvidence(token) : null;

  const notApproval = (msg: string): AnalyzerResult<ApprovalAnalysisDetails> =>
    makeResult<ApprovalAnalysisDetails>({
      analyzer: "approval",
      decision: "REQUIRE_CONFIRMATION",
      internalDecision: "REQUIRE_CONFIRMATION",
      riskLevel: "UNKNOWN",
      reasons: [msg],
      warnings: [],
      analyzerStatus: "unavailable",
      details: { isApproval: false, selector, token: token ?? null, spender: null, spenderKnown: false, spenderLabel: null, isPermit2Spender: false, amountRaw: null, unlimited: false, isRevoke: false, canonicalContractEvidence: null, tokenRegistryEvidence: tokenEvidence },
    });

  if (selector !== APPROVE_SELECTOR) {
    return notApproval(`Calldata is not an ERC-20 approve (selector ${selector ?? "n/a"}).`);
  }

  let spender: string;
  let amount: bigint;
  try {
    const decoded = decodeFunctionData({ abi: APPROVE_ABI, data: hex as `0x${string}` });
    spender = getAddress(decoded.args[0] as string);
    amount = decoded.args[1] as bigint;
  } catch {
    return makeResult<ApprovalAnalysisDetails>({
      analyzer: "approval",
      decision: "REQUIRE_CONFIRMATION",
      internalDecision: "REQUIRE_CONFIRMATION",
      riskLevel: "MEDIUM",
      reasons: ["approve() calldata could not be decoded — malformed approval."],
      warnings: ["Malformed approval calldata."],
      analyzerStatus: "partial",
      details: { isApproval: true, selector, token: token ?? null, spender: null, spenderKnown: false, spenderLabel: null, isPermit2Spender: false, amountRaw: null, unlimited: false, isRevoke: false, canonicalContractEvidence: null, tokenRegistryEvidence: tokenEvidence },
    });
  }

  const unlimited = isUnlimitedApprovalAmount(amount.toString());
  const isRevoke = amount === 0n;
  const { known, label, isPermit2, canonical } = classifySpender(spender);
  if (isPermit2) warnings.push("Spender is Permit2 — Permit2-based approvals can later authorize transfers via signatures (deep Permit2 decode is Experimental).");

  let internalDecision: "ALLOW" | "BLOCK" | "REQUIRE_CONFIRMATION";
  let riskLevel: AnalyzerResult["riskLevel"];

  if (!isAddress(spender)) {
    internalDecision = "BLOCK";
    riskLevel = "CRITICAL";
    reasons.push("Spender address is invalid.");
  } else if (isRevoke) {
    internalDecision = "ALLOW";
    riskLevel = "LOW";
    reasons.push(`Zero approval — revoking the allowance for ${spender}${label ? ` (${label})` : ""}.`);
  } else if (unlimited && !known) {
    internalDecision = "BLOCK";
    riskLevel = "CRITICAL";
    reasons.push(`Unlimited approval to an unknown spender (${spender}) — blocked.`);
  } else if (unlimited && known) {
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "HIGH";
    reasons.push(`Unlimited approval to a known spender (${label}) — high risk, confirm intent.`);
  } else if (!known) {
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "MEDIUM";
    reasons.push(`Approval (amount ${amount.toString()}) to an unknown spender (${spender}) — confirm before approving.`);
  } else {
    internalDecision = "ALLOW";
    riskLevel = "LOW";
    reasons.push(`Limited approval (amount ${amount.toString()}) to a known spender (${label}).`);
  }

  return makeResult<ApprovalAnalysisDetails>({
    analyzer: "approval",
    decision: internalDecision,
    internalDecision,
    riskLevel,
    reasons,
    warnings,
    analyzerStatus: "ok",
    experimental: isPermit2 || undefined,
    details: {
      isApproval: true,
      selector,
      token: token ?? null,
      spender,
      spenderKnown: known,
      spenderLabel: label,
      isPermit2Spender: isPermit2,
      amountRaw: amount.toString(),
      unlimited,
      isRevoke,
      canonicalContractEvidence: canonical,
      tokenRegistryEvidence: tokenEvidence,
    },
  });
}
