// ─── Price Oracle Types ────────────────────────────────────────────────
// Contracts for the provider-based PriceResolver. Price oracle/valuation is
// separate from swap routing (DODO/FaroSwap stays route/execution-quote only).
// No I/O in this module.
// ────────────────────────────────────────────────────────────────────────

import type { Abi } from "viem";

export type PriceFeedProviderKind = "chainlink-push" | "supra-pull";

export type PriceErrorCode =
  | "PRICE_SOURCE_UNAVAILABLE"
  | "PRICE_SOURCE_STALE"
  | "PRICE_SOURCE_INVALID"
  | "PRICE_SOURCE_RATE_LIMITED"
  | "PRICE_FEED_NOT_CONFIGURED";

export interface PriceFeedConfig {
  pair: string; // e.g. "PROS/USD"
  base: string; // canonical asset symbol, e.g. "PROS"
  quote: "USD";
  feedAddress: `0x${string}`;
  decimals: number;
  heartbeatSeconds: number;
  provider: PriceFeedProviderKind;
  docsSource: string;
}

export interface ProviderQuote {
  answer: bigint; // raw latestAnswer (int256)
  updatedAtUnix: number; // latestTimestamp (seconds)
}

/** Minimal read surface so providers are testable without the global viem client. */
export interface ContractReader {
  readContract(args: {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
  }): Promise<unknown>;
}

export interface PriceProvider {
  readonly kind: PriceFeedProviderKind;
  readonly label: string;
  /** Fetch one raw quote for one feed. May throw raw errors; the resolver classifies them. */
  fetchQuote(feed: PriceFeedConfig): Promise<ProviderQuote>;
}

export interface PriceResolution {
  token: string; // requested symbol, e.g. "WPROS"
  canonicalSymbol: string; // feed base, e.g. "PROS"
  pair: string;
  priceUsd: string; // full-precision decimal string from the oracle answer
  priceUsdNumber: number;
  provider: PriceFeedProviderKind;
  source: string; // provider label
  // "ok" = live read or fresh cache; "rpc_degraded_cache" = RPC failed, served
  // from a bounded cache of a previous successful oracle read.
  sourceStatus: "ok" | "rpc_degraded_cache";
  confidence: "high" | "degraded";
  timestamp: string; // ISO-8601 of the oracle latestTimestamp
  updatedAtUnix: number;
  feedAgeSeconds: number; // now - oracle latestTimestamp, recomputed at serve time
  // feedStale means the ORACLE timestamp is outside the heartbeat — never set
  // merely because a value was served from cache. Heartbeat-violating reads are
  // rejected, so this is always false on a successful resolution.
  feedStale: boolean;
  cached: boolean;
  cacheAgeSeconds: number | null; // seconds since the successful oracle read; null when live
  feedAddress: `0x${string}`;
  heartbeatSeconds: number;
  network: string;
  chainId: number;
}

export interface PriceResolverFailure {
  code: PriceErrorCode;
  message: string;
  retryable: boolean;
  provider: PriceFeedProviderKind | "none";
  pair?: string;
}

export type PriceResolverResult =
  | { ok: true; resolution: PriceResolution }
  | { ok: false; error: PriceResolverFailure };
