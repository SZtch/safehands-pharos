// ─── SafeHands Agent — Intent Classifier (read-only) ──────────
// Deterministic, offline classification of a user/agent request into one of the
// supported SafeHands intents. Pure: no RPC, no keys, no side effects. The
// classifier only *labels* a request — it never executes anything.
// ────────────────────────────────────────────────────────────────────────

import { APPROVE_SELECTOR } from "../lib/analysis/approval.js";
import { MULTISEND_SELECTOR, SAFE_EXEC_SELECTOR } from "../lib/analysis/safeTx.js";

/** Canonical Permit2 singleton (lowercased). */
export const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";
/** Permit2.approve(token,spender,amount,expiration) selector. */
const PERMIT2_APPROVE_SELECTOR = "0x87517c45";

export type AgentIntent =
  | "tx_hash_check"
  | "contract_check"
  | "raw_transaction_intent"
  | "erc20_approval"
  | "permit2_approval"
  | "safe_transaction"
  | "x402_payment_request"
  | "native_transfer"
  | "unknown_contract_call"
  | "policy_question"
  | "risk_explanation";

/** A request to the SafeHands Agent. Every field optional — the agent decides. */
export interface AgentRequest {
  /** Free-text question (used for policy/risk-explanation intents). */
  text?: string;
  /** Transaction target. */
  to?: string;
  /** Calldata, e.g. 0x095ea7b3… */
  data?: string;
  /** Value in wei (decimal or 0x-hex string). */
  value?: string;
  /** Existing transaction hash to inspect. */
  txHash?: string;
  /** Explicit contract address to vet (contract_check). */
  address?: string;
  /** Token contract an approval targets. */
  token?: string;
  /** x402 resource URL. */
  url?: string;
  paymentAmountUsdc?: string;
  paymentTokenAddress?: string;
  payTo?: string;
  agentId?: string;
  network?: string;
  chainId?: number;
  /** Optional ecosystem provider hint (e.g. "LayerZero") — evidence only. */
  provider?: string;
  /** Optional ecosystem category hint (e.g. "cross_chain") — evidence only. */
  ecosystemCategory?: string;
  /** Optional explicit override of the classification. */
  inputType?: AgentIntent;
}

export interface IntentResult {
  intent: AgentIntent;
  /** 0..1 — 1.0 for unambiguous structural matches, lower for text heuristics. */
  confidence: number;
  /** Human-readable signals that led to the classification. */
  signals: string[];
}

function selectorOf(data?: string): string | null {
  if (!data || !data.startsWith("0x") || data.length < 10) return null;
  return data.slice(0, 10).toLowerCase();
}

function valuePositive(value?: string): boolean {
  if (value === undefined) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

/** Classify a request into a SafeHands intent. Deterministic and offline. */
export function classifyIntent(req: AgentRequest): IntentResult {
  if (req.inputType) {
    return { intent: req.inputType, confidence: 1, signals: ["explicit inputType override"] };
  }

  const selector = selectorOf(req.data);
  const hasValue = valuePositive(req.value);
  const lowerTo = (req.to ?? req.token ?? "").toLowerCase();

  if (req.txHash) {
    return { intent: "tx_hash_check", confidence: 1, signals: ["txHash present"] };
  }

  if (req.url || req.paymentAmountUsdc !== undefined) {
    return { intent: "x402_payment_request", confidence: 1, signals: ["x402 url/payment fields present"] };
  }

  if (selector) {
    if (selector === APPROVE_SELECTOR || selector === PERMIT2_APPROVE_SELECTOR) {
      if (selector === PERMIT2_APPROVE_SELECTOR || lowerTo === PERMIT2_ADDRESS) {
        return { intent: "permit2_approval", confidence: 1, signals: ["Permit2 approval selector/target"] };
      }
      return { intent: "erc20_approval", confidence: 1, signals: ["ERC-20 approve selector"] };
    }
    if (selector === MULTISEND_SELECTOR || selector === SAFE_EXEC_SELECTOR) {
      return { intent: "safe_transaction", confidence: 1, signals: ["Safe/MultiSend selector"] };
    }
    return {
      intent: hasValue ? "raw_transaction_intent" : "unknown_contract_call",
      confidence: 0.9,
      signals: [hasValue ? "value-bearing call with unrecognized selector" : "unrecognized calldata selector"],
    };
  }

  if (hasValue) {
    return { intent: "native_transfer", confidence: 1, signals: ["positive value, no calldata"] };
  }

  if (req.address && !req.to) {
    return { intent: "contract_check", confidence: 1, signals: ["explicit contract address"] };
  }

  const text = (req.text ?? "").toLowerCase();
  if (text) {
    if (/\bpolic(y|ies)\b|\blimit\b|\ballow ?list\b|\btrusted\b/.test(text)) {
      return { intent: "policy_question", confidence: 0.7, signals: ["policy keywords in text"] };
    }
    if (/\bexplain\b|\bwhy\b|\bwhat does\b|\brisk\b|\bmean(s)?\b/.test(text)) {
      return { intent: "risk_explanation", confidence: 0.7, signals: ["explanation keywords in text"] };
    }
  }

  if (req.to) {
    return { intent: "unknown_contract_call", confidence: 0.6, signals: ["target present, intent ambiguous"] };
  }

  return { intent: "unknown_contract_call", confidence: 0.3, signals: ["no actionable fields"] };
}
