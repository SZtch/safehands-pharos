// ─── get_token_price / get_wallet_balance oracle integration tests ─────
// viem's http transport uses globalThis.fetch, so a fetch-level JSON-RPC mock
// exercises the real publicClient → ChainlinkPushProvider → PriceResolver →
// tool handler path end-to-end without any network (same save/patch/restore
// pattern as test/token-security-failclosed.test.ts).
// ────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { handleGetTokenPrice } from "../src/tools/getTokenPrice.js";
import { handleGetWalletBalance } from "../src/tools/getWalletBalance.js";
import { priceResolver } from "../src/lib/price/priceResolver.js";
import { PACIFIC_MAINNET_PRICE_FEEDS } from "../src/lib/price/feedRegistry.js";
import { activeTokenMap } from "../src/lib/constants.js";

const SEL_LATEST_ANSWER = "0x50d25bcd";
const SEL_LATEST_TIMESTAMP = "0x8205bf6a";
const SEL_BALANCE_OF = "0x70a08231";

const PROS_FEED = PACIFIC_MAINNET_PRICE_FEEDS.PROS.feedAddress.toLowerCase();
const USDC_FEED = PACIFIC_MAINNET_PRICE_FEEDS.USDC.feedAddress.toLowerCase();
const USDT_FEED = PACIFIC_MAINNET_PRICE_FEEDS.USDT.feedAddress.toLowerCase();
const BTC_FEED = PACIFIC_MAINNET_PRICE_FEEDS.BTC.feedAddress.toLowerCase();

const WALLET = "0x1111111111111111111111111111111111111111";

