// ─── SafeHands Policy Presets ─────────────────────────────────────
// Named presets are `GuardianPolicy` configs fed to the EXISTING escalate-only
// `applyPolicy` (agentPolicyResolver) — so no preset or request can ever weaken
// the analyzer's decision (a BLOCK stays a BLOCK by construction). On top of that
// structural guarantee:
//   • every preset is equal-or-stricter than `standard` (assertNotWeaker, tested),
//   • preset resolution is TIGHTEN-ONLY (a request may only pick an equal/stricter
//     preset than the server default),
//   • `sanitizeRequestPolicy` clamps request overrides to tighten-only and drops
//     request-supplied trusted lists (public callers can never add a bypass).
// Pure + offline. No signing/wallet/write primitives.
// ────────────────────────────────────────────────────────────────────────

import { DEFAULT_BACKEND_POLICY, type GuardianPolicy } from "../../agent/agentPolicyResolver.js";

export type PolicyPreset = "standard" | "strict" | "agent" | "x402-preflight";

export const PRESET_NAMES: readonly PolicyPreset[] = ["standard", "strict", "agent", "x402-preflight"];

/** Bump when preset semantics change. Surfaced (never secret) in responses/metrics. */
export const POLICY_VERSION = "p8c-2026.06";

const NUMERIC_KEYS = [
  "maxNativeTransferWei",
  "maxApprovalAmount",
  "maxX402PaymentUsdc",
  "maxDailyAgentSpendUsdc",
] as const;

export const PRESETS: Readonly<Record<PolicyPreset, GuardianPolicy>> = {
  // standard = the current public default (no change in behavior).
  standard: { ...DEFAULT_BACKEND_POLICY },
  // strict = much lower limits; always confirm/block the risky cases.
  strict: {
    maxNativeTransferWei: "1000000000000000000", // 1 native
    maxApprovalAmount: "1000000000", // 1e9 raw units
    maxX402PaymentUsdc: "0.1",
    maxDailyAgentSpendUsdc: "10",
    trustedRecipients: [],
    trustedSpenders: [],
    blockUnlimitedApproval: true,
    requireConfirmationForUnknownContract: true,
  },
  // agent = the A2A/agent runtime baseline — equal-or-stricter than standard.
  agent: {
    ...DEFAULT_BACKEND_POLICY,
    maxX402PaymentUsdc: "0.5",
    maxDailyAgentSpendUsdc: "50",
    trustedRecipients: [],
    trustedSpenders: [],
    blockUnlimitedApproval: true,
    requireConfirmationForUnknownContract: true,
  },
  // x402-preflight = payment-intent focused tightening; still read-only.
  "x402-preflight": {
    ...DEFAULT_BACKEND_POLICY,
    maxX402PaymentUsdc: "0.1",
    blockUnlimitedApproval: true,
    requireConfirmationForUnknownContract: true,
  },
};

export function isPreset(value: unknown): value is PolicyPreset {
  return typeof value === "string" && (PRESET_NAMES as readonly string[]).includes(value);
}

export function presetPolicy(name: PolicyPreset): GuardianPolicy {
  const p = PRESETS[name];
  return { ...p, trustedRecipients: [...p.trustedRecipients], trustedSpenders: [...p.trustedSpenders] };
}

/**
 * True iff `candidate` is equal-or-stricter than `baseline`: every numeric limit
 * is ≤ baseline, the safety booleans are not weaker, and it adds no extra trusted
 * entries. Used both at load (presets vs `standard`) and at request resolution.
 */
export function assertNotWeaker(candidate: GuardianPolicy, baseline: GuardianPolicy): boolean {
  for (const k of NUMERIC_KEYS) {
    if (Number(candidate[k]) > Number(baseline[k])) return false;
  }
  if (baseline.blockUnlimitedApproval && !candidate.blockUnlimitedApproval) return false;
  if (baseline.requireConfirmationForUnknownContract && !candidate.requireConfirmationForUnknownContract) return false;
  if (candidate.trustedRecipients.length > baseline.trustedRecipients.length) return false;
  if (candidate.trustedSpenders.length > baseline.trustedSpenders.length) return false;
  return true;
}

/**
 * Resolve the effective preset NAME (tighten-only). Precedence:
 *   serverDefault = env (SAFEHANDS_POLICY_PRESET) → endpointDefault → "standard".
 * A request preset is honored only if it is a valid preset that is equal-or-stricter
 * than the server default; otherwise the server default wins (a request can never
 * loosen policy).
 */
export function resolvePresetName(
  requestPreset: unknown,
  endpointDefault: PolicyPreset = "standard",
  envPreset?: string,
): PolicyPreset {
  const serverDefault: PolicyPreset = isPreset(envPreset) ? envPreset : endpointDefault;
  if (isPreset(requestPreset) && assertNotWeaker(PRESETS[requestPreset], PRESETS[serverDefault])) {
    return requestPreset;
  }
  return serverDefault;
}

/**
 * Sanitize request-supplied policy overrides onto a server policy: TIGHTEN-ONLY.
 * Numeric limits may only be lowered; safety booleans may only be set toward safer
 * (true); request-supplied trusted lists are IGNORED (server-config only) so public
 * callers can never add an approval/transfer bypass.
 */
export function sanitizeRequestPolicy(serverPolicy: GuardianPolicy, overrides: unknown): GuardianPolicy {
  const out: GuardianPolicy = {
    ...serverPolicy,
    trustedRecipients: [...serverPolicy.trustedRecipients],
    trustedSpenders: [...serverPolicy.trustedSpenders],
  };
  if (!overrides || typeof overrides !== "object") return out;
  const o = overrides as Record<string, unknown>;
  for (const k of NUMERIC_KEYS) {
    const raw = o[k];
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n < Number(out[k])) {
      out[k] = typeof raw === "string" ? raw : String(n);
    }
  }
  if (o.blockUnlimitedApproval === true) out.blockUnlimitedApproval = true;
  if (o.requireConfirmationForUnknownContract === true) out.requireConfirmationForUnknownContract = true;
  return out;
}
