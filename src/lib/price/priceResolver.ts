// ─── PriceResolver ─────────────────────────────────────────────────────
// Canonical USD price resolution: live oracle reads + validation + bounded
// per-feed cache + structured error classification. Never fabricates prices;
// never assumes stablecoins equal exactly 1 USD.
//
// Cache semantics:
// - Fresh serve: entry younger than the TTL AND the oracle timestamp still
//   within heartbeat → sourceStatus "ok", confidence "high".
// - Degraded serve (RPC failed transiently): allowed ONLY after a previous
//   successful oracle read, cache age <= 5 minutes, AND the oracle timestamp
//   still within heartbeat → sourceStatus "rpc_degraded_cache",
//   confidence "degraded". feedStale is never set just because a value came
//   from cache — it means heartbeat violation only.
// - Otherwise: structured PRICE_SOURCE_* failure with no price.
// ────────────────────────────────────────────────────────────────────────

import { formatUnits, BaseError, HttpRequestError, RpcRequestError, TimeoutError } from "viem";
import { getActiveNetwork } from "../networks.js";
import { CHAIN_ID } from "../constants.js";
import { resolveFeedSymbol, pricedSymbolsForActiveNetwork, type FeedLookup } from "./feedRegistry.js";
import { ChainlinkPushProvider } from "./chainlinkPushProvider.js";
import { SupraPullProvider } from "./supraProvider.js";
import type {
  PriceErrorCode,
  PriceFeedProviderKind,
  PriceProvider,
  PriceResolution,
  PriceResolverResult,
} from "./types.js";

export const PRICE_CACHE_TTL_MS = 45_000; // fresh-serve window (mandated 30–60s)
export const DEGRADED_CACHE_MAX_AGE_MS = 300_000; // hard bound for rpc_degraded_cache serves
const MAX_FUTURE_SKEW_SECONDS = 300;

interface CacheEntry {
  resolution: PriceResolution;
  fetchedAtMs: number;
}

export interface ResolvePriceOptions {
  cacheTtlMs?: number;
  /** Set false to disable rpc_degraded_cache serves and strictly fail on RPC errors. */
  allowDegradedCache?: boolean;
}

interface ClassifiedError {
  code: PriceErrorCode;
  retryable: boolean;
  message: string;
}

function classifyPriceSourceError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // viem readContract failures arrive as ContractFunctionExecutionError wrapping
  // the transport error; walk the chain, but also match the top-level message —
  // the fallback transport can rewrap and viem embeds status text in `details`.
  const walked =
    err instanceof BaseError
      ? err.walk((e) => e instanceof HttpRequestError || e instanceof RpcRequestError || e instanceof TimeoutError)
      : undefined;
  const httpStatus = walked instanceof HttpRequestError ? walked.status : undefined;
  const rpcCode = walked instanceof RpcRequestError ? walked.code : undefined;

  const rateLimited =
    httpStatus === 429 ||
    rpcCode === -32005 || // JSON-RPC "limit exceeded" (EIP-1474)
    rpcCode === -32016 || // provider-specific throttle code
    /\b429\b/.test(lower) ||
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
    lower.includes("too many requests") ||
    lower.includes("compute unit") ||
    lower.includes("cu limit") ||
    lower.includes("capacity exceeded") ||
    lower.includes("request limit") ||
    lower.includes("quota");
  if (rateLimited) {
    return { code: "PRICE_SOURCE_RATE_LIMITED", retryable: true, message };
  }

  if (lower.includes("supra_provider_not_implemented")) {
    return { code: "PRICE_SOURCE_UNAVAILABLE", retryable: false, message };
  }

  // Zero-data/revert at the feed address means a wrong or absent contract —
  // a configuration problem, not a transient outage.
  if (lower.includes("returned no data") || lower.includes("zero data") || lower.includes("reverted")) {
    return { code: "PRICE_SOURCE_INVALID", retryable: false, message };
  }

  // Timeouts, aborts, network failures, 5xx → transient unavailability.
  return { code: "PRICE_SOURCE_UNAVAILABLE", retryable: true, message };
}

