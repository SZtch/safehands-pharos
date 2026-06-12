export interface DodoRouteResponse {
    status: number;
    data: {
        resAmount: string | number;
        priceImpact: string | number;
        targetDecimals: number;
        targetApproveAddr: string;
        to: string;
        data: string;
        value: string | number;
        gasLimit: string | number;
    } | null;
    message?: string;
}
export interface DodoQuote {
    amountOut: string;
    amountOutWei: string;
    priceImpact: number;
    gasLimit: string;
    value: string;
    calldata: string;
    to: string;
    approveAddress: string;
    routeAvailable: boolean;
    sourceStatus: "ok" | "no_route_available" | "auth_required" | "unavailable";
    usedApiKey: boolean;
    rawResponse: DodoRouteResponse;
}
/**
 * Resolves a token symbol (e.g. "PHRS") or address to its on-chain address.
 */
export declare function resolveTokenAddress(token: string): `0x${string}`;
/**
 * Resolves the decimal count for a token symbol or address.
 */
export declare function resolveTokenDecimals(token: string): number;
/**
 * Converts a human-readable amount to wei string.
 */
export declare function toWei(amount: string, decimals: number): string;
/**
 * Converts a wei string to human-readable amount.
 * Also handles the case where the API returns a decimal string directly.
 */
export declare function fromWei(weiInput: string | number, decimals: number): string;
/**
 * Fetches a swap route from the DODO aggregation API.
 */
export declare function _getDodoRouteCore(params: {
    fromToken: string;
    toToken: string;
    amountHuman: string;
    walletAddress: string;
    slippage?: number;
}): Promise<DodoQuote>;
/**
 * Smart wrapper around _getDodoRouteCore that automatically falls back to alternative token sources
 * (like Circle USDC) if the canonical tokens have no liquidity on the testnet.
 */
export declare function getDodoRoute(params: {
    fromToken: string;
    toToken: string;
    amountHuman: string;
    walletAddress: string;
    slippage?: number;
}): Promise<DodoQuote>;
/**
 * Checks whether a token is the native PHRS token.
 */
export declare function isNativeToken(token: string): boolean;
//# sourceMappingURL=dodoApi.d.ts.map