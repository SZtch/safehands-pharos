// ─── API Key Foundation (optional, access-control only) ────────────────
// Optional identity / rate-limit / access-control foundation. NOT a payment
// mechanism — paid endpoints use x402 gating (api/x402Gate.ts, env-gated via
// X402_PAY_TO + X402_FACILITATOR_URL). The public read API stays OPEN by default.
//
// Behavior:
//   • SAFEHANDS_API_KEYS unset/empty  ⇒ open; anonymous allowed everywhere.
//   • Keys are hashed (sha256) at load; raw keys are never stored or returned.
//     A request references its key only by `keyId` (hash prefix) in logs/activity.
//   • SAFEHANDS_REQUIRE_API_KEY=true (only meaningful when keys are configured)
//     gates the non-public endpoints; truly public endpoints stay open.
//   • Supplying an INVALID key is always an error (401), anywhere except /health.
// Pure + offline. No signing/wallet/write primitives.
// ────────────────────────────────────────────────────────────────────────

import { createHash, timingSafeEqual } from "node:crypto";
import { DEFAULT_READ_SCOPES, parseScopes, scopeForPath, hasScope, type Scope } from "./scopes.js";

export interface ApiKeyConfig {
  /** At least one key configured via SAFEHANDS_API_KEYS. */
  configured: boolean;
  /** Gate non-public endpoints (only when configured). */
  required: boolean;
  /** Public read API open by default (SAFEHANDS_PUBLIC_READ_ENABLED !== "false"). */
  publicReadEnabled: boolean;
  /** keyId (hash prefix) → full sha256 hex. Never the raw key. */
  hashes: Map<string, string>;
  /** keyId → granted scopes. Bare keys receive the default read bundle. */
  scopes: Map<string, Set<Scope>>;
}

export type ApiKeyStatus = "anonymous" | "valid" | "invalid";

export interface ApiKeyResolution {
  status: ApiKeyStatus;
  keyId: string | null;
  /** Granted scopes for a valid key (null when anonymous/invalid). */
  scopes: Set<Scope> | null;
}

type Env = Record<string, string | undefined>;
type Headers = Record<string, string | string[] | undefined>;

/**
 * Endpoints that remain open even when SAFEHANDS_REQUIRE_API_KEY=true.
 * The `/paid/*` bundle entrypoints are listed so PUBLIC x402 users/agents reach them
 * without an API key — payment (x402), not an API key, gates those routes. (An explicitly
 * INVALID key is still rejected everywhere except /health.)
 */
export const ALWAYS_OPEN_PATHS = new Set<string>([
  "/health",
  "/demo",
  "/infra/status",
  "/public-config",
  "/activity/summary",
  "/activity/recent",
  "/metrics/public",
  "/paid/assess-risk",
  "/paid/check-token-security",
  "/paid/simulate-transaction",
  "/paid/token-price",
  "/paid/pool-info",
  "/paid/swap-route",
  "/paid/risk-report",
]);

function sha256hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function loadApiKeyConfig(env: Env = process.env): ApiKeyConfig {
  const entries = (env.SAFEHANDS_API_KEYS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const hashes = new Map<string, string>();
  const scopes = new Map<string, Set<Scope>>();
  for (const entry of entries) {
    // Backward-compatible scoped format: `rawKey` or `rawKey#scopeA|scopeB`.
    // Split on the FIRST `#` only; a bare key (no `#`) gets the default read bundle.
    const hashIdx = entry.indexOf("#");
    const rawKey = (hashIdx >= 0 ? entry.slice(0, hashIdx) : entry).trim();
    if (!rawKey) continue;
    const scopeStr = hashIdx >= 0 ? entry.slice(hashIdx + 1) : null;
    const hash = sha256hex(rawKey);
    const keyId = hash.slice(0, 8);
    hashes.set(keyId, hash);
    scopes.set(keyId, scopeStr !== null ? parseScopes(scopeStr) : new Set<Scope>(DEFAULT_READ_SCOPES));
  }
  const configured = hashes.size > 0;
  return {
    configured,
    required: env.SAFEHANDS_REQUIRE_API_KEY === "true" && configured,
    publicReadEnabled: env.SAFEHANDS_PUBLIC_READ_ENABLED !== "false",
    hashes,
    scopes,
  };
}

/** Extract a presented key from `X-Api-Key` or `Authorization: Bearer <key>`. */
export function extractApiKey(headers: Headers): string | null {
  const x = headers["x-api-key"];
  const xVal = Array.isArray(x) ? x[0] : x;
  if (typeof xVal === "string" && xVal.trim().length > 0) return xVal.trim();

  const auth = headers["authorization"];
  const authVal = Array.isArray(auth) ? auth[0] : auth;
  if (typeof authVal === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(authVal.trim());
    if (m && m[1].trim().length > 0) return m[1].trim();
  }
  return null;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Resolve a request's API-key status. Never returns the raw key. `anonymous`
 * when none presented; `valid` (+keyId) on match; `invalid` otherwise.
 */
export function resolveApiKey(headers: Headers, cfg: ApiKeyConfig): ApiKeyResolution {
  const provided = extractApiKey(headers);
  if (!provided) return { status: "anonymous", keyId: null, scopes: null };
  const hash = sha256hex(provided);
  const keyId = hash.slice(0, 8);
  const expected = cfg.hashes.get(keyId);
  if (expected && timingSafeHexEqual(expected, hash)) {
    return { status: "valid", keyId, scopes: cfg.scopes.get(keyId) ?? new Set<Scope>() };
  }
  return { status: "invalid", keyId: null, scopes: null };
}

export interface AccessDecision {
  allow: boolean;
  code: string | null;
}

/**
 * Pure access decision for a path given the resolved key + config.
 *  • /health is always open (Railway healthcheck).
 *  • An explicitly INVALID key is rejected everywhere else.
 *  • ALWAYS_OPEN paths are open even when keys are required.
 *  • When `required`, a valid key is necessary, and the key must carry the
 *    endpoint's scope. Scope is only enforced in require-key mode; when the public
 *    read API is open (default), scopes are recorded as identity, never gates.
 *    (A valid resolution with `scopes` omitted skips the scope check — the live
 *    `resolveApiKey` always populates scopes for valid keys.)
 */
export function evaluateAccess(
  path: string,
  resolution: ApiKeyResolution,
  cfg: ApiKeyConfig,
): AccessDecision {
  if (path === "/health") return { allow: true, code: null };
  if (resolution.status === "invalid") return { allow: false, code: "INVALID_API_KEY" };
  if (ALWAYS_OPEN_PATHS.has(path)) return { allow: true, code: null };
  if (cfg.required && resolution.status !== "valid") {
    return { allow: false, code: "API_KEY_REQUIRED" };
  }
  if (cfg.required && resolution.status === "valid" && resolution.scopes) {
    const needed = scopeForPath(path);
    if (needed && !hasScope(resolution.scopes, needed)) {
      return { allow: false, code: "INSUFFICIENT_SCOPE" };
    }
  }
  return { allow: true, code: null };
}
