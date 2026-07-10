// ─── SafeHands Agent — Runtime & Agent-to-Agent Contract ──────
// The A2A obligation contract: what a CALLING agent must do given a SafeHands
// decision. SafeHands only advises — it never executes. The caller is solely
// responsible for honoring the obligation. Leaf module: no value imports from
// the agent/formatter (keeps the module graph acyclic).
// ────────────────────────────────────────────────────────────────────────

import type { GuardianDecision } from "../lib/guardian/decision.js";

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

// NOTE: the former describeObligation / GuardianAgentLike / runScenario exports
// were removed as dead code — no consumer in src/, test/, or scripts/ used them.
