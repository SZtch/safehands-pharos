// ─── API Key Scopes ──────────────────────────────────────────────
// Scope vocabulary for the optional API-key access-control layer. Scopes are
// identity/access-control only — never payment. `future:*` scopes are DEFINED
// here for forward-compatibility but are NOT granted by default and have NO live
// endpoint behind scoped API keys. Pure constants + helpers; no I/O, no secrets.
// ────────────────────────────────────────────────────────────────────────

export type Scope =
  | "guardian:check"
  | "agent:check"
  | "a2a:check"
  | "analyze:read"
  | "activity:read"
  | "metrics:read"
  | "prepare:tx"
  | "wallet:prepare"
  | "broadcast:signed"
  | "future:attest"
  | "future:premium";

export const ALL_SCOPES: readonly Scope[] = [
  "guardian:check",
  "agent:check",
  "a2a:check",
  "analyze:read",
  "activity:read",
  "metrics:read",
  "prepare:tx",
  "wallet:prepare",
  "broadcast:signed",
  "future:attest",
  "future:premium",
];

/** Default read bundle a bare API key receives (backward-compatible). No future:* scopes.
 *  `prepare:tx` and `wallet:prepare` are read-only (build UNSIGNED / wallet-ready requests
 *  only — never sign or broadcast). */
export const DEFAULT_READ_SCOPES: readonly Scope[] = [
  "guardian:check",
  "agent:check",
  "a2a:check",
  "analyze:read",
  "activity:read",
  "metrics:read",
  "prepare:tx",
  "wallet:prepare",
];

/** Reserved future scopes — defined only; never granted by default; no live endpoint. */
export const FUTURE_SCOPES: readonly Scope[] = ["future:attest", "future:premium"];

/** Endpoint path → the scope it requires (only enforced in require-key mode). */
export const ENDPOINT_SCOPES: Readonly<Record<string, Scope>> = {
  "/guardian/check": "guardian:check",
  "/prepare/tx": "prepare:tx",
  "/wallet/prepare": "wallet:prepare",
  "/broadcast/signed": "broadcast:signed",
  "/agent/check": "agent:check",
  "/agent/a2a/check": "a2a:check",
  "/analyze/tx": "analyze:read",
  "/analyze/contract": "analyze:read",
  "/analyze/approval": "analyze:read",
  "/analyze/safe": "analyze:read",
  "/analyze/x402": "analyze:read",
  "/activity/summary": "activity:read",
  "/activity/recent": "activity:read",
  "/metrics/public": "metrics:read",
  "/infra/status": "metrics:read",
  "/public-config": "metrics:read",
};

export function isScope(value: string): value is Scope {
  return (ALL_SCOPES as readonly string[]).includes(value);
}

/** The required scope for a path, or null if the path has no scope mapping. */
export function scopeForPath(path: string): Scope | null {
  return ENDPOINT_SCOPES[path] ?? null;
}

export function hasScope(scopes: ReadonlySet<Scope> | null | undefined, scope: Scope): boolean {
  return scopes != null && scopes.has(scope);
}

/**
 * Parse a `scopeA|scopeB` string into a Set of known scopes. Unknown tokens are
 * dropped (fail-closed: an unrecognized scope grants nothing).
 */
export function parseScopes(raw: string): Set<Scope> {
  const out = new Set<Scope>();
  for (const token of raw.split("|")) {
    const t = token.trim();
    if (t && isScope(t)) out.add(t);
  }
  return out;
}