export class PriceResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<PriceResolverResult>>();

  constructor(
    private readonly providers: Partial<Record<PriceFeedProviderKind, PriceProvider>>,
    private readonly now: () => number = Date.now
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  async resolvePriceUsd(symbol: string, opts?: ResolvePriceOptions): Promise<PriceResolverResult> {
    const lookup = resolveFeedSymbol(symbol);
    if (!lookup) {
      const network = getActiveNetwork().name;
      const configured = pricedSymbolsForActiveNetwork();
      return {
        ok: false,
        error: {
          code: "PRICE_FEED_NOT_CONFIGURED",
          message: `${symbol} has no price feed configured for ${network} (${CHAIN_ID}). Configured symbols: ${
            configured.length > 0 ? configured.join(", ") : "none"
          }. No fallback price was fabricated.`,
          retryable: false,
          provider: "none",
        },
      };
    }

    const key = `${getActiveNetwork().name}:${lookup.feed.pair}`;
    const ttlMs = opts?.cacheTtlMs ?? PRICE_CACHE_TTL_MS;

    const fresh = this.serveFromCache(key, lookup, ttlMs, "ok");
    if (fresh) return { ok: true, resolution: fresh };

    const inflight = this.inflight.get(key);
    if (inflight) {
      const shared = await inflight;
      if (shared.ok) {
        return { ok: true, resolution: { ...shared.resolution, token: lookup.requested } };
      }
      return shared;
    }

    const pending = this.fetchLive(key, lookup, opts).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, pending);
    return pending;
  }

  /**
   * Serve a cached resolution if it is within maxAgeMs AND the original oracle
   * timestamp is still within the feed heartbeat. Returns null otherwise.
   */
  private serveFromCache(
    key: string,
    lookup: FeedLookup,
    maxAgeMs: number,
    mode: "ok" | "rpc_degraded_cache"
  ): PriceResolution | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const nowMs = this.now();
    const cacheAgeMs = nowMs - entry.fetchedAtMs;
    if (cacheAgeMs < 0 || cacheAgeMs > maxAgeMs) return null;
    const feedAgeSeconds = Math.max(0, Math.floor(nowMs / 1000) - entry.resolution.updatedAtUnix);
    if (feedAgeSeconds > lookup.feed.heartbeatSeconds) return null;
    return {
      ...entry.resolution,
      token: lookup.requested,
      cached: true,
      cacheAgeSeconds: Math.floor(cacheAgeMs / 1000),
      feedAgeSeconds,
      sourceStatus: mode,
      confidence: mode === "ok" ? "high" : "degraded",
    };
  }

  private async fetchLive(
    key: string,
    lookup: FeedLookup,
    opts?: ResolvePriceOptions
  ): Promise<PriceResolverResult> {
    const feed = lookup.feed;
    const provider = this.providers[feed.provider];
    if (!provider) {
      return {
        ok: false,
        error: {
          code: "PRICE_SOURCE_UNAVAILABLE",
          message: `No ${feed.provider} provider is registered for ${feed.pair}.`,
          retryable: false,
          provider: feed.provider,
          pair: feed.pair,
        },
      };
    }

    try {
      const quote = await provider.fetchQuote(feed);
      const nowSec = Math.floor(this.now() / 1000);

      if (quote.answer <= 0n) {
        return this.invalid(feed, `latestAnswer ${quote.answer} is not a positive value`);
      }
      if (
        !Number.isFinite(quote.updatedAtUnix) ||
        quote.updatedAtUnix <= 0 ||
        quote.updatedAtUnix > nowSec + MAX_FUTURE_SKEW_SECONDS
      ) {
        return this.invalid(feed, `latestTimestamp ${quote.updatedAtUnix} is zero or implausible`);
      }

      const feedAgeSeconds = Math.max(0, nowSec - quote.updatedAtUnix);
      if (feedAgeSeconds > feed.heartbeatSeconds) {
        return {
          ok: false,
          error: {
            code: "PRICE_SOURCE_STALE",
            message: `${feed.pair} feed is stale: feed age ${feedAgeSeconds}s exceeds heartbeat ${feed.heartbeatSeconds}s (feed ${feed.feedAddress}).`,
            retryable: true,
            provider: feed.provider,
            pair: feed.pair,
          },
        };
      }

      const priceUsd = formatUnits(quote.answer, feed.decimals);
      const priceUsdNumber = Number(priceUsd);
      if (!Number.isFinite(priceUsdNumber) || priceUsdNumber <= 0) {
        return this.invalid(feed, `latestAnswer did not decode to a finite positive price (${priceUsd})`);
      }

      const resolution: PriceResolution = {
        token: lookup.requested,
        canonicalSymbol: lookup.canonical,
        pair: feed.pair,
        priceUsd,
        priceUsdNumber,
        provider: feed.provider,
        source: provider.label,
        sourceStatus: "ok",
        confidence: "high",
        timestamp: new Date(quote.updatedAtUnix * 1000).toISOString(),
        updatedAtUnix: quote.updatedAtUnix,
        feedAgeSeconds,
        feedStale: false,
        cached: false,
        cacheAgeSeconds: null,
        feedAddress: feed.feedAddress,
        heartbeatSeconds: feed.heartbeatSeconds,
        network: getActiveNetwork().name,
        chainId: CHAIN_ID,
      };
      this.cache.set(key, { resolution, fetchedAtMs: this.now() });
      return { ok: true, resolution };
    } catch (err) {
      const classified = classifyPriceSourceError(err);
      if (classified.retryable && opts?.allowDegradedCache !== false) {
        const degraded = this.serveFromCache(key, lookup, DEGRADED_CACHE_MAX_AGE_MS, "rpc_degraded_cache");
        if (degraded) return { ok: true, resolution: degraded };
      }
      return {
        ok: false,
        error: {
          code: classified.code,
          message: classified.message,
          retryable: classified.retryable,
          provider: feed.provider,
          pair: feed.pair,
        },
      };
    }
  }

  private invalid(feed: FeedLookup["feed"], detail: string): PriceResolverResult {
    return {
      ok: false,
      error: {
        code: "PRICE_SOURCE_INVALID",
        message: `${feed.pair} feed returned invalid data: ${detail} (feed ${feed.feedAddress}).`,
        retryable: false,
        provider: feed.provider,
        pair: feed.pair,
      },
    };
  }
}

/** Process-wide singleton wired to the live publicClient. */
export const priceResolver = new PriceResolver({
  "chainlink-push": new ChainlinkPushProvider(),
  "supra-pull": new SupraPullProvider(),
});

export function resolvePriceUsd(symbol: string, opts?: ResolvePriceOptions): Promise<PriceResolverResult> {
  return priceResolver.resolvePriceUsd(symbol, opts);
}
