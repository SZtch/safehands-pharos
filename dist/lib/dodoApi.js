// ─── DODO Route API Client ─────────────────────────────────────────────
// Fetches swap routes from DODO's aggregation API for FaroSwap on
// Pharos Atlantic Testnet.
// ────────────────────────────────────────────────────────────────────────
import { isAddress } from "viem";
import { DODO_API_BASE, DODO_API_KEY, DODO_DEFAULT_SLIPPAGE, DODO_ROUTE_ENDPOINT, CHAIN_ID, TOKEN_MAP, TOKEN_DECIMALS, PHRS_ADDRESS, USDC_ADDRESS, CIRCLE_USDC_ADDRESS, } from "./constants.js";
import { fetchWithTimeoutAndRetry } from "./http.js";
// ─── Helpers ───────────────────────────────────────────────────────────
/**
 * Resolves a token symbol (e.g. "PHRS") or address to its on-chain address.
 */
export function resolveTokenAddress(token) {
    const upper = token.toUpperCase();
    if (TOKEN_MAP[upper])
        return TOKEN_MAP[upper];
    if (isAddress(token))
        return token;
    throw new Error(`INVALID_TOKEN_ADDRESS: Unknown token or invalid address: ${token}`);
}
/**
 * Resolves the decimal count for a token symbol or address.
 */
export function resolveTokenDecimals(token) {
    const upper = token.toUpperCase();
    if (TOKEN_DECIMALS[upper] !== undefined)
        return TOKEN_DECIMALS[upper];
    const lower = token.toLowerCase();
    if (TOKEN_DECIMALS[lower] !== undefined)
        return TOKEN_DECIMALS[lower];
    return 18; // unknown custom token fallback
}
/**
 * Converts a human-readable amount to wei string.
 */
export function toWei(amount, decimals) {
    if (!/^\d+(\.\d+)?$/.test(amount)) {
        throw new Error(`INVALID_AMOUNT: ${amount}`);
    }
    const [whole, frac = ""] = amount.split(".");
    const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
    return BigInt(whole + paddedFrac).toString();
}
/**
 * Converts a wei string to human-readable amount.
 * Also handles the case where the API returns a decimal string directly.
 */
