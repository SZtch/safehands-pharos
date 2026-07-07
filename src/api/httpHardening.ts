// ─── SafeHands API — Production HTTP Hardening (read-only) ─────
// Pure, deterministic, offline-testable configuration helpers for the production
// Express server: PORT/host resolution, env-driven CORS allowlist, JSON body limit,
// in-memory rate-limit config, a consistent error-response shape (no stack traces in
// production), and a 404 body. NOTHING here signs, sends, holds keys, or calls the
// network — it only shapes HTTP behaviour. All inputs come from `env` so tests can
// pass a synthetic environment.
// ────────────────────────────────────────────────────────────────────────

import { ZodError } from "zod";
import { fail, type ToolFailure } from "../lib/toolResponse.js";
import type { QuotaConfig } from "../lib/observability/quota.js";

const SOURCE = "guardian_api";

/** Railway/containers require binding all interfaces. */
export const BIND_HOST = "0.0.0.0";

/** Default API port when neither PORT nor GUARDIAN_API_PORT is set. */
export const DEFAULT_PORT = 4022;

type Env = Record<string, string | undefined>;

/** Resolve the listen port. Railway injects PORT; never hardcode a fixed port. */
export function resolvePort(env: Env = process.env): number {
  const raw = env.PORT || env.GUARDIAN_API_PORT;
  const n = raw ? parseInt(raw, 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

/** True only when NODE_ENV is exactly "production". */
export function isProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === "production";
}

// ── CORS ────────────────────────────────────────────────────────────────

export interface CorsConfig {
  /** "wildcard" ⇒ allow any origin (safe for a public, read-only API). */
  mode: "wildcard" | "allowlist";
  /** Explicit allowed origins (only when mode === "allowlist"). */
  origins: string[];
}

/**
 * Resolve CORS from env. `CORS_ORIGIN` or `SAFEHANDS_ALLOWED_ORIGINS` (comma-separated)
 * define an allowlist; either set to `*` (or unset) ⇒ wildcard. The default is wildcard
 * because the hosted API is public and read-only — we never hardcode a private domain.
 */
export function resolveCorsConfig(env: Env = process.env): CorsConfig {
  const raw = (env.CORS_ORIGIN ?? env.SAFEHANDS_ALLOWED_ORIGINS ?? "").trim();
  if (raw === "" || raw === "*") return { mode: "wildcard", origins: [] };
  const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
  if (origins.length === 0 || origins.includes("*")) return { mode: "wildcard", origins: [] };
  return { mode: "allowlist", origins };
}

/**
 * The value to send for `Access-Control-Allow-Origin` given the request `Origin`:
 *  - wildcard ⇒ "*"
 *  - allowlist + origin present + allowed ⇒ the reflected origin
 *  - allowlist + no/Origin not allowed ⇒ the first allowlisted origin (never a secret;
 *    never wide-open). Returns null only when there is genuinely nothing to advertise.
 */
export function corsOriginValue(requestOrigin: string | undefined, cfg: CorsConfig): string | null {
  if (cfg.mode === "wildcard") return "*";
  if (requestOrigin && cfg.origins.includes(requestOrigin)) return requestOrigin;
  return cfg.origins[0] ?? null;
}

// ── JSON body limit ───────────────────────────────────────────────────────

/** Express body-parser limit; small by default (read-only payloads are tiny). */
export function resolveJsonLimit(env: Env = process.env): string {
  const raw = (env.SAFEHANDS_JSON_LIMIT ?? "").trim();
  return raw || "64kb";
}

// ── Rate limiting (in-memory, dependency-free) ────────────────────────────

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  max: number;
}

