// ─── PriceResolver unit tests ──────────────────────────────────────────
// Injected fake ContractReader + injected clock: no network, no sleeps.
// Covers feed registry aliasing, validation, cache semantics (fresh vs
// rpc_degraded_cache), rate-limit classification, and coalescing.
// ────────────────────────────────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { createPublicClient, http as viemHttp, defineChain } from "viem";
import {
  PACIFIC_MAINNET_PRICE_FEEDS,
  pricedSymbolsForActiveNetwork,
  resolveFeedSymbol,
} from "../src/lib/price/feedRegistry.js";
import { ChainlinkPushProvider } from "../src/lib/price/chainlinkPushProvider.js";
import { SupraPullProvider } from "../src/lib/price/supraProvider.js";
import { DEGRADED_CACHE_MAX_AGE_MS, PriceResolver } from "../src/lib/price/priceResolver.js";
import type { ContractReader } from "../src/lib/price/types.js";

interface ReaderState {
  answer: bigint;
  updatedAt: bigint;
  error?: Error;
}

function makeReader(state: ReaderState) {
  const calls: string[] = [];
  const reader: ContractReader = {
    async readContract({ functionName }) {
      calls.push(functionName);
      if (state.error) throw state.error;
      if (functionName === "latestAnswer") return state.answer;
      if (functionName === "latestTimestamp") return state.updatedAt;
      throw new Error(`unexpected function ${functionName}`);
    },
  };
  return { reader, calls };
}

function makeResolver(state: ReaderState, startMs: number) {
  const { reader, calls } = makeReader(state);
  const clock = { nowMs: startMs };
  const resolver = new PriceResolver(
    { "chainlink-push": new ChainlinkPushProvider(reader) },
    () => clock.nowMs
  );
  return { resolver, calls, clock };
}

const T0_MS = 1_750_000_000_000;
const T0_SEC = Math.floor(T0_MS / 1000);

describe("feed registry & aliases", () => {
  it("maps WPROS to the PROS/USD feed", () => {
    const lookup = resolveFeedSymbol("WPROS");
    assert.ok(lookup);
    assert.strictEqual(lookup.canonical, "PROS");
    assert.strictEqual(lookup.feed.pair, "PROS/USD");
    assert.strictEqual(lookup.aliased, true);
    assert.strictEqual(lookup.feed.feedAddress, PACIFIC_MAINNET_PRICE_FEEDS.PROS.feedAddress);
  });

  it("maps lowercase weth to the ETH/USD feed", () => {
    const lookup = resolveFeedSymbol("weth");
    assert.ok(lookup);
    assert.strictEqual(lookup.canonical, "ETH");
    assert.strictEqual(lookup.feed.pair, "ETH/USD");
  });

  it("WBTC keeps its own dedicated feed (not aliased to BTC)", () => {
    const lookup = resolveFeedSymbol("WBTC");
    assert.ok(lookup);
    assert.strictEqual(lookup.aliased, false);
    assert.strictEqual(lookup.feed.feedAddress, "0x22E1db75084B7f0393896bc7046E64eFdC34b729");
    assert.notStrictEqual(lookup.feed.feedAddress, PACIFIC_MAINNET_PRICE_FEEDS.BTC.feedAddress);
  });

  it("returns null for unknown symbols", () => {
    assert.strictEqual(resolveFeedSymbol("DOGE"), null);
  });

  it("lists all mainnet feed symbols plus aliases", () => {
    const symbols = pricedSymbolsForActiveNetwork();
    for (const s of ["PROS", "WPROS", "ETH", "WETH", "BTC", "WBTC", "USDC", "USDT", "LINK", "BNB", "SOL", "XRP"]) {
      assert.ok(symbols.includes(s), `missing ${s}`);
    }
    assert.strictEqual(symbols.length, 12);
  });
});

