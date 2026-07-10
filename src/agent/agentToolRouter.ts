// ─── SafeHands Agent — Tool Router (read-only) ────────────────
// Routes a classified intent to the right EXISTING capability: the Phase 3
// read-only route handlers (which wrap the Phase 2 analyzers). The router adds
// no decision logic of its own and has no execution path. Read-only by
// construction — it imports only read handlers and the policy snapshot.
// ────────────────────────────────────────────────────────────────────────

import {
  handleGuardianCheck,
  handleAnalyzeTx,
  handleAnalyzeContract,
  handleAnalyzeApproval,
  handleAnalyzeSafe,
  handleAnalyzeCalldata,
  handleAnalyzeX402,
} from "../api/routes.js";
import { explainPolicyResult } from "../lib/policy/actionPolicyEngine.js";
import type { ReadOnlyChainAccess, AnalyzerRiskLevel } from "../lib/analysis/index.js";
import type { GuardianDecision } from "../lib/guardian/decision.js";
import type { AgentIntent, AgentRequest } from "./agentIntentClassifier.js";
import type { GuardianPolicy } from "./agentPolicyResolver.js";

export interface RoutedResult {
  /** Which capability handled the intent. */
  tool: string;
  decision: GuardianDecision;
  riskLevel: AnalyzerRiskLevel;
  reasons: string[];
  warnings: string[];
  /** The primary analyzer's details (read-only) — used by the policy step. */
  primaryDetails: Record<string, unknown>;
  /** Raw handler output kept as evidence. */
  evidence: unknown;
  experimental?: boolean;
}

interface AnalyzerShape {
  decision: GuardianDecision;
  riskLevel: AnalyzerRiskLevel;
  reasons: string[];
  warnings: string[];
  details?: unknown;
  experimental?: boolean;
  analyzers?: Array<{ details?: unknown }>;
}

function fromAnalyzer(tool: string, r: AnalyzerShape): RoutedResult {
  const primaryDetails = (r.details ?? r.analyzers?.[0]?.details ?? {}) as Record<string, unknown>;
  return {
    tool,
    decision: r.decision,
    riskLevel: r.riskLevel,
    reasons: r.reasons ?? [],
    warnings: r.warnings ?? [],
    primaryDetails,
    evidence: r,
    experimental: r.experimental,
  };
}

export interface RouteOptions {
  access?: ReadOnlyChainAccess;
  policy?: GuardianPolicy;
}

/** Route a classified intent to its read-only handler. No execution. */
export async function routeIntent(intent: AgentIntent, req: AgentRequest, opts: RouteOptions = {}): Promise<RoutedResult> {
  const { access, policy } = opts;
  switch (intent) {
    case "tx_hash_check":
      return fromAnalyzer("analyze/tx", (await handleAnalyzeTx({ txHash: req.txHash, network: req.network, chainId: req.chainId }, access)) as AnalyzerShape);
    case "contract_check":
      return fromAnalyzer("analyze/contract", (await handleAnalyzeContract({ address: req.address ?? req.to, network: req.network, chainId: req.chainId }, access)) as AnalyzerShape);
    case "erc20_approval":
      return fromAnalyzer("analyze/approval", handleAnalyzeApproval({ data: req.data, token: req.token ?? req.to }) as AnalyzerShape);
    case "permit2_approval":
      // Permit2 approve(0x87517c45) is decoded by the calldata analyzer, not the
      // ERC-20 approve decoder (which only understands 0x095ea7b3).
      return fromAnalyzer("analyze/calldata", handleAnalyzeCalldata({ data: req.data, token: req.token ?? req.to }) as AnalyzerShape);
    case "safe_transaction":
      return fromAnalyzer("analyze/safe", (await handleAnalyzeSafe({ data: req.data })) as AnalyzerShape);
    case "x402_payment_request":
      return fromAnalyzer(
        "analyze/x402",
        handleAnalyzeX402({
          url: req.url,
          paymentAmountUsdc: req.paymentAmountUsdc,
          paymentTokenAddress: req.paymentTokenAddress,
          payTo: req.payTo,
          agentId: req.agentId,
          chainId: req.chainId,
        }) as AnalyzerShape,
      );
    case "native_transfer":
    case "raw_transaction_intent":
    case "unknown_contract_call":
      return fromAnalyzer(
        "guardian/check",
        (await handleGuardianCheck({ to: req.to, data: req.data, value: req.value, network: req.network, chainId: req.chainId }, access)) as AnalyzerShape,
      );
    case "policy_question":
      return {
        tool: "policy_snapshot",
        decision: "ALLOW",
        riskLevel: "LOW",
        reasons: ["Informational: current SafeHands policy snapshot (no action evaluated)."],
        warnings: [],
        primaryDetails: {},
        evidence: { policy: policy ?? null },
      };
    case "risk_explanation": {
      // Wire to the shared explain-risk logic (the same explainPolicyResult used by
      // the explain_risk skill) instead of a hardcoded string. No action is evaluated
      // here, so this is an informational ALLOW; the human-readable explanation is
      // produced by the real skill path. Pure + read-only — no execution.
      const explanation = explainPolicyResult({
        decision: "ALLOW",
        riskLevel: "LOW",
        safeToExecute: true,
        reasons: [],
        requiredActions: [],
        checks: [],
        environment: req.network ?? "pacific-mainnet",
        chainId: req.chainId ?? 1672,
        isMainnet: (req.network ?? "pacific-mainnet") === "pacific-mainnet",
      });
      return {
        tool: "explain_risk",
        decision: "ALLOW",
        riskLevel: "LOW",
        reasons: [explanation],
        warnings: [],
        primaryDetails: {},
        evidence: { question: req.text ?? null, explanation, source: "explain_risk" },
      };
    }
  }
}
