// ─── Request ID ────────────────────────────────────────────────────────
// Correlation id for logs + activity. Accepts a caller-supplied `X-Request-Id`
// only when it matches a strict, safe charset (defends against header/log
// injection); otherwise generates a fresh UUID. Pure + deterministic given its
// input (aside from the random fallback). No secrets, no I/O.
// ────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

/** Safe inbound request-id: short, printable, no whitespace/control chars. */
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_RE.test(value);
}

/**
 * Resolve a request id from an inbound header value. Honors a safe
 * `X-Request-Id` if present; otherwise mints a new UUID. Array header values
 * (duplicate headers) take the first entry.
 */
export function resolveRequestId(header?: string | string[] | null): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (isValidRequestId(raw)) return raw;
  return randomUUID();
}