function hex256(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

type FeedBehavior =
  | { answer: bigint; updatedAt: bigint }
  | { httpStatus: number }
  | { networkFail: true };

interface MockConfig {
  feeds: Record<string, FeedBehavior>;
  nativeBalanceWei?: bigint;
  erc20Balances?: Record<string, bigint>;
}

interface LoggedRequest {
  url: string;
  method: string;
  to?: string;
  selector?: string;
}

function installRpcMock(cfg: MockConfig) {
  const realFetch = globalThis.fetch;
  const requests: LoggedRequest[] = [];

  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const urlStr = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));

    const reply = (req: { id: number; method: string; params?: unknown[] }) => {
      const call = (req.params?.[0] ?? {}) as { to?: string; data?: string };
      const to = call.to?.toLowerCase();
      const selector = call.data?.slice(0, 10);
      requests.push({ url: urlStr, method: req.method, to, selector });

      if (req.method === "eth_chainId") {
        return { jsonrpc: "2.0", id: req.id, result: "0x688" };
      }
      if (req.method === "eth_getBalance") {
        return { jsonrpc: "2.0", id: req.id, result: hex256(cfg.nativeBalanceWei ?? 0n) };
      }
      if (req.method === "eth_call" && to) {
        const feed = cfg.feeds[to];
        if (feed) {
          if ("httpStatus" in feed) throw { mockHttpStatus: feed.httpStatus };
          if ("networkFail" in feed) throw { mockNetworkFail: true };
          if (selector === SEL_LATEST_ANSWER) return { jsonrpc: "2.0", id: req.id, result: hex256(feed.answer) };
          if (selector === SEL_LATEST_TIMESTAMP) return { jsonrpc: "2.0", id: req.id, result: hex256(feed.updatedAt) };
        }
        if (selector === SEL_BALANCE_OF) {
          return { jsonrpc: "2.0", id: req.id, result: hex256(cfg.erc20Balances?.[to] ?? 0n) };
        }
      }
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `mock: unhandled ${req.method}` } };
    };

    try {
      const payload = Array.isArray(body) ? body.map(reply) : reply(body);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      const marker = err as { mockHttpStatus?: number; mockNetworkFail?: boolean };
      if (marker.mockHttpStatus) {
        return new Response("rate limited", { status: marker.mockHttpStatus });
      }
      throw new TypeError("fetch failed");
    }
  }) as typeof globalThis.fetch;

  return {
    requests,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

function nowSec(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

describe("get_token_price via PriceResolver", () => {
  beforeEach(() => priceResolver.clearCache());

  it("prices PROS from the live Chainlink feed", async () => {
    const mock = installRpcMock({
      feeds: { [PROS_FEED]: { answer: 998_700_000_000_000_000n, updatedAt: nowSec() - 60n } },
    });
    try {
      const result = await handleGetTokenPrice({ token: "PROS" });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.priceUsd.value, "0.998700");
      assert.strictEqual(data.provider, "chainlink-push");
      assert.strictEqual(data.feedAddress, PACIFIC_MAINNET_PRICE_FEEDS.PROS.feedAddress);
      assert.strictEqual(data.priceInPROS.value, "1.000000");
      assert.strictEqual(data.priceInPROSStatus, "identity");
      assert.strictEqual(data.sourceStatus, "ok");
      assert.strictEqual(data.feedStale, false);
      assert.strictEqual(data.cached, false);
      assert.strictEqual(data.pair, "PROS/USD");
      assert.strictEqual("routeAvailable" in data, false);
      assert.strictEqual("publicMode" in data, false);
    } finally {
      mock.restore();
    }
  });

  it("reads USDC from its oracle feed — never hardcoded to 1 USD", async () => {
    const mock = installRpcMock({
      feeds: {
        [USDC_FEED]: { answer: 999_300_000_000_000_000n, updatedAt: nowSec() - 30n },
        [PROS_FEED]: { answer: 500_000_000_000_000_000n, updatedAt: nowSec() - 30n },
      },
    });
    try {
      const result = await handleGetTokenPrice({ token: "USDC" });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.priceUsd.value, "0.999300");
      assert.notStrictEqual(data.priceUsd.value, "1.00");
      assert.strictEqual(data.priceInPROS.value, "1.998600"); // 0.9993 / 0.5, derived from the two USD feeds
      assert.strictEqual(data.priceInPROSStatus, "derived_from_usd_feeds");
    } finally {
      mock.restore();
    }
  });

  it("accepts WPROS as an alias of the PROS feed", async () => {
    const mock = installRpcMock({
      feeds: { [PROS_FEED]: { answer: 750_000_000_000_000_000n, updatedAt: nowSec() - 10n } },
    });
    try {
      const result = await handleGetTokenPrice({ token: "WPROS" });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.token, "WPROS");
      assert.strictEqual(data.canonicalSymbol, "PROS");
      assert.strictEqual(data.pair, "PROS/USD");
      assert.strictEqual(data.feedAddress, PACIFIC_MAINNET_PRICE_FEEDS.PROS.feedAddress);
      assert.strictEqual(data.assetType, "onchain_token"); // WPROS is a registry token on mainnet
    } finally {
      mock.restore();
    }
  });

  it("prices mainnet USDT as a feed-only asset (no on-chain registry token)", async () => {
    const mock = installRpcMock({
      feeds: {
        [USDT_FEED]: { answer: 1_000_200_000_000_000_000n, updatedAt: nowSec() - 15n },
        [PROS_FEED]: { answer: 500_000_000_000_000_000n, updatedAt: nowSec() - 15n },
      },
    });
    try {
      const result = await handleGetTokenPrice({ token: "USDT" });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.priceUsd.value, "1.0002");
      assert.strictEqual(data.assetType, "feed_only");
      assert.strictEqual(data.tokenRegistry, null);
    } finally {
      mock.restore();
    }
  });

  it("keeps priceUsd when only the derived priceInPROS leg fails", async () => {
    const mock = installRpcMock({
      feeds: {
        [BTC_FEED]: { answer: 65_000n * 10n ** 18n, updatedAt: nowSec() - 20n },
        [PROS_FEED]: { networkFail: true },
      },
    });
    try {
      const result = await handleGetTokenPrice({ token: "BTC" });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.priceUsd.value, "65000.0000");
      assert.strictEqual(data.priceInPROS.value, null);
      assert.strictEqual(data.priceInPROSStatus, "pros_feed_unavailable");
    } finally {
      mock.restore();
    }
  });

  it("returns structured PRICE_SOURCE_UNAVAILABLE on RPC failure — never TOOL_EXECUTION_FAILED", async () => {
    const mock = installRpcMock({ feeds: { [PROS_FEED]: { networkFail: true } } });
    try {
      const result = await handleGetTokenPrice({ token: "PROS" });
      assert.strictEqual(result.success, false);
      assert.ok(!result.success);
      assert.strictEqual(result.error.code, "PRICE_SOURCE_UNAVAILABLE");
      assert.strictEqual(result.error.retryable, true);
      assert.notStrictEqual(result.error.code, "TOOL_EXECUTION_FAILED");
    } finally {
      mock.restore();
    }
  });

  it("returns structured PRICE_SOURCE_RATE_LIMITED on RPC 429", async () => {
    const mock = installRpcMock({ feeds: { [PROS_FEED]: { httpStatus: 429 } } });
    try {
      const result = await handleGetTokenPrice({ token: "PROS" });
      assert.strictEqual(result.success, false);
      assert.ok(!result.success);
      assert.strictEqual(result.error.code, "PRICE_SOURCE_RATE_LIMITED");
      assert.strictEqual(result.error.retryable, true);
    } finally {
      mock.restore();
    }
  });
});

