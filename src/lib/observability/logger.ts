// ─── Structured Request Logger ─────────────────────────────────────────
// One JSON line per request to stdout (Railway captures stdout). Whitelisted
// fields ONLY — never bodies, headers, query strings, client IP, API keys,
// private keys, full RPC URLs, or raw signed transactions. `formatRequestLog`
// is pure (returns the line); `logRequest` is the thin, never-throw emitter
// (mirrors the discipline of lib/auditLog.ts). No signing/wallet primitives.
// ────────────────────────────────────────────────────────────────────────

export interface RequestLogEntry {
  ts: string;
  level: "info" | "warn";
  event: "request";
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  callerType?: string | null;
  decision?: string | null;
  rateLimited?: boolean;
  /** keyId (hash prefix) only — NEVER the raw API key. */
  apiKeyId?: string | null;
}

export interface LoggingConfig {
  enabled: boolean;
  format: "json";
}

/** Pure: shape a log entry into a single JSON line (no trailing newline). */
export function formatRequestLog(entry: RequestLogEntry): string {
  return JSON.stringify(entry);
}

type Sink = (line: string) => void;

const defaultSink: Sink = (line) => {
  process.stdout.write(line + "\n");
};

/**
 * Emit a request log line. Never throws (logging must not affect request
 * handling). Disabled via config so tests/dev can silence output. `sink` is
 * injectable for tests.
 */
export function logRequest(
  entry: RequestLogEntry,
  config: LoggingConfig = { enabled: true, format: "json" },
  sink: Sink = defaultSink,
): void {
  if (!config.enabled) return;
  try {
    sink(formatRequestLog(entry));
  } catch {
    // swallow — logging must never break the response path
  }
}