/** Lightweight in-memory rate-limit config. Disable with SAFEHANDS_RATE_LIMIT_ENABLED=false. */
export function resolveRateLimitConfig(env: Env = process.env): RateLimitConfig {
  const enabled = env.SAFEHANDS_RATE_LIMIT_ENABLED !== "false";
  const windowMs = toPositiveInt(env.SAFEHANDS_RATE_LIMIT_WINDOW_MS, 60_000);
  const max = toPositiveInt(env.SAFEHANDS_RATE_LIMIT_MAX, 120);
  return { enabled, windowMs, max };
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Activity feed (Phase 7) ───────────────────────────────────────────────

export interface ActivityConfig {
  enabled: boolean;
  capacity: number;
}

/** In-memory activity ring config. Enabled by default; capacity clamped 10–5000. */
export function resolveActivityConfig(env: Env = process.env): ActivityConfig {
  const enabled = env.SAFEHANDS_ACTIVITY_ENABLED !== "false";
  const raw = toPositiveInt(env.SAFEHANDS_ACTIVITY_CAPACITY, 500);
  const capacity = Math.min(5000, Math.max(10, raw));
  return { enabled, capacity };
}

// ── Structured request logging (Phase 7) ──────────────────────────────────

export interface RequestLoggingConfig {
  enabled: boolean;
  format: "json";
}

/** Structured JSON request log to stdout. Enabled by default; silence via env. */
export function resolveLoggingConfig(env: Env = process.env): RequestLoggingConfig {
  return { enabled: env.SAFEHANDS_REQUEST_LOG_ENABLED !== "false", format: "json" };
}

// ── Tiered quota (Phase 8B) ────────────────────────────────────────────────

/**
 * Per-tier in-memory quota config. Shares the rate-limit enable/window defaults so
 * existing behavior is preserved: the `anonymous` tier defaults to the Phase 6
 * rate-limit max (120/60s). Generous defaults keep smoke tests + reviewer demos green.
 */
export function resolveQuotaConfig(env: Env = process.env): QuotaConfig {
  const enabled = env.SAFEHANDS_RATE_LIMIT_ENABLED !== "false";
  const windowMs = toPositiveInt(env.SAFEHANDS_QUOTA_WINDOW_MS ?? env.SAFEHANDS_RATE_LIMIT_WINDOW_MS, 60_000);
  const anonymous = toPositiveInt(env.SAFEHANDS_QUOTA_ANON_MAX ?? env.SAFEHANDS_RATE_LIMIT_MAX, 120);
  const apiKey = toPositiveInt(env.SAFEHANDS_QUOTA_KEY_MAX, 600);
  const agent = toPositiveInt(env.SAFEHANDS_QUOTA_AGENT_MAX, 600);
  const a2a = toPositiveInt(env.SAFEHANDS_QUOTA_A2A_MAX, agent);
  return { enabled, windowMs, max: { anonymous, "api-key": apiKey, agent, a2a } };
}

// ── Error & 404 response bodies (consistent shape, no stack leakage) ───────

export interface ErrorResponse {
  status: number;
  body: ToolFailure;
}

/**
 * Map any thrown value to a safe HTTP error response. ZodError ⇒ 400 with field
 * issues. Handler guard messages (requires/invalid/must/unknown) ⇒ 400. Everything
 * else ⇒ 500. **Stack traces are never included**, and in production the 500 message
 * is generic so internal details never leak.
 */
export function errorResponseBody(err: unknown, opts: { production: boolean }): ErrorResponse {
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { status: 400, body: fail("VALIDATION_ERROR", message, false, SOURCE) };
  }
  const message = err instanceof Error ? err.message : String(err);
  const isClient = /requires|invalid|must|unknown/i.test(message);
  if (isClient) return { status: 400, body: fail("BAD_REQUEST", message, false, SOURCE) };
  // 500-class: never echo internal error text in production.
  const safeMessage = opts.production ? "Internal server error." : message;
  return { status: 500, body: fail("INTERNAL_ERROR", safeMessage, false, SOURCE) };
}

/** Consistent 404 body for unmatched routes. */
export function notFoundBody(method: string, path: string): ToolFailure {
  return fail("NOT_FOUND", `No route for ${method} ${path}.`, false, SOURCE);
}
