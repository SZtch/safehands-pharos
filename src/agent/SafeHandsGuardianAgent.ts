// ─── SafeHands Agent (read-only) ──────────────────────────────
// The complete pre-execution SafeHands Agent. It ORCHESTRATES existing
// capabilities — Phase 1 decision contract, Phase 2 analyzers, Phase 3 read-only
// handlers — and adds intent classification, policy enforcement, decision
// formatting, and the Agent-to-Agent obligation contract.
//
// It holds NO private keys, NO wallet, NO signer. There is no code path to sign,
// send, approve, swap, create/load a wallet, or publish. Read-only by
// construction; execution is disabled by default.
// ────────────────────────────────────────────────────────────────────────

import { isExecutionAvailable } from "../lib/config.js";
import type { ReadOnlyChainAccess } from "../lib/analysis/index.js";
import { classifyIntent, type AgentRequest, type IntentResult } from "./agentIntentClassifier.js";
import { resolvePolicy, applyPolicy, type GuardianPolicy, type PolicyOwner } from "./agentPolicyResolver.js";
import { routeIntent } from "./agentToolRouter.js";
import { formatDecision, type AgentDecision } from "./agentDecisionFormatter.js";
import { obligationFor, type CallerObligation } from "./agentRuntime.js";
import { enrich } from "./agentEnrich.js";
import { isDenylistedRecipient } from "../lib/recipientSafety.js";
import { handleSafeHandsSafeExecute } from "../tools/safehandsSafeExecute.js";
import { POLICY_VERSION } from "../lib/policy/policyPresets.js";

export interface GuardianAgentOptions {
  /** Policy overrides merged onto the owner baseline. */
  policy?: Partial<GuardianPolicy>;
  /** Policy owner (backend = public default). */
  owner?: PolicyOwner;
  /** Applied policy preset name — surfaced in the decision; never weakens. */
  policyPreset?: string;
  /** Optional read-only chain access (getCode/estimateGas/...). Omitted offline. */
  access?: ReadOnlyChainAccess;
}

export interface AgentToAgentDecision extends AgentDecision {
  caller: { id: string; obligation: CallerObligation; responsibility: string };
}

export class SafeHandsGuardianAgent {
  private readonly policy: GuardianPolicy;
  private readonly access?: ReadOnlyChainAccess;
  private readonly owner: PolicyOwner;
  private readonly policyPreset?: string;

  constructor(opts: GuardianAgentOptions = {}) {
    this.owner = opts.owner ?? "backend";
    this.policy = resolvePolicy(this.owner, opts.policy);
    this.access = opts.access;
    this.policyPreset = opts.policyPreset;
  }

  getPolicy(): GuardianPolicy {
    return this.policy;
  }

  /** Classify only (no routing) — useful for diagnostics and tests. */
  classify(req: AgentRequest): IntentResult {
    return classifyIntent(req);
  }

  /** Full read-only SafeHands check: classify → route → policy → format. */
  async check(req: AgentRequest): Promise<AgentDecision> {
    const { intent } = classifyIntent(req);
    try {
      const routed = await routeIntent(intent, req, { access: this.access, policy: this.policy });
      const enrichment = await enrich(req);
      const policyOutcome = applyPolicy({
        base: routed.decision,
        intent,
        req,
        policy: this.policy,
        analyzerDetails: routed.primaryDetails,
      });
      const decision = formatDecision({ intent, req, routed, policyOutcome, executionAvailable: isExecutionAvailable(), policyPreset: this.policyPreset, enrichment });
      // Recipient denylist — escalate-only hard block (only tightens, never weakens).
      if (decision.decision !== "BLOCK" && isDenylistedRecipient(req.to)) {
        return {
          ...decision,
          decision: "BLOCK",
          riskLevel: "CRITICAL",
          summary: `SafeHands → BLOCK: recipient ${req.to} is on the operator denylist (known-bad address).`,
          reasons: ["Recipient is on the operator denylist (known-bad address).", ...decision.reasons],
          recommendedAction: "Do not send to this address — it is flagged as known-bad by the operator.",
          callerObligation: obligationFor("BLOCK").obligation,
        };
      }
      return decision;
    } catch (err) {
      // Fail safe — invalid/un-analyzable input never yields a silent ALLOW.
      const message = err instanceof Error ? err.message : String(err);
      return {
        intent,
        decision: "REQUIRE_CONFIRMATION",
        riskLevel: "UNKNOWN",
        summary: `SafeHands → REQUIRE_CONFIRMATION for ${intent.replace(/_/g, " ")}. Input could not be analyzed.`,
        reasons: [`Input could not be analyzed (validation/decoding failed): ${message}`],
        recommendedAction: "Obtain explicit user/admin confirmation before any execution.",
        evidence: { error: message },
        readOnly: true,
        executionAvailable: isExecutionAvailable(),
        nextStep: "Pause and request explicit confirmation; correct the malformed input.",
        callerObligation: obligationFor("REQUIRE_CONFIRMATION").obligation,
        tool: "validation",
        policyPreset: this.policyPreset ?? null,
        policyVersion: POLICY_VERSION,
      };
    }
  }

  /** Agent-to-Agent entry: returns the verdict plus the caller's obligation. */
  async checkForAgent(callerId: string, req: AgentRequest): Promise<AgentToAgentDecision> {
    const result = await this.check(req);
    const spec = obligationFor(result.decision);
    return { ...result, caller: { id: callerId, obligation: spec.obligation, responsibility: spec.responsibility } };
  }

}

/** Convenience factory. */
export function createGuardianAgent(opts?: GuardianAgentOptions): SafeHandsGuardianAgent {
  return new SafeHandsGuardianAgent(opts);
}