describe("fresh oracle reads", () => {
  it("returns a validated live price with heartbeat metadata", async () => {
    const { resolver, calls } = makeResolver(
      { answer: 998_700_000_000_000_000n, updatedAt: BigInt(T0_SEC - 60) },
      T0_MS
    );
    const result = await resolver.resolvePriceUsd("PROS");
    assert.ok(result.ok);
    const r = result.resolution;
    assert.strictEqual(r.pair, "PROS/USD");
    assert.ok(Math.abs(r.priceUsdNumber - 0.9987) < 1e-9);
    assert.strictEqual(r.feedAgeSeconds, 60);
    assert.strictEqual(r.feedStale, false);
    assert.strictEqual(r.cached, false);
    assert.strictEqual(r.cacheAgeSeconds, null);
    assert.strictEqual(r.sourceStatus, "ok");
    assert.strictEqual(r.confidence, "high");
    assert.strictEqual(r.provider, "chainlink-push");
    assert.strictEqual(calls.length, 2); // exactly one latestAnswer + latestTimestamp pair
  });

  it("WPROS resolves via the PROS feed with alias metadata", async () => {
    const { resolver } = makeResolver({ answer: 10n ** 18n, updatedAt: BigInt(T0_SEC - 10) }, T0_MS);
    const result = await resolver.resolvePriceUsd("WPROS");
    assert.ok(result.ok);
    assert.strictEqual(result.resolution.token, "WPROS");
    assert.strictEqual(result.resolution.canonicalSymbol, "PROS");
    assert.strictEqual(result.resolution.feedAddress, PACIFIC_MAINNET_PRICE_FEEDS.PROS.feedAddress);
  });
});

describe("validation failures", () => {
  it("rejects zero and negative answers as PRICE_SOURCE_INVALID and does not cache them", async () => {
    const state: ReaderState = { answer: 0n, updatedAt: BigInt(T0_SEC - 10) };
    const { resolver, calls } = makeResolver(state, T0_MS);

    const zero = await resolver.resolvePriceUsd("PROS");
    assert.ok(!zero.ok);
    assert.strictEqual(zero.error.code, "PRICE_SOURCE_INVALID");
    assert.strictEqual(zero.error.retryable, false);

    state.answer = -5n;
    const negative = await resolver.resolvePriceUsd("PROS");
    assert.ok(!negative.ok);
    assert.strictEqual(negative.error.code, "PRICE_SOURCE_INVALID");
    assert.strictEqual(calls.length, 4); // second resolve hit the reader again — invalid results are never cached
  });

  it("rejects zero and far-future timestamps as PRICE_SOURCE_INVALID", async () => {
    const state: ReaderState = { answer: 10n ** 18n, updatedAt: 0n };
    const { resolver } = makeResolver(state, T0_MS);

    const zeroTs = await resolver.resolvePriceUsd("PROS");
    assert.ok(!zeroTs.ok);
    assert.strictEqual(zeroTs.error.code, "PRICE_SOURCE_INVALID");

    state.updatedAt = BigInt(T0_SEC + 3600);
    const future = await resolver.resolvePriceUsd("PROS");
    assert.ok(!future.ok);
    assert.strictEqual(future.error.code, "PRICE_SOURCE_INVALID");
  });

  it("rejects feeds outside heartbeat as PRICE_SOURCE_STALE", async () => {
    const { resolver } = makeResolver({ answer: 10n ** 18n, updatedAt: BigInt(T0_SEC - 4000) }, T0_MS);
    const result = await resolver.resolvePriceUsd("PROS");
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "PRICE_SOURCE_STALE");
    assert.strictEqual(result.error.retryable, true);
  });
});

