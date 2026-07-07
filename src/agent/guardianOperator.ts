// ─── SafeHands Operator ───────────────────────────────────────
// The "Complete Agent" for the Pharos Agent Arena. It wraps the read-only
// SafeHands Agent and runs the full lifecycle:
//
//   Perceive → Enrich → Decide → (gated) Act → Attest → Report
//
// - The read-only verdict (Perceive/Enrich/Decide) never signs or writes.
// - Act is OPT-IN and DELEGATED to the existing gated execution path
//   (`safehands_safe_execute`), which enforces WRITE_TOOLS_ENABLED, the network
//   executionAllowed flag, managed-wallet authorization, funding, and re-runs
//   preflight. The Operator never bypasses a gate and holds no keys itself.
// - The user-signed broadcast path attests every executed action on-chain to
//   SafeHandsAttestation ("if SafeHands broadcasts it, SafeHands attests it").
// ────────────────────────────────────────────────────────────────────────

import { SafeHandsGuardianAgent, type GuardianAgentOptions } from "./SafeHandsGuardianAgent.js";
import type { AgentRequest } from "./agentIntentClassifier.js";
import type { AgentDecision } from "./agentDecisionFormatter.js";
import { enrich, type Enrichment } from "./agentEnrich.js";
import { handleSafeHandsSafeExecute, type SafeHandsSafeExecuteInput } from "../tools/safehandsSafeExecute.js";

export interface EnrichedDecision extends AgentDecision {
  enrichment: Enrichment;
}

export interface OperateOptions {
  /** Caller must explicitly opt in to execution (default: assess-only). */
  execute?: boolean;
  /** Which gated safe-execute path to run when executing. */
  executePath?: SafeHandsSafeExecuteInput["path"];
  /** Underlying tool input for the execution. */
  action?: Record<string, unknown>;
}

export interface OperateResult {
  decision: EnrichedDecision;
  executed: boolean;
  /** Raw result of the gated execution (when attempted). */
  executionResult?: unknown;
  /** The Agent-to-Agent obligation derived from the decision. */
  obligation: string;
  report: string;
}

export class GuardianOperator {
  private readonly agent: SafeHandsGuardianAgent;

  constructor(opts?: GuardianAgentOptions) {
    this.agent = new SafeHandsGuardianAgent(opts);
  }

  /** Read-only: the SafeHands verdict enriched with real on-chain + gas intel. */
  async assess(req: AgentRequest): Promise<EnrichedDecision> {
    const decision = await this.agent.check(req);
    const enrichment = await enrich(req);
    const evidence = { ...(decision.evidence as Record<string, unknown>), enrichment };
    return { ...decision, evidence, enrichment };
  }

  /** Full lifecycle. Executes only on ALLOW + explicit opt-in, via the gated path. */
  async operate(req: AgentRequest, opts: OperateOptions = {}): Promise<OperateResult> {
    const decision = await this.assess(req);
    const obligation = decision.callerObligation;

    if (!opts.execute || decision.decision !== "ALLOW" || !opts.executePath) {
      return {
        decision,
        executed: false,
        obligation,
        report: `${decision.summary} — caller obligation: ${obligation}. ${decision.nextStep}`,
      };
    }

    // Delegate to the gated execution path (enforces every safety gate + attests).
    const executionResult = await handleSafeHandsSafeExecute({
      path: opts.executePath,
      execute: true,
      confirmExecution: true,
      action: opts.action ?? {},
    });

    const executed =
      executionResult.success === true &&
      (executionResult.data as { executed?: boolean } | null)?.executed === true;

    return {
      decision,
      executed,
      executionResult,
      obligation,
      report: executed
        ? `Executed verified action via gated path; attested on-chain when broadcast. ${decision.summary}`
        : `Execution gated/not completed — verdict ALLOW but a gate or runtime check stopped it. ${decision.summary}`,
    };
  }
}

export function createGuardianOperator(opts?: GuardianAgentOptions): GuardianOperator {
  return new GuardianOperator(opts);
}
