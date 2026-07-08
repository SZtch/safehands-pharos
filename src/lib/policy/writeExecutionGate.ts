// ─── SafeHands Write-Execution Gate ────────────────────────────────────
// Enforces the FULL deterministic decision at the direct write-tool boundary.
//
// Historically the raw write tools (execute_swap / send_payment / approve_token /
// x402_pay_and_fetch) only halted on `BLOCK` and silently signed on every other
// non-ALLOW decision — so a REQUIRE_CONFIRMATION / REQUIRE_TOKEN_REVIEW action
// (unverified recipient, unknown/flagged token) was auto-executed. That defeated
// the core SafeHands promise ("one of four decisions before every action").
//
// This gate makes the raw tools honor the whole decision:
//   • ALLOW                 → proceed.
//   • BLOCK                 → hard stop (never confirmable).
//   • REQUIRE_FUNDING       → hard stop (fund first; not a confirmable risk).
//   • REQUIRE_CONFIRMATION  → proceed ONLY if the caller passed an explicit
//     REQUIRE_TOKEN_REVIEW /   confirmation (`confirmed`); otherwise return a
//     WARN                     non-executing CONFIRMATION_REQUIRED with the
//                              reasons, so the confirmation is explicit + audited
//                              instead of silent.
// Honeypot/malicious tokens are turned into a hard BLOCK upstream (in the tool,
// before this gate) while GoPlus token intel is available. When intel is MISSING
// (provider outage / token not indexed / unresolvable address), the policy emits
// the `token_security_intel_missing` check and this gate fails closed (P0-2):
// a caller confirmation cannot substitute for intel that never existed, so the
// action stops with TOKEN_INTEL_UNAVAILABLE even with confirm=true. Only tokens
// GoPlus actually reviewed-and-flagged remain confirmable after review.
// ────────────────────────────────────────────────────────────────────────

import { fail, type ToolFailure } from "../toolResponse.js";
import type { ActionPolicyResult } from "./actionPolicyEngine.js";

export interface EnforceWriteDecisionOptions {
  /** True when the caller explicitly acknowledged/confirmed this action (e.g. input.confirm === true). */
  confirmed: boolean;
  /** Tool name for the error envelope + telemetry. */
  toolName: string;
}

/**
 * Returns a ToolFailure to short-circuit execution, or `null` to proceed.
 * `policy.decision` is the internal 6-value decision from evaluateActionPolicy
 * (NOT the mapped public 4-value), so all six cases are handled here.
 */
export function enforceWriteDecision(
  policy: ActionPolicyResult,
  opts: EnforceWriteDecisionOptions
): ToolFailure | null {
  const reasons = policy.reasons.join(" ").trim();
  const actions = policy.requiredActions.join(" ").trim();

  switch (policy.decision) {
    case "ALLOW":
      return null;

    case "BLOCK":
      return fail(
        "POLICY_BLOCKED",
        reasons || `${opts.toolName} was blocked by SafeHands policy.`,
        false,
        opts.toolName
      );

    case "REQUIRE_FUNDING":
      return fail(
        "REQUIRE_FUNDING",
        `${opts.toolName} requires funding before execution. ${reasons} ${actions}`.replace(/\s+/g, " ").trim(),
        false,
        opts.toolName
      );

    case "REQUIRE_CONFIRMATION":
    case "REQUIRE_TOKEN_REVIEW":
    case "WARN":
    default:
      // P0-2 fail-closed: when token-security intel is MISSING (not merely flagged),
      // nothing was reviewed — a caller confirmation cannot attest to a review that
      // never happened. Hard stop, never confirmable on the direct write path.
      if (policy.checks.some((c) => c.name === "token_security_intel_missing" && c.status === "unknown")) {
        return fail(
          "TOKEN_INTEL_UNAVAILABLE",
          `${opts.toolName} is blocked fail-closed: token-security intelligence is unavailable for this token (provider outage or token not yet indexed), so nothing was actually reviewed. Retry when the provider is reachable, or verify the token independently. ${reasons}`
            .replace(/\s+/g, " ")
            .trim(),
          true,
          opts.toolName
        );
      }
      if (opts.confirmed) return null;
      return fail(
        "CONFIRMATION_REQUIRED",
        `${opts.toolName} needs explicit confirmation before signing (decision: ${policy.decision}). ${reasons} ${actions} Re-invoke with confirm=true only after reviewing and approving this action.`
          .replace(/\s+/g, " ")
          .trim(),
        false,
        opts.toolName
      );
  }
}