describe("cache semantics", () => {
  it("serves fresh cache inside TTL without new RPC reads, then refetches after TTL", async () => {
    const state: ReaderState = { answer: 10n ** 18n, updatedAt: BigInt(T0_SEC - 30) };
    const { resolver, calls, clock } = makeResolver(state, T0_MS);

    const first = await resolver.resolvePriceUsd("PROS");
    assert.ok(first.ok);
    assert.strictEqual(calls.length, 2);

    clock.nowMs += 10_000;
    const second = await resolver.resolvePriceUsd("PROS");
    assert.ok(second.ok);
    assert.strictEqual(second.resolution.cached, true);
    assert.strictEqual(second.resolution.cacheAgeSeconds, 10);
    assert.strictEqual(second.resolution.feedAgeSeconds, 40); // feed age is recomputed at serve time
    assert.strictEqual(second.resolution.sourceStatus, "ok"); // fresh cache is NOT degraded
    assert.strictEqual(second.resolution.feedStale, false); // never stale just because cached
    assert.strictEqual(calls.length, 2);

    clock.nowMs += 36_000; // 46s past fetch → outside TTL
    state.updatedAt = BigInt(Math.floor(clock.nowMs / 1000) - 5);
    const third = await resolver.resolvePriceUsd("PROS");
    assert.ok(third.ok);
    assert.strictEqual(third.resolution.cached, false);
    assert.strictEqual(calls.length, 4);
  });

  it("serves bounded rpc_degraded_cache on transient RPC failure, then fails past the 5-minute bound", async () => {
    const state: ReaderState = { answer: 2n * 10n ** 18n, updatedAt: BigInt(T0_SEC - 30) };
    const { resolver, clock } = makeResolver(state, T0_MS);

    const primed = await resolver.resolvePriceUsd("PROS");
    assert.ok(primed.ok);

    clock.nowMs += 120_000;
    state.error = new Error("fetch failed");
    const degraded = await resolver.resolvePriceUsd("PROS");
    assert.ok(degraded.ok, "bounded cache should be served after a previous successful read");
    assert.strictEqual(degraded.resolution.sourceStatus, "rpc_degraded_cache");
    assert.strictEqual(degraded.resolution.confidence, "degraded");
    assert.strictEqual(degraded.resolution.cached, true);
    assert.strictEqual(degraded.resolution.cacheAgeSeconds, 120);
    assert.strictEqual(degraded.resolution.feedAgeSeconds, 150);
    assert.strictEqual(degraded.resolution.feedStale, false); // feed timestamp still within heartbeat

    clock.nowMs = T0_MS + DEGRADED_CACHE_MAX_AGE_MS + 1_000; // past the 5-minute cache bound
    const tooOld = await resolver.resolvePriceUsd("PROS");
    assert.ok(!tooOld.ok);
    assert.strictEqual(tooOld.error.code, "PRICE_SOURCE_UNAVAILABLE");
  });

  it("refuses degraded cache when the cached oracle timestamp has left the heartbeat window", async () => {
    // Primed with a near-heartbeat feed timestamp: valid at fetch, outside heartbeat 120s later.
    const state: ReaderState = { answer: 10n ** 18n, updatedAt: BigInt(T0_SEC - 3550) };
    const { resolver, clock } = makeResolver(state, T0_MS);

    const primed = await resolver.resolvePriceUsd("PROS");
    assert.ok(primed.ok);

    clock.nowMs += 120_000; // cache is only 120s old, but feed age is now 3670s > 3600s heartbeat
    state.error = new Error("fetch failed");
    const result = await resolver.resolvePriceUsd("PROS");
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "PRICE_SOURCE_UNAVAILABLE");
  });

  it("serves bounded cache on rate limit, and strict callers can opt out", async () => {
    const state: ReaderState = { answer: 10n ** 18n, updatedAt: BigInt(T0_SEC - 30) };
    const { resolver, clock } = makeResolver(state, T0_MS);

    const primed = await resolver.resolvePriceUsd("PROS");
    assert.ok(primed.ok);

    clock.nowMs += 60_000;
    state.error = new Error("HTTP request failed. Status: 429 Too Many Requests");
    const degraded = await resolver.resolvePriceUsd("PROS");
    assert.ok(degraded.ok);
    assert.strictEqual(degraded.resolution.sourceStatus, "rpc_degraded_cache");

    const strict = await resolver.resolvePriceUsd("PROS", { allowDegradedCache: false });
    assert.ok(!strict.ok);
    assert.strictEqual(strict.error.code, "PRICE_SOURCE_RATE_LIMITED");
  });
});

