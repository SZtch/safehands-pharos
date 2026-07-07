// ─── SafeHands API — Agent Endpoints (read-only) ──────────────
// Real HTTP handlers that delegate to the EXISTING SafeHandsGuardianAgent. No
// decision logic is duplicated here, no static/demo output is returned — every
// response is the agent's real verdict. Kept in a separate file so `routes.ts`
// stays free of the agent import (the agent imports `routes.ts`).
// ────────────────────────────────────────────────────────────────────────

import { createGuardianAgent } from "../agent/index.js";
import type { AgentRequest, GuardianPolicy } from "../agent/index.js";
import type { ReadOnlyChainAccess } from "../lib/analysis/index.js";

/** Sanitized policy + preset resolved by the caller (server.ts) — tighten-only. */
export interface AgentRouteOptions {
  policy?: Partial<GuardianPolicy>;
  policyPreset?: string;
}

/** POST /agent/check — real SafeHands Agent decision for an intent payload. */
export async function handleAgentCheck(raw: unknown, access?: ReadOnlyChainAccess, opts: AgentRouteOptions = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Request body must be an object describing the action/intent.");
  }
  const agent = createGuardianAgent({ access, policy: opts.policy, policyPreset: opts.policyPreset });
  return agent.check(raw as AgentRequest);
}

interface A2ABody {
  callerAgent?: unknown;
  requestedAction?: AgentRequest;
  intent?: AgentRequest;
  action?: AgentRequest;
  policy?: Partial<GuardianPolicy>;
}

/**
 * POST /agent/a2a/check — real SafeHands Agent decision plus the caller's
 * obligation (ALLOW→proceed, BLOCK→stop, REQUIRE_CONFIRMATION→ask_user_or_admin,
 * PREPARE_ONLY→prepare_handoff_no_execute).
 */
export async function handleAgentA2ACheck(raw: unknown, access?: ReadOnlyChainAccess, opts: AgentRouteOptions = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Request body must be an object.");
  }
  const body = raw as A2ABody;
  if (typeof body.callerAgent !== "string" || body.callerAgent.length === 0) {
    throw new Error("callerAgent must be a non-empty string.");
  }
  const action = body.requestedAction ?? body.intent ?? body.action;
  if (action === undefined || action === null || typeof action !== "object" || Array.isArray(action)) {
    throw new Error("requestedAction (or intent) must be an object describing the action.");
  }
  // The caller policy is sanitized by the server (tighten-only) and passed via opts.
  const agent = createGuardianAgent({ owner: "agent", policy: opts.policy, policyPreset: opts.policyPreset, access });
  return agent.checkForAgent(body.callerAgent, action as AgentRequest);
}
