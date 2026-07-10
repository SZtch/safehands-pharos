// ─── Calldata Decoder (read-only, offline) ─────────────────────────────
// A canonical superset decoder for the common pre-sign risk selectors that a
// wallet drainer relies on: ERC-2612 permit, Permit2 approve, setApprovalForAll,
// transferFrom/transfer, increase/decreaseAllowance, plus a NON-EXHAUSTIVE
// dangerous-admin selector dictionary (ownership/upgrade/admin). ERC-20 approve
// (0x095ea7b3) is delegated to analyzeApproval so its behavior/tests stay the
// single source of truth. Pure: no RPC, no keys, no network, no signer. Never
// approves, signs, transfers, or sends. This analyzer is a SUB-SIGNAL only — the
// final verdict is the guardian aggregation (worstDecision), which can only be
// held or escalated by this decoder, never relaxed.
// ────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, getAddress, isAddress } from "viem";
import { isUnlimitedApprovalAmount } from "../policy/actionPolicyEngine.js";
import { DODO_APPROVE_ADDRESS, DODO_ROUTE_PROXY_ADDRESS } from "../constants.js";
import { isDenylistedRecipient } from "../recipientSafety.js";
import { analyzeApproval, APPROVE_SELECTOR } from "./approval.js";
import { canonicalContractEvidence, type CanonicalContractEvidence } from "./contractIntel.js";
import { tokenRegistryEvidence, type TokenRegistryEvidence } from "./pharosTokens.js";
import { makeResult, type AnalyzerResult } from "./types.js";

// ── Selector constants ─────────────────────────────────────────────────
export const PERMIT_SELECTOR = "0xd505accf"; // ERC-2612 permit(owner,spender,value,deadline,v,r,s)
export const PERMIT2_APPROVE_SELECTOR = "0x87517c45"; // Permit2 approve(token,spender,amount,expiration)
export const SET_APPROVAL_FOR_ALL_SELECTOR = "0xa22cb465"; // setApprovalForAll(operator,approved)
export const TRANSFER_FROM_SELECTOR = "0x23b872dd"; // transferFrom(from,to,amount)
export const TRANSFER_SELECTOR = "0xa9059cbb"; // transfer(to,amount)
export const INCREASE_ALLOWANCE_SELECTOR = "0x39509351"; // increaseAllowance(spender,addedValue)
export const DECREASE_ALLOWANCE_SELECTOR = "0xa457c2d7"; // decreaseAllowance(spender,subtractedValue)

// Dangerous / admin selectors — recognition & labeling only, NON-EXHAUSTIVE.
export const TRANSFER_OWNERSHIP_SELECTOR = "0xf2fde38b"; // transferOwnership(newOwner)
export const RENOUNCE_OWNERSHIP_SELECTOR = "0x715018a6"; // renounceOwnership()
export const UPGRADE_TO_SELECTOR = "0x3659cfe6"; // upgradeTo(newImplementation)
export const UPGRADE_TO_AND_CALL_SELECTOR = "0x4f1ef286"; // upgradeToAndCall(newImplementation,data)
export const CHANGE_ADMIN_SELECTOR = "0x8f283970"; // changeAdmin(newAdmin)

/** Canonical Permit2 singleton (lowercased). */
const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";
/** Permit2 amounts are uint160; type(uint160).max means "infinite". */
const PERMIT2_MAX_AMOUNT = (1n << 160n) - 1n;

/**
 * Selectors this analyzer decodes on its own (i.e. everything EXCEPT approve,
 * which analyzeApproval owns, and MultiSend, which analyzeSafeTx owns). The
 * guardian dispatch uses this to decide when to add the calldata analyzer.
 */
export const DECODABLE_CALLDATA_SELECTORS: ReadonlySet<string> = new Set([
  PERMIT_SELECTOR,
  PERMIT2_APPROVE_SELECTOR,
  SET_APPROVAL_FOR_ALL_SELECTOR,
  TRANSFER_FROM_SELECTOR,
  TRANSFER_SELECTOR,
  INCREASE_ALLOWANCE_SELECTOR,
  DECREASE_ALLOWANCE_SELECTOR,
  TRANSFER_OWNERSHIP_SELECTOR,
  RENOUNCE_OWNERSHIP_SELECTOR,
  UPGRADE_TO_SELECTOR,
  UPGRADE_TO_AND_CALL_SELECTOR,
  CHANGE_ADMIN_SELECTOR,
]);

/** True when `analyzeCalldata` can decode this selector (approve delegates in-analyzer). */
export function isDecodableCalldataSelector(selector: string | null): boolean {
  if (!selector) return false;
  return selector === APPROVE_SELECTOR || DECODABLE_CALLDATA_SELECTORS.has(selector);
}

// ── ABI fragments per selector ─────────────────────────────────────────
const ABIS = {
  [PERMIT_SELECTOR]: [{ name: "permit", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }], outputs: [] }],
  [PERMIT2_APPROVE_SELECTOR]: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "token", type: "address" }, { name: "spender", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }], outputs: [] }],
  [SET_APPROVAL_FOR_ALL_SELECTOR]: [{ name: "setApprovalForAll", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] }],
  [TRANSFER_FROM_SELECTOR]: [{ name: "transferFrom", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
  [TRANSFER_SELECTOR]: [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
  [INCREASE_ALLOWANCE_SELECTOR]: [{ name: "increaseAllowance", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "addedValue", type: "uint256" }], outputs: [{ type: "bool" }] }],
  [DECREASE_ALLOWANCE_SELECTOR]: [{ name: "decreaseAllowance", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "subtractedValue", type: "uint256" }], outputs: [{ type: "bool" }] }],
  [TRANSFER_OWNERSHIP_SELECTOR]: [{ name: "transferOwnership", type: "function", stateMutability: "nonpayable", inputs: [{ name: "newOwner", type: "address" }], outputs: [] }],
  [RENOUNCE_OWNERSHIP_SELECTOR]: [{ name: "renounceOwnership", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }],
  [UPGRADE_TO_SELECTOR]: [{ name: "upgradeTo", type: "function", stateMutability: "nonpayable", inputs: [{ name: "newImplementation", type: "address" }], outputs: [] }],
  [UPGRADE_TO_AND_CALL_SELECTOR]: [{ name: "upgradeToAndCall", type: "function", stateMutability: "payable", inputs: [{ name: "newImplementation", type: "address" }, { name: "data", type: "bytes" }], outputs: [] }],
  [CHANGE_ADMIN_SELECTOR]: [{ name: "changeAdmin", type: "function", stateMutability: "nonpayable", inputs: [{ name: "newAdmin", type: "address" }], outputs: [] }],
} as const;

const DANGEROUS_LABELS: Record<string, string> = {
  [TRANSFER_OWNERSHIP_SELECTOR]: "transfers contract ownership",
  [RENOUNCE_OWNERSHIP_SELECTOR]: "renounces contract ownership (irreversible)",
  [UPGRADE_TO_SELECTOR]: "upgrades the contract implementation (proxy)",
  [UPGRADE_TO_AND_CALL_SELECTOR]: "upgrades the contract implementation and calls into it (proxy)",
  [CHANGE_ADMIN_SELECTOR]: "changes the proxy admin",
};

export type CalldataCategory = "approval" | "transfer" | "admin" | "unknown";

export interface CalldataAnalysisDetails {
  method: string | null;
  selector: string | null;
  category: CalldataCategory;
  /** Token contract the call targets (Permit2 approve carries it inline; else the passed `token`). */
  token: string | null;
  /** Approval/permit spender (approve/permit/permit2/increase/decrease). */
  spender: string | null;
  /** setApprovalForAll operator. */
  operator: string | null;
  /** transfer/transferFrom recipient. */
  recipient: string | null;
  /** transferFrom source. */
  from: string | null;
  amountRaw: string | null;
  unlimited: boolean;
  isRevoke: boolean;
  /** setApprovalForAll approved flag (null for other methods). */
  approved: boolean | null;
  /** Whether the spender/operator is a recognized canonical/configured address. */
  counterpartyKnown: boolean;
  counterpartyLabel: string | null;
  /** Whether the recipient is on the operator denylist. */
  recipientDenylisted: boolean;
  /** True for the non-exhaustive dangerous-admin dictionary. */
  dangerous: boolean;
  canonicalContractEvidence: CanonicalContractEvidence | null;
  tokenRegistryEvidence: TokenRegistryEvidence | null;
}

type InternalDecision = "ALLOW" | "BLOCK" | "REQUIRE_CONFIRMATION";
type RiskLevel = AnalyzerResult["riskLevel"];

const EMPTY_DETAILS: CalldataAnalysisDetails = {
  method: null, selector: null, category: "unknown", token: null, spender: null, operator: null,
  recipient: null, from: null, amountRaw: null, unlimited: false, isRevoke: false, approved: null,
  counterpartyKnown: false, counterpartyLabel: null, recipientDenylisted: false, dangerous: false,
  canonicalContractEvidence: null, tokenRegistryEvidence: null,
};

/** Recognize a spender/operator as a known canonical or configured address. */
function classifyKnown(addr: string): { known: boolean; label: string | null; canonical: CanonicalContractEvidence | null } {
  const canonical = isAddress(addr) ? canonicalContractEvidence(addr) : null;
  if (canonical) return { known: true, label: canonical.name, canonical };
  const lower = addr.toLowerCase();
  if (lower === PERMIT2_ADDRESS) return { known: true, label: "Permit2", canonical: null };
  const configured: Record<string, string> = {
    [DODO_APPROVE_ADDRESS.toLowerCase()]: "DODO/FaroSwap approve proxy (testnet)",
    [DODO_ROUTE_PROXY_ADDRESS.toLowerCase()]: "DODO/FaroSwap route proxy (testnet)",
  };
  if (configured[lower]) return { known: true, label: configured[lower], canonical: null };
  return { known: false, label: null, canonical: null };
}

/** Shared approve-style risk matrix (approve/permit/permit2/increaseAllowance). */
function approvalRisk(spender: string, isRevoke: boolean, unlimited: boolean, known: boolean, label: string | null): { decision: InternalDecision; risk: RiskLevel; reason: string } {
  if (!isAddress(spender)) return { decision: "BLOCK", risk: "CRITICAL", reason: "Spender address is invalid." };
  if (isRevoke) return { decision: "ALLOW", risk: "LOW", reason: `Zero/revoke — clearing the allowance for ${spender}${label ? ` (${label})` : ""}.` };
  if (unlimited && !known) return { decision: "BLOCK", risk: "CRITICAL", reason: `Unlimited approval to an unknown spender (${spender}) — blocked.` };
  if (unlimited && known) return { decision: "REQUIRE_CONFIRMATION", risk: "HIGH", reason: `Unlimited approval to a known spender (${label}) — high risk, confirm intent.` };
  if (!known) return { decision: "REQUIRE_CONFIRMATION", risk: "MEDIUM", reason: `Approval to an unknown spender (${spender}) — confirm before approving.` };
  return { decision: "ALLOW", risk: "LOW", reason: `Limited approval to a known spender (${label}).` };
}

function result(params: {
  decision: InternalDecision; risk: RiskLevel; reasons: string[]; warnings: string[];
  status: AnalyzerResult["analyzerStatus"]; experimental?: boolean; details: CalldataAnalysisDetails;
}): AnalyzerResult<CalldataAnalysisDetails> {
  return makeResult<CalldataAnalysisDetails>({
    analyzer: "calldata",
    decision: params.decision,
    internalDecision: params.decision,
    riskLevel: params.risk,
    reasons: params.reasons,
    warnings: params.warnings,
    analyzerStatus: params.status,
    experimental: params.experimental,
    details: params.details,
  });
}

/**
 * Decode and risk-classify a single calldata payload.
 * @param data  0x-prefixed calldata
 * @param token optional token contract address the call targets (for metadata + Permit2 token)
 */
export function analyzeCalldata(data: string, token?: string): AnalyzerResult<CalldataAnalysisDetails> {
  const hex = (data?.startsWith("0x") ? data : `0x${data ?? ""}`).toLowerCase();
  const selector = hex.length >= 10 ? hex.slice(0, 10) : null;
  const tokenEvidence = token ? tokenRegistryEvidence(token) : null;

  // ERC-20 approve is owned by analyzeApproval — delegate and adapt its result.
  if (selector === APPROVE_SELECTOR) {
    const a = analyzeApproval(data, token);
    const d = a.details;
    return result({
      decision: (a.internalDecision as InternalDecision) ?? "REQUIRE_CONFIRMATION",
      risk: a.riskLevel,
      reasons: a.reasons,
      warnings: a.warnings,
      status: a.analyzerStatus,
      experimental: a.experimental,
      details: {
        ...EMPTY_DETAILS, method: "approve", selector, category: "approval", token: d.token,
        spender: d.spender, amountRaw: d.amountRaw, unlimited: d.unlimited, isRevoke: d.isRevoke,
        counterpartyKnown: d.spenderKnown, counterpartyLabel: d.spenderLabel,
        canonicalContractEvidence: d.canonicalContractEvidence, tokenRegistryEvidence: d.tokenRegistryEvidence,
      },
    });
  }

  if (!selector || !DECODABLE_CALLDATA_SELECTORS.has(selector)) {
    return result({
      decision: "REQUIRE_CONFIRMATION", risk: "UNKNOWN",
      reasons: [`Calldata selector ${selector ?? "n/a"} is not a recognized decodable method — confirm before signing.`],
      warnings: [], status: "unavailable", details: { ...EMPTY_DETAILS, selector },
    });
  }

  let args: readonly unknown[];
  try {
    const decoded = decodeFunctionData({ abi: ABIS[selector as keyof typeof ABIS], data: hex as `0x${string}` });
    args = decoded.args as readonly unknown[];
  } catch {
    return result({
      decision: "REQUIRE_CONFIRMATION", risk: "MEDIUM",
      reasons: ["Calldata matched a known selector but could not be decoded — malformed payload."],
      warnings: ["Malformed calldata for the recognized selector."],
      status: "partial", details: { ...EMPTY_DETAILS, selector },
    });
  }

  const base: CalldataAnalysisDetails = { ...EMPTY_DETAILS, selector, token: token ?? null, tokenRegistryEvidence: tokenEvidence };

  switch (selector) {
    case PERMIT_SELECTOR: {
      const spender = getAddress(args[1] as string);
      const value = args[2] as bigint;
      const unlimited = isUnlimitedApprovalAmount(value.toString());
      const isRevoke = value === 0n;
      const { known, label, canonical } = classifyKnown(spender);
      const r = approvalRisk(spender, isRevoke, unlimited, known, label);
      return result({
        decision: r.decision, risk: r.risk, reasons: [r.reason],
        warnings: ["ERC-2612 permit is a gasless, signature-based approval — the allowance is granted off-chain and can later authorize transfers."],
        status: "ok",
        details: { ...base, method: "permit", category: "approval", spender, amountRaw: value.toString(), unlimited, isRevoke, counterpartyKnown: known, counterpartyLabel: label, canonicalContractEvidence: canonical },
      });
    }
    case PERMIT2_APPROVE_SELECTOR: {
      const permitToken = getAddress(args[0] as string);
      const spender = getAddress(args[1] as string);
      const amount = args[2] as bigint;
      const expiration = String(args[3]); // uint48 — viem decodes as number
      const unlimited = amount >= PERMIT2_MAX_AMOUNT;
      const isRevoke = amount === 0n;
      const { known, label, canonical } = classifyKnown(spender);
      const r = approvalRisk(spender, isRevoke, unlimited, known, label);
      return result({
        decision: r.decision, risk: r.risk,
        reasons: [r.reason, `Permit2 approval for token ${permitToken}${expiration !== "0" ? ` (expiration ${expiration})` : ""}.`],
        warnings: ["Permit2 approval — authorizes the spender to move the token via Permit2 (signature-driven). Deep PermitSingle/PermitBatch/permitTransferFrom decode is out of scope."],
        status: "ok", experimental: true,
        details: { ...base, method: "permit2_approve", category: "approval", token: permitToken, spender, amountRaw: amount.toString(), unlimited, isRevoke, counterpartyKnown: known, counterpartyLabel: label, canonicalContractEvidence: canonical, tokenRegistryEvidence: tokenRegistryEvidence(permitToken) },
      });
    }
    case SET_APPROVAL_FOR_ALL_SELECTOR: {
      const operator = getAddress(args[0] as string);
      const approved = args[1] as boolean;
      const { known, label, canonical } = classifyKnown(operator);
      let decision: InternalDecision; let risk: RiskLevel; let reason: string;
      if (!isAddress(operator)) { decision = "BLOCK"; risk = "CRITICAL"; reason = "Operator address is invalid."; }
      else if (!approved) { decision = "ALLOW"; risk = "LOW"; reason = `Revoking blanket operator approval for ${operator}${label ? ` (${label})` : ""}.`; }
      else if (!known) { decision = "BLOCK"; risk = "CRITICAL"; reason = `Blanket collection approval (setApprovalForAll) to an UNKNOWN operator (${operator}) — this authorizes transfer of every token in the collection. Blocked.`; }
      else { decision = "REQUIRE_CONFIRMATION"; risk = "HIGH"; reason = `Blanket collection approval to a known operator (${label}) — high risk, confirm intent.`; }
      return result({
        decision, risk, reasons: [reason],
        warnings: approved ? ["setApprovalForAll grants control over ALL tokens in the collection — a common NFT-drainer vector."] : [],
        status: "ok",
        details: { ...base, method: "setApprovalForAll", category: "approval", operator, approved, counterpartyKnown: known, counterpartyLabel: label, canonicalContractEvidence: canonical },
      });
    }
    case TRANSFER_FROM_SELECTOR: {
      const from = getAddress(args[0] as string);
      const to = getAddress(args[1] as string);
      const amount = (args[2] as bigint).toString();
      return transferResult({ ...base, method: "transferFrom", from, recipient: to, amountRaw: amount }, to);
    }
    case TRANSFER_SELECTOR: {
      const to = getAddress(args[0] as string);
      const amount = (args[1] as bigint).toString();
      return transferResult({ ...base, method: "transfer", recipient: to, amountRaw: amount }, to);
    }
    case INCREASE_ALLOWANCE_SELECTOR: {
      const spender = getAddress(args[0] as string);
      const added = args[1] as bigint;
      const unlimited = isUnlimitedApprovalAmount(added.toString());
      const isRevoke = added === 0n;
      const { known, label, canonical } = classifyKnown(spender);
      const r = approvalRisk(spender, isRevoke, unlimited, known, label);
      return result({
        decision: r.decision, risk: r.risk, reasons: [`increaseAllowance — ${r.reason}`],
        warnings: ["increaseAllowance raises an existing allowance on top of the current one."], status: "ok",
        details: { ...base, method: "increaseAllowance", category: "approval", spender, amountRaw: added.toString(), unlimited, isRevoke, counterpartyKnown: known, counterpartyLabel: label, canonicalContractEvidence: canonical },
      });
    }
    case DECREASE_ALLOWANCE_SELECTOR: {
      const spender = getAddress(args[0] as string);
      const subtracted = (args[1] as bigint).toString();
      const { known, label, canonical } = classifyKnown(spender);
      return result({
        decision: "ALLOW", risk: "LOW", reasons: [`decreaseAllowance — lowering the allowance for ${spender}${label ? ` (${label})` : ""}.`],
        warnings: [], status: "ok",
        details: { ...base, method: "decreaseAllowance", category: "approval", spender, amountRaw: subtracted, counterpartyKnown: known, counterpartyLabel: label, canonicalContractEvidence: canonical },
      });
    }
    default:
      return dangerousAdmin(selector, args, base);
  }
}

/** transfer / transferFrom risk: denylist → BLOCK; otherwise REQUIRE_CONFIRMATION (never LOW — moving assets). */
function transferResult(details: CalldataAnalysisDetails, recipient: string): AnalyzerResult<CalldataAnalysisDetails> {
  const label = details.method === "transferFrom" ? "transferFrom" : "transfer";
  if (!isAddress(recipient)) {
    return result({ decision: "BLOCK", risk: "CRITICAL", reasons: [`${label} recipient address is invalid.`], warnings: [], status: "ok", details: { ...details, category: "transfer" } });
  }
  if (isDenylistedRecipient(recipient)) {
    return result({
      decision: "BLOCK", risk: "CRITICAL",
      reasons: [`${label} recipient ${recipient} is on the operator denylist — blocked.`],
      warnings: [], status: "ok",
      details: { ...details, category: "transfer", recipientDenylisted: true },
    });
  }
  // Unknown / unverified recipient — a token transfer moves assets, so a pre-sign
  // firewall must require confirmation. Never ALLOW/LOW for an unknown recipient.
  return result({
    decision: "REQUIRE_CONFIRMATION", risk: "MEDIUM",
    reasons: [`${label} moves tokens to ${recipient} — recipient is not verified; confirm before signing.`],
    warnings: [], status: "ok",
    details: { ...details, category: "transfer" },
  });
}

/** Non-exhaustive dangerous-admin dictionary — recognition/label only, always REQUIRE_CONFIRMATION. */
function dangerousAdmin(selector: string, args: readonly unknown[], base: CalldataAnalysisDetails): AnalyzerResult<CalldataAnalysisDetails> {
  const label = DANGEROUS_LABELS[selector] ?? "performs a privileged/admin action";
  const targetArg = args.length > 0 && isAddress(args[0] as string) ? getAddress(args[0] as string) : null;
  const method = ({
    [TRANSFER_OWNERSHIP_SELECTOR]: "transferOwnership", [RENOUNCE_OWNERSHIP_SELECTOR]: "renounceOwnership",
    [UPGRADE_TO_SELECTOR]: "upgradeTo", [UPGRADE_TO_AND_CALL_SELECTOR]: "upgradeToAndCall", [CHANGE_ADMIN_SELECTOR]: "changeAdmin",
  } as Record<string, string>)[selector] ?? null;
  return result({
    decision: "REQUIRE_CONFIRMATION", risk: "HIGH",
    reasons: [`Dangerous/admin call: this transaction ${label}${targetArg ? ` (target ${targetArg})` : ""} — confirm this is intended.`],
    warnings: ["Recognized as a privileged/admin function. This dangerous-selector list is NOT exhaustive — absence of a warning is not proof of safety."],
    status: "ok",
    details: { ...base, method, category: "admin", dangerous: true, spender: targetArg, recipient: targetArg },
  });
}