describe("rate-limit and error classification", () => {
  it("classifies 429/compute-unit style errors as PRICE_SOURCE_RATE_LIMITED", async () => {
    for (const message of [
      "HTTP request failed. Status: 429 Too Many Requests",
      "compute units exceeded for this billing period",
      "daily request limit reached, upgrade your plan",
    ]) {
      const { resolver } = makeResolver({ answer: 0n, updatedAt: 0n, error: new Error(message) }, T0_MS);
      const result = await resolver.resolvePriceUsd("PROS");
      assert.ok(!result.ok, message);
      assert.strictEqual(result.error.code, "PRICE_SOURCE_RATE_LIMITED", message);
      assert.strictEqual(result.error.retryable, true);
    }
  });

  it("classifies a real HTTP 429 from the RPC transport as PRICE_SOURCE_RATE_LIMITED", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(429, { "content-type": "text/plain" });
      res.end("rate limited");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const chain = defineChain({
        id: 1672,
        name: "pharos-mock",
        nativeCurrency: { name: "PROS", symbol: "PROS", decimals: 18 },
        rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } },
      });
      const client = createPublicClient({
        chain,
        transport: viemHttp(`http://127.0.0.1:${port}`, { retryCount: 0, timeout: 2_000 }),
      });
      const resolver = new PriceResolver(
        { "chainlink-push": new ChainlinkPushProvider(client as unknown as ContractReader) },
        () => T0_MS
      );
      const result = await resolver.resolvePriceUsd("PROS");
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, "PRICE_SOURCE_RATE_LIMITED");
      assert.strictEqual(result.error.retryable, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("classifies plain network failures as PRICE_SOURCE_UNAVAILABLE (never a generic throw)", async () => {
    const { resolver } = makeResolver({ answer: 0n, updatedAt: 0n, error: new Error("fetch failed") }, T0_MS);
    const result = await resolver.resolvePriceUsd("PROS");
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "PRICE_SOURCE_UNAVAILABLE");
    assert.strictEqual(result.error.retryable, true);
  });

  it("returns PRICE_FEED_NOT_CONFIGURED for symbols without a feed", async () => {
    const { resolver } = makeResolver({ answer: 10n ** 18n, updatedAt: BigInt(T0_SEC) }, T0_MS);
    const result = await resolver.resolvePriceUsd("DOGE");
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "PRICE_FEED_NOT_CONFIGURED");
    assert.strictEqual(result.error.retryable, false);
  });
});

describe("RPC burst avoidance", () => {
  it("coalesces concurrent resolves of the same pair into one read pair", async () => {
    const calls: string[] = [];
    const reader: ContractReader = {
      async readContract({ functionName }) {
        calls.push(functionName);
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (functionName === "latestAnswer") return 10n ** 18n;
        return BigInt(Math.floor(Date.now() / 1000) - 10);
      },
    };
    const resolver = new PriceResolver({ "chainlink-push": new ChainlinkPushProvider(reader) });
    const [a, b] = await Promise.all([resolver.resolvePriceUsd("PROS"), resolver.resolvePriceUsd("WPROS")]);
    assert.ok(a.ok && b.ok);
    assert.strictEqual(a.resolution.token, "PROS");
    assert.strictEqual(b.resolution.token, "WPROS");
    assert.strictEqual(calls.length, 2, "concurrent same-pair resolves must share one latestAnswer/latestTimestamp pair");
  });
});

describe("provider abstraction (Supra readiness)", () => {
  it("Supra stub refuses to fabricate quotes", async () => {
    const supra = new SupraPullProvider();
    await assert.rejects(
      () => supra.fetchQuote(PACIFIC_MAINNET_PRICE_FEEDS.PROS),
      /SUPRA_PROVIDER_NOT_IMPLEMENTED/
    );
  });

  it("a missing provider yields structured PRICE_SOURCE_UNAVAILABLE, not a crash", async () => {
    const resolver = new PriceResolver({}, () => T0_MS);
    const result = await resolver.resolvePriceUsd("PROS");
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "PRICE_SOURCE_UNAVAILABLE");
    assert.strictEqual(result.error.retryable, false);
  });
});
