// ─── Structured Tool Responses ─────────────────────────────────────────
// Shared response helpers so MCP tools are predictable for AI agents.

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  source?: string;
}

export interface ToolSuccess<T> {
  success: true;
  data: T;
  error: null;
  timestamp: string;
}

export interface ToolFailure {
  success: false;
  data: null;
  error: ToolError;
  timestamp: string;
}

export type ToolResponse<T> = ToolSuccess<T> | ToolFailure;

export function ok<T>(data: T, timestamp = new Date().toISOString()): ToolSuccess<T> {
  return { success: true, data, error: null, timestamp };
}

export function fail(
  code: string,
  message: string,
  retryable = false,
  source?: string,
  timestamp = new Date().toISOString()
): ToolFailure {
  return {
    success: false,
    data: null,
    error: { code, message, retryable, ...(source ? { source } : {}) },
    timestamp,
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * In production, never echo raw internal error text (DODO/RPC/viem internals) to
 * clients — return a generic message instead. Outside production, keep the real
 * message for debuggability. (M5: `/paid/*` + `/tools/*` info-leak fix.)
 */
export function productionSafeMessage(message: string, fallback = "Request could not be processed. Check parameters and try again."): string {
  return (process.env.NODE_ENV || "").toLowerCase() === "production" ? fallback : message;
}

export function classifyExternalError(source: string, err: unknown): ToolFailure {
  const message = errorMessage(err);
  const lower = message.toLowerCase();
  const isTimeout = lower.includes("timeout") || lower.includes("aborted");
  const isRetryable =
    isTimeout ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("504") ||
    lower.includes("429");

  let code = "EXTERNAL_SERVICE_UNAVAILABLE";
  if (source === "pharos_rpc") code = isTimeout ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE";
  if (source === "dodo_api") code = isTimeout ? "DODO_API_TIMEOUT" : "DODO_API_UNAVAILABLE";
  if (source === "faroswap_api") code = isTimeout ? "FAROSWAP_API_TIMEOUT" : "FAROSWAP_API_UNAVAILABLE";
  if (source === "goplus_api") code = isTimeout ? "GOPLUS_API_TIMEOUT" : "GOPLUS_API_UNAVAILABLE";
  if (source === "x402_fetch") code = isTimeout ? "X402_FETCH_TIMEOUT" : "X402_FETCH_FAILED";

  // M5: in production, never echo raw DODO/RPC/viem internals to the caller — keep
  // the specific error CODE (RPC_TIMEOUT, DODO_API_UNAVAILABLE, …) but genericize the
  // human message. Outside production the real message is retained for debuggability.
  return fail(code, productionSafeMessage(message), isRetryable, source);
}

export function requireWriteToolsEnabled(toolName: string): ToolFailure | null {
  if (process.env.WRITE_TOOLS_ENABLED !== "true") {
    return fail(
      "WRITE_TOOLS_DISABLED",
      `${toolName} is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted mainnet execution.`,
      false,
      toolName
    );
  }
  return null;
}

export function requireEnv(name: string, source: string): string | ToolFailure {
  const value = process.env[name];
  if (!value) {
    return fail("MISSING_ENV", `${name} is not configured.`, false, source);
  }
  return value;
}
