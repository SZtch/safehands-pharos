// ─── SafeHands Agent — Runtime & Agent-to-Agent Contract ──────
// The A2A obligation contract: what a CALLING agent must do given a SafeHands
// decision. SafeHands only advises — it never executes. The caller is solely
// responsible for honoring the obligation. Leaf module: no value imports from
// the agent/formatter (keeps the module graph acyclic).
// ────────────────────────────────────────────────────────────────────────

import type { GuardianDecision } from "../lib/guardian/decision.js";
import type { AgentRequest } from "./agentIntentClassifier.js";
import type { AgentDecision } from "./agentDecisionFormatter.js";

/** What the calling agent is obligated to do. */
export type CallerObligation =
  | "proceed"
  | "stop"
  | "ask_user_or_admin"
  | "prepare_handoff_no_execute";

export interface ObligationSpec {
  obligation: CallerObligation;
  /** One-line caller responsibility. */
  responsibility: string;
}

/** The public Agent-to-Agent contract, keyed by SafeHands decision. */
export const OBLIGATION_CONTRACT: Record<GuardianDecision, ObligationSpec> = {
  ALLOW: {
    obligation: "proceed",
    responsibility: "Caller MAY proceed. SafeHands found no blocking risk; the caller still executes externally.",
  },
  BLOCK: {
    obligation: "stop",
    responsibility: "Caller MUST stop. The action is unsafe and must not be executed.",
  },
  REQUIRE_CONFIRMATION: {
    obligation: "ask_user_or_admin",
    responsibility: "Caller MUST pause and obtain explicit user/admin confirmation before any execution.",
  },
  PREPARE_ONLY: {
    obligation: "prepare_handoff_no_execute",
    responsibility: "Caller MUST NOT execute. It may only prepare/hand off the action; execution is disabled here.",
  },
};

export function obligationFor(decision: GuardianDecision): ObligationSpec {
  return OBLIGATION_CONTRACT[decision];
}

export function describeObligation(decision: GuardianDecision): string {
  const spec = obligationFor(decision);
  return `${decision} → ${spec.obligation}: ${spec.responsibility}`;
}

/** Minimal structural view of the agent — avoids a value import (no cycle). */
export interface GuardianAgentLike {
  check(req: AgentRequest): Promise<AgentDecision>;
}

/**
 * Run a single named scenario against a SafeHands Agent and print a compact,
 * read-only verdict. Returns the AgentDecision so demos can assert on it.
 */
export async function runScenario(
  agent: GuardianAgentLike,
  name: string,
  req: AgentRequest,
): Promise<AgentDecision> {
  const result = await agent.check(req);
  const icon =
    result.decision === "ALLOW" ? "✅" :
    result.decision === "BLOCK" ? "⛔" :
    result.decision === "PREPARE_ONLY" ? "📋" : "⚠️";
  console.log(`\n${icon} [${name}] intent=${result.intent} decision=${result.decision} risk=${result.riskLevel}`);
  console.log(`   summary: ${result.summary}`);
  console.log(`   caller obligation: ${result.callerObligation} — ${describeObligation(result.decision).split("→")[1].trim()}`);
  console.log(`   nextStep: ${result.nextStep}`);
  console.log(`   readOnly=${result.readOnly} executionAvailable=${result.executionAvailable}`);
  return result;
}
