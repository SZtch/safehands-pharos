// ─── SafeHands Decision Contract ──────────────────────────────
// The public, four-value decision the SafeHands returns. The internal policy
// engine keeps richer detail (reasons, checks, sub-status) for explanations,
// but only these four values are exposed as the public decision.
// ────────────────────────────────────────────────────────────────────────

export type GuardianDecision =
  | "ALLOW"
  | "BLOCK"
  | "REQUIRE_CONFIRMATION"
  | "PREPARE_ONLY";

export const GUARDIAN_DECISIONS: readonly GuardianDecision[] = [
  "ALLOW",
  "BLOCK",
  "REQUIRE_CONFIRMATION",
  "PREPARE_ONLY",
] as const;

export function isGuardianDecision(value: unknown): value is GuardianDecision {
  return typeof value === "string" && (GUARDIAN_DECISIONS as readonly string[]).includes(value);
}

export interface MapEngineDecisionOptions {
  /**
   * When false, an otherwise-ALLOW action is returned as PREPARE_ONLY because
   * this deployment cannot execute it (read-only / hosted mode, or execution
   * gated/disabled on the active network). The caller must execute externally.
   */
  executionAvailable?: boolean;
}

/**
 * Map an internal engine decision to the public four-value SafeHands contract.
 *
 *   ALLOW                 -> ALLOW  (or PREPARE_ONLY when execution is unavailable)
 *   BLOCK                 -> BLOCK
 *   WARN                  -> REQUIRE_CONFIRMATION
 *   REQUIRE_CONFIRMATION  -> REQUIRE_CONFIRMATION
 *   REQUIRE_TOKEN_REVIEW  -> REQUIRE_CONFIRMATION
 *   REQUIRE_FUNDING       -> PREPARE_ONLY
 *   (anything unknown)    -> REQUIRE_CONFIRMATION  (fail safe — never a silent ALLOW)
 */
export function mapEngineDecision(
  engineDecision: string,
  options: MapEngineDecisionOptions = {},
): GuardianDecision {
  const executionAvailable = options.executionAvailable ?? true;
  switch (engineDecision) {
    case "ALLOW":
      return executionAvailable ? "ALLOW" : "PREPARE_ONLY";
    case "BLOCK":
      return "BLOCK";
    case "WARN":
    case "REQUIRE_CONFIRMATION":
    case "REQUIRE_TOKEN_REVIEW":
      return "REQUIRE_CONFIRMATION";
    case "REQUIRE_FUNDING":
      return "PREPARE_ONLY";
    default:
      return "REQUIRE_CONFIRMATION";
  }
}