describe("get_wallet_balance with oracle valuation", () => {
  beforeEach(() => priceResolver.clearCache());

  const USDC_TOKEN = (activeTokenMap().USDC ?? "").toLowerCase();

  it("still returns balances when every price feed is unavailable", async () => {
    const mock = installRpcMock({
      feeds: { [PROS_FEED]: { networkFail: true }, [USDC_FEED]: { networkFail: true } },
      nativeBalanceWei: 2n * 10n ** 18n,
      erc20Balances: { [USDC_TOKEN]: 3_000_000n }, // 3 USDC at 6 decimals
    });
    try {
      const result = await handleGetWalletBalance({ walletAddress: WALLET });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.balances.PROS.balance.value, "2");
      assert.strictEqual(data.balances.USDC.balance.value, "3");
      assert.strictEqual(data.totalUsd.value, "0.0000");
      assert.strictEqual(data.prosPrice, null);
      assert.strictEqual(data.priceSourceStatus, "unavailable");
      assert.strictEqual(data.priceDetail.PROS, "unavailable");
      assert.strictEqual(data.priceDetail.USDC, "unavailable");
      assert.ok(mock.requests.every((r) => !r.url.includes("dodoex")), "DODO must never be called for pricing");
    } finally {
      mock.restore();
    }
  });

  it("values holdings with live feed prices (USDC not assumed 1:1)", async () => {
    const mock = installRpcMock({
      feeds: {
        [PROS_FEED]: { answer: 500_000_000_000_000_000n, updatedAt: nowSec() - 30n },
        [USDC_FEED]: { answer: 999_000_000_000_000_000n, updatedAt: nowSec() - 30n },
      },
      nativeBalanceWei: 2n * 10n ** 18n,
      erc20Balances: { [USDC_TOKEN]: 3_000_000n },
    });
    try {
      const result = await handleGetWalletBalance({ walletAddress: WALLET });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.balances.PROS.valueUsd.value, "1.0000"); // 2 × 0.5
      assert.strictEqual(data.balances.USDC.valueUsd.value, "2.9970"); // 3 × 0.999, not 3.0000
      assert.strictEqual(data.totalUsd.value, "3.9970");
      assert.strictEqual(data.prosPrice.value, "0.5000");
      assert.strictEqual(data.priceSourceStatus, "ok");
      assert.strictEqual(data.priceSource, "chainlink_push_feed");
    } finally {
      mock.restore();
    }
  });

  it("does not query price feeds for assets with zero balance", async () => {
    const mock = installRpcMock({
      feeds: { [PROS_FEED]: { answer: 500_000_000_000_000_000n, updatedAt: nowSec() - 30n } },
      nativeBalanceWei: 10n ** 18n,
      erc20Balances: {}, // zero USDC
    });
    try {
      const result = await handleGetWalletBalance({ walletAddress: WALLET });
      assert.strictEqual(result.success, true);
      const data = result.data as Record<string, any>;
      assert.strictEqual(data.priceDetail.USDC, "not_needed");
      const usdcFeedCalls = mock.requests.filter((r) => r.to === USDC_FEED);
      assert.strictEqual(usdcFeedCalls.length, 0, "zero-balance assets must not trigger oracle reads");
      const usdtFeedCalls = mock.requests.filter((r) => r.to === USDT_FEED);
      assert.strictEqual(usdtFeedCalls.length, 0, "unsupported/unheld USDT must not trigger oracle reads");
    } finally {
      mock.restore();
    }
  });
});