export function fromWei(weiInput, decimals) {
    const weiStr = String(weiInput);
    if (weiStr.includes("."))
        return weiStr;
    const wei = BigInt(weiStr);
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = wei / divisor;
    const remainder = wei % divisor;
    if (remainder === 0n)
        return whole.toString();
    const fracStr = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole}.${fracStr}`;
}
// ─── DODO Route Fetch ──────────────────────────────────────────────────
/**
 * Fetches a swap route from the DODO aggregation API.
 */
export async function _getDodoRouteCore(params) {
    const trimmedApiKey = DODO_API_KEY?.trim();
    const usedApiKey = Boolean(trimmedApiKey);
    if (!isAddress(params.walletAddress)) {
        throw new Error(`INVALID_WALLET_ADDRESS: ${params.walletAddress}`);
    }
    const fromAddress = resolveTokenAddress(params.fromToken);
    const toAddress = resolveTokenAddress(params.toToken);
    const fromDecimals = resolveTokenDecimals(params.fromToken);
    const toDecimals = resolveTokenDecimals(params.toToken);
    const amountInWei = toWei(params.amountHuman, fromDecimals);
    const slippage = params.slippage ?? DODO_DEFAULT_SLIPPAGE;
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const url = new URL(`${DODO_API_BASE}${DODO_ROUTE_ENDPOINT}`);
    url.searchParams.set("chainId", String(CHAIN_ID));
    url.searchParams.set("fromTokenAddress", fromAddress);
    url.searchParams.set("toTokenAddress", toAddress);
    url.searchParams.set("fromAmount", amountInWei);
    url.searchParams.set("userAddr", params.walletAddress);
    url.searchParams.set("slippage", String(slippage));
    url.searchParams.set("source", "dodoV2AndMixWasm");
    url.searchParams.set("estimateGas", "true");
    // DODO/FaroSwap read-only route queries should prefer public mode when no
    // API key is configured. Never hardcode a default credential. If the
    // provider rejects public mode, surface a structured auth-required error
    // at the tool layer.
    if (trimmedApiKey) {
        url.searchParams.set("apikey", trimmedApiKey);
    }
    url.searchParams.set("deadLine", String(deadline));
    const response = await fetchWithTimeoutAndRetry(url, {
        timeoutMs: 10_000,
        retries: 2,
        retryDelayMs: 300,
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error(`DODO_API_AUTH_REQUIRED: DODO route API rejected public mode${usedApiKey ? " or provided key" : "; configure DODO_API_KEY if this endpoint requires authentication"}`);
        }
        if (response.status === 429) {
            throw new Error(`DODO_API_RATE_LIMITED: ${response.status} ${response.statusText}`);
        }
        throw new Error(`DODO_API_UNAVAILABLE: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json());
    if (!json.data || json.status !== 200) {
        const message = (json.message || "").toLowerCase();
        if (message.includes("api key") || message.includes("apikey") || message.includes("unauthorized") || message.includes("forbidden")) {
            throw new Error(`DODO_API_AUTH_REQUIRED: DODO route API rejected public mode${usedApiKey ? " or provided key" : "; configure DODO_API_KEY if this endpoint requires authentication"}`);
        }
        return {
            amountOut: "0",
            amountOutWei: "0",
            priceImpact: 100,
            gasLimit: "0",
            value: "0",
            calldata: "0x",
            to: "",
            approveAddress: "",
            routeAvailable: false,
            sourceStatus: "no_route_available",
            usedApiKey,
            rawResponse: json,
        };
    }
    const d = json.data;
    const resAmountStr = String(d.resAmount);
    return {
        amountOut: fromWei(resAmountStr, toDecimals),
        amountOutWei: resAmountStr,
        priceImpact: parseFloat(String(d.priceImpact)) || 0,
        gasLimit: String(d.gasLimit),
        value: String(d.value),
        calldata: d.data,
        to: d.to,
        approveAddress: d.targetApproveAddr,
        routeAvailable: true,
        sourceStatus: "ok",
        usedApiKey,
        rawResponse: json,
    };
}
/**
 * Smart wrapper around _getDodoRouteCore that automatically falls back to alternative token sources
 * (like Circle USDC) if the canonical tokens have no liquidity on the testnet.
 */
export async function getDodoRoute(params) {
    let quote = await _getDodoRouteCore(params);
    if (!quote.routeAvailable) {
        const fromUpper = params.fromToken.toUpperCase();
        const toUpper = params.toToken.toUpperCase();
        // Smart Fallback: If swapping TO canonical USDC failed, try Alternate Circle USDC
        if (toUpper === "USDC" || toUpper === USDC_ADDRESS.toUpperCase()) {
            const fallbackQuote = await _getDodoRouteCore({ ...params, toToken: CIRCLE_USDC_ADDRESS });
            if (fallbackQuote.routeAvailable)
                return fallbackQuote;
        }
        // Smart Fallback: If swapping FROM canonical USDC failed, try Alternate Circle USDC
        if (fromUpper === "USDC" || fromUpper === USDC_ADDRESS.toUpperCase()) {
            const fallbackQuote = await _getDodoRouteCore({ ...params, fromToken: CIRCLE_USDC_ADDRESS });
            if (fallbackQuote.routeAvailable)
                return fallbackQuote;
        }
    }
    return quote;
}
/**
 * Checks whether a token is the native PHRS token.
 */
export function isNativeToken(token) {
    const upper = token.toUpperCase();
    if (upper === "PHRS")
        return true;
    return token.toLowerCase() === PHRS_ADDRESS.toLowerCase();
}
//# sourceMappingURL=dodoApi.js.map