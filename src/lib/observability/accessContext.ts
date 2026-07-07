// ─── Access Context ──────────────────────────────────────────────
// Builds a SANITIZED, secret-free caller identity for a request. It carries the
// access tier (callerType), the keyId (hash prefix) + granted scopes for a valid
// key, and length/charset-capped agentId/a2aPeerId pulled from the request body.
//
// NEVER captured: raw API keys, Authorization/other headers, client IP, or raw
// payloads. agentId/a2aPeerId are UNTRUSTED display-only identity (validated +
// dropped if malformed) — they are not used for any security decision. Pure +
// offline; no signing/wallet/write primitives.
// ────────────────────────────────────────────────────────────────────────

import type { ApiKeyResolution } from "./apiKey.js";
import type { Scope } from "./scopes.js";

export type CallerType = "anonymous" | "api-key" | "agent" | "a2a";

export interface AccessContext {
  callerType: CallerType;
  /** keyId (hash prefix) for a valid key — never the raw key. */
  keyId: string | null;
  /** Granted scopes for a valid key (empty for anonymous). */
  scopes: Scope[];
  /** Sanitized, untrusted, display-only. */
  agentId: string | null;
  a2aPeerId: string | null;
  requestId: string | null;
}

/** Safe identity charset: short, printable, no whitespace/control chars. */
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/** Validate + normalize an untrusted id; returns null if missing/malformed. */
export function sanitizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ID_RE.test(trimmed) ? trimmed : null;
}

function bodyString(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object") return undefined;
  return (body as Record<string, unknown>)[key];
}

/** Derive the access tier from the endpoint + key status. */
export function callerTypeFor(path: string, resolution: ApiKeyResolution): CallerType {
  if (path === "/agent/a2a/check") return "a2a";
  if (path === "/agent/check") return "agent";
  if (resolution.status === "valid") return "api-key";
  return "anonymous";
}

/**
 * Build the sanitized access context. Reads only whitelisted identity fields —
 * raw key/headers/IP/payload are never copied in.
 */
export function buildAccessContext(args: {
  path: string;
  resolution: ApiKeyResolution;
  body: unknown;
  requestId?: string | null;
}): AccessContext {
  const { path, resolution, body } = args;
  return {
    callerType: callerTypeFor(path, resolution),
    keyId: resolution.status === "valid" ? resolution.keyId : null,
    scopes: resolution.scopes ? [...resolution.scopes] : [],
    agentId: sanitizeId(bodyString(body, "agentId")),
    a2aPeerId: sanitizeId(bodyString(body, "callerAgent") ?? bodyString(body, "a2aPeerId")),
    requestId: typeof args.requestId === "string" ? args.requestId : null,
  };
}
