// ─── Structured Tool Responses ─────────────────────────────────────────
// Shared response helpers so MCP tools are predictable for AI agents.
export function ok(data, timestamp = new Date().toISOString()) {
    return { success: true, data, error: null, timestamp };
}
export function fail(code, message, retryable = false, source, timestamp = new Date().toISOString()) {
    return {
        success: false,
        data: null,
        error: { code, message, retryable, ...(source ? { source } : {}) },
        timestamp,
    };
}
export function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
export function classifyExternalError(source, err) {
    const message = errorMessage(err);
    const lower = message.toLowerCase();
    const isTimeout = lower.includes("timeout") || lower.includes("aborted");
    const isRetryable = isTimeout ||
        lower.includes("fetch failed") ||
        lower.includes("network") ||
        lower.includes("503") ||
        lower.includes("502") ||
        lower.includes("504") ||
        lower.includes("429");
    let code = "EXTERNAL_SERVICE_UNAVAILABLE";
    if (source === "pharos_rpc")
        code = isTimeout ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE";
    if (source === "dodo_api")
        code = isTimeout ? "DODO_API_TIMEOUT" : "DODO_API_UNAVAILABLE";
    if (source === "faroswap_api")
        code = isTimeout ? "FAROSWAP_API_TIMEOUT" : "FAROSWAP_API_UNAVAILABLE";
    if (source === "goplus_api")
        code = isTimeout ? "GOPLUS_API_TIMEOUT" : "GOPLUS_API_UNAVAILABLE";
    if (source === "x402_fetch")
        code = isTimeout ? "X402_FETCH_TIMEOUT" : "X402_FETCH_FAILED";
    return fail(code, message, isRetryable, source);
}
export function requireWriteToolsEnabled(toolName) {
    if (process.env.WRITE_TOOLS_ENABLED !== "true") {
        return fail("WRITE_TOOLS_DISABLED", `${toolName} is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted testnet execution.`, false, toolName);
    }
    return null;
}
export function requireEnv(name, source) {
    const value = process.env[name];
    if (!value) {
        return fail("MISSING_ENV", `${name} is not configured.`, false, source);
    }
    return value;
}
//# sourceMappingURL=toolResponse.js.map