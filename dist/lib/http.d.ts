export declare class HttpError extends Error {
    readonly status?: number | undefined;
    readonly statusText?: string | undefined;
    constructor(message: string, status?: number | undefined, statusText?: string | undefined);
}
export interface FetchWithRetryOptions extends RequestInit {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
}
export declare function fetchWithTimeoutAndRetry(url: string | URL, options?: FetchWithRetryOptions): Promise<Response>;
export declare function redactSensitive(value: unknown): unknown;
export declare function isBlockedIp(ip: string): boolean;
export declare function assertSafeFetchUrl(rawUrl: string): Promise<void>;
//# sourceMappingURL=http.d.ts.map