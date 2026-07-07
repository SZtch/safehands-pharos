// ─── SafeHands Agent — Policy Resolver (read-only) ────────────
// Configurable SafeHands policy and an ESCALATE-ONLY enforcement step. Policy may
// only raise severity (ALLOW → REQUIRE_CONFIRMATION → BLOCK) or annotate — it can
// never relax a BLOCK or weaken an analyzer verdict. Pure: no RPC, no keys.
// ────────────────────────────────────────────────────────────────────────

import type { GuardianDecision } from "../lib/guardian/decision.js";
import { isUnlimitedApprovalAmount } from "../lib/policy/actionPolicyEngine.js";
import type { AgentIntent, AgentRequest } from "./agentIntentClassifier.js";

/** Who owns the policy. backend = the public default; the rest are advanced. */
export type PolicyOwner = "backend" | "user" | "dapp" | "agent";

export interface GuardianPolicy {
  /** Max native transfer (wei) before confirmation is required. */
  maxNativeTransferWei: string;
  /** Max ERC-20 approval amount (raw token units) before confirmation. */
  maxApprovalAmount: string;
  /** Max single x402 payment (USDC) before confirmation. */
  maxX402PaymentUsdc: string;
  /** Max cumulative daily agent spend (USDC) — advisory ceiling. */
  maxDailyAgentSpendUsdc: string;
  /** Recipients exempt from the native-transfer confirmation (annotated, not relaxed past BLOCK). */
  trustedRecipients: string[];
  /** Spenders treated as known for approvals (annotation only). */
  trustedSpenders: string[];
  /** Escalate unlimited approvals to BLOCK even for known spenders. */
  blockUnlimitedApproval: boolean;
  /** Require confirmation for any unknown / unrecognized contract call. */
  requireConfirmationForUnknownContract: boolean;
}

/** The public default backend policy (conservative, read-only). */
export const DEFAULT_BACKEND_POLICY: GuardianPolicy = {
  maxNativeTransferWei: "10000000000000000000", // 10 native
  maxApprovalAmount: "1000000000000", // 1e12 raw units
  maxX402PaymentUsdc: "1",
  maxDailyAgentSpendUsdc: "100",
  trustedRecipients: [],
  trustedSpenders: [],
  blockUnlimitedApproval: true,
  requireConfirmationForUnknownContract: true,
};

/** Merge owner defaults with explicit overrides. */
export function resolvePolicy(owner: PolicyOwner = "backend", overrides?: Partial<GuardianPolicy>): GuardianPolicy {
  // Every owner currently starts from the conservative backend baseline.
  void owner;
  return { ...DEFAULT_BACKEND_POLICY, ...(overrides ?? {}) };
}

const SEVERITY: Record<GuardianDecision, number> = { BLOCK: 3, REQUIRE_CONFIRMATION: 2, PREPARE_ONLY: 1, ALLOW: 0 };

/** Return the more severe of two decisions (escalate-only). */
function escalate(current: GuardianDecision, to: GuardianDecision): GuardianDecision {
  return SEVERITY[to] > SEVERITY[current] ? to : current;
}

export interface PolicyOutcome {
  decision: GuardianDecision;
  reasons: string[];
  notes: string[];
  escalated: boolean;
}

function bigintOrNull(v: unknown): bigint | null {
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "bigint") return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/**
 * Apply policy to a base (analyzer) decision. Escalates severity only.
 * @param analyzerDetails the primary analyzer's `details` object (read-only).
 */
export function applyPolicy(args: {
  base: GuardianDecision;
  intent: AgentIntent;
  req: AgentRequest;
  policy: GuardianPolicy;
  analyzerDetails?: Record<string, unknown>;
}): PolicyOutcome {
  const { intent, req, policy } = args;
  const details = args.analyzerDetails ?? {};
  let decision = args.base;
  const reasons: string[] = [];
  const notes: string[] = [];
  const before = decision;

  if (intent === "native_transfer") {
    const value = bigintOrNull(req.value);
    const max = bigintOrNull(policy.maxNativeTransferWei);
    const trusted = req.to && policy.trustedRecipients.map((r) => r.toLowerCase()).includes(req.to.toLowerCase());
    if (trusted) notes.push(`Recipient ${req.to} is in trustedRecipients.`);
    if (value !== null && max !== null && value > max && !trusted) {
      decision = escalate(decision, "REQUIRE_CONFIRMATION");
      reasons.push(`Native transfer ${value} wei exceeds policy max ${policy.maxNativeTransferWei} wei.`);
    }
  } else if (intent === "erc20_approval" || intent === "permit2_approval") {
    const unlimited = details.unlimited === true || (typeof details.amountRaw === "string" && isUnlimitedApprovalAmount(details.amountRaw));
    const spender = typeof details.spender === "string" ? details.spender : null;
    const trusted = spender && policy.trustedSpenders.map((s) => s.toLowerCase()).includes(spender.toLowerCase());
    if (trusted) notes.push(`Spender ${spender} is in trustedSpenders.`);
    if (unlimited && policy.blockUnlimitedApproval) {
      decision = escalate(decision, "BLOCK");
      reasons.push("Policy blocks unlimited approvals (blockUnlimitedApproval=true).");
    }
    const amount = bigintOrNull(details.amountRaw);
    const max = bigintOrNull(policy.maxApprovalAmount);
    if (!unlimited && amount !== null && max !== null && amount > max && !trusted) {
      decision = escalate(decision, "REQUIRE_CONFIRMATION");
      reasons.push(`Approval amount ${amount} exceeds policy max ${policy.maxApprovalAmount}.`);
    }
  } else if (intent === "x402_payment_request") {
    const amt = Number(details.paymentAmountUsdc ?? req.paymentAmountUsdc);
    const max = Number(policy.maxX402PaymentUsdc);
    if (Number.isFinite(amt) && Number.isFinite(max) && amt > max) {
      decision = escalate(decision, "REQUIRE_CONFIRMATION");
      reasons.push(`x402 payment ${amt} USDC exceeds policy max ${policy.maxX402PaymentUsdc} USDC.`);
    }
  } else if (intent === "unknown_contract_call" || intent === "raw_transaction_intent") {
    if (policy.requireConfirmationForUnknownContract) {
      decision = escalate(decision, "REQUIRE_CONFIRMATION");
      reasons.push("Policy requires confirmation for unknown/unrecognized contract calls.");
    }
  }

  return { decision, reasons, notes, escalated: SEVERITY[decision] > SEVERITY[before] };
}
