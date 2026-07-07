// ─── SafeHands Agent — Decision Formatter (read-only) ─────────
// Shapes the final AgentDecision from the routed analyzer output + policy
// outcome. Applies the PREPARE_ONLY rule (an ALLOW execution-intent becomes
// PREPARE_ONLY when execution is unavailable — the default) and derives the
// caller obligation, recommended action, and next step. Pure: no execution.
// ────────────────────────────────────────────────────────────────────────

import type { GuardianDecision } from "../lib/guardian/decision.js";
import type { AnalyzerRiskLevel } from "../lib/analysis/index.js";
import { tokenRegistryEvidence } from "../lib/analysis/pharosTokens.js";
import { rpcEvidence, gasEvidence } from "../lib/pharos/rpcEvidence.js";
import { ecosystemEvidenceForRequest, applyEcosystemEscalation } from "../lib/pharos/ecosystemEvidence.js";
import { getActiveNetwork } from "../lib/networks.js";
import type { AgentIntent, AgentRequest } from "./agentIntentClassifier.js";
import type { RoutedResult } from "./agentToolRouter.js";
import type { PolicyOutcome } from "./agentPolicyResolver.js";
import { obligationFor, type CallerObligation } from "./agentRuntime.js";
import { POLICY_VERSION } from "../lib/policy/policyPresets.js";

export interface AgentDecision {
  intent: AgentIntent;
  /** Public four-value SafeHands decision. */
  decision: GuardianDecision;
  riskLevel: AnalyzerRiskLevel;
  summary: string;
  reasons: string[];
  recommendedAction: string;
  /** Raw analyzer/handler output + any supporting evidence. */
  evidence: unknown;
  /** Always true — the agent never writes, signs, sends, or publishes. */
  readOnly: true;
  /** False by default (mainnet execution disabled + gates off). */
  executionAvailable: boolean;
  nextStep: string;
  callerObligation: CallerObligation;
  /** Which capability produced the verdict. */
  tool: string;
  /** The applied policy preset — or null when none was selected. */
  policyPreset: string | null;
  /** Policy semantics version — surfaced, never secret. */
  policyVersion: string;
  experimental?: boolean;
}

/** Intents that represent an action the caller intends to EXECUTE. */
const EXECUTION_INTENTS: ReadonlySet<AgentIntent> = new Set<AgentIntent>([
  "native_transfer",
  "raw_transaction_intent",
  "unknown_contract_call",
  "erc20_approval",
  "permit2_approval",
  "safe_transaction",
  "x402_payment_request",
]);

const RECOMMENDED: Record<GuardianDecision, string> = {
  ALLOW: "Proceed — no blocking risk found. SafeHands does not execute; the caller executes externally.",
  BLOCK: "Do not execute — the action is unsafe and must be aborted.",
  REQUIRE_CONFIRMATION: "Obtain explicit user/admin confirmation before any execution.",
  PREPARE_ONLY: "Prepare or hand off only — execution is disabled here; do not execute.",
};

const NEXT_STEP: Record<GuardianDecision, string> = {
  ALLOW: "Execute externally with your own signer (SafeHands holds no keys).",
  BLOCK: "Abort the action and surface the block reason to the user/agent.",
  REQUIRE_CONFIRMATION: "Pause and request explicit confirmation from the user or admin.",
  PREPARE_ONLY: "Return a prepared/handoff action for external execution; do not execute here.",
};

export interface FormatArgs {
  intent: AgentIntent;
  req: AgentRequest;
  routed: RoutedResult;
  policyOutcome: PolicyOutcome;
  executionAvailable: boolean;
  /** The applied policy preset name. */
  policyPreset?: string;
  /** The real market/security/chain evidence from the Enrich step. */
  enrichment?: any;
}

export function formatDecision(args: FormatArgs): AgentDecision {
  const { intent, req, routed, policyOutcome, executionAvailable, enrichment } = args;

  let decision = policyOutcome.decision;
  const reasons = [...routed.reasons, ...policyOutcome.reasons, ...policyOutcome.notes];

  // Ecosystem awareness: classify the target/intent against the Pharos ecosystem
  // registry. ESCALATE-ONLY — cross-chain / WASM-interop intents become
  // REQUIRE_CONFIRMATION; ecosystem evidence NEVER relaxes a decision or makes a
  // risky action safe (a BLOCK stays a BLOCK).
  const ecosystemEvidence = ecosystemEvidenceForRequest(req);
  const escalated = applyEcosystemEscalation(decision, ecosystemEvidence);
  if (escalated !== decision) {
    decision = escalated;
    reasons.push(`Ecosystem awareness (${ecosystemEvidence.category}): ${ecosystemEvidence.safehandsBehavior}`);
  }

  // PREPARE_ONLY: a safe execution-intent the caller cannot execute here.
  if (decision === "ALLOW" && !executionAvailable && EXECUTION_INTENTS.has(intent)) {
    decision = "PREPARE_ONLY";
    reasons.push("Action is safe but execution is disabled by default — prepare-only (no execution here).");
  }

  // Optional supporting evidence: token-registry status for token-bearing intents,
  // plus read-only RPC + gas capability evidence (deterministic, secret-free).
  const evidence: Record<string, unknown> = { analyzer: routed.evidence };
  const tokenRef = req.token ?? (intent === "contract_check" ? req.address ?? req.to : undefined);
  if (tokenRef) {
    try {
      evidence.tokenRegistry = tokenRegistryEvidence(tokenRef, getActiveNetwork());
    } catch {
      /* evidence is best-effort */
    }
  }
  evidence.rpcEvidence = rpcEvidence(getActiveNetwork());
  evidence.gasEvidence = gasEvidence();
  evidence.ecosystemEvidence = ecosystemEvidence;
  if (enrichment) evidence.enrichment = enrichment;

  const summary = buildSummary(intent, decision, routed, reasons);

  return {
    intent,
    decision,
    riskLevel: routed.riskLevel,
    summary,
    reasons,
    recommendedAction: RECOMMENDED[decision],
    evidence,
    readOnly: true,
    executionAvailable,
    nextStep: NEXT_STEP[decision],
    callerObligation: obligationFor(decision).obligation,
    tool: routed.tool,
    policyPreset: args.policyPreset ?? null,
    policyVersion: POLICY_VERSION,
    experimental: routed.experimental,
  };
}

function buildSummary(intent: AgentIntent, decision: GuardianDecision, routed: RoutedResult, reasons: string[]): string {
  const head = `SafeHands → ${decision} for ${intent.replace(/_/g, " ")}`;
  const why = reasons[0] ?? routed.reasons[0] ?? "No additional detail.";
  const exp = routed.experimental ? " (experimental decode)" : "";
  return `${head}${exp}. ${why}`;
}
