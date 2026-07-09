// ─── Price Feed Registry ───────────────────────────────────────────────
// Network-keyed oracle feed configuration. Feed addresses/decimals/heartbeats
// are static config; prices are ALWAYS read live from the feed contracts.
// ────────────────────────────────────────────────────────────────────────

import { getActiveNetwork } from "../networks.js";
import type { PriceFeedConfig } from "./types.js";

const CHAINLINK_PUSH_DOCS = "Chainlink Push Engine Feeds on Pharos Pacific Mainnet (docs.pharos.xyz)";

function pushFeed(base: string, feedAddress: `0x${string}`): PriceFeedConfig {
  return {
    pair: `${base}/USD`,
    base,
    quote: "USD",
    feedAddress,
    decimals: 18,
    heartbeatSeconds: 3600,
    provider: "chainlink-push",
    docsSource: CHAINLINK_PUSH_DOCS,
  };
}

/** Pacific Mainnet (1672) Chainlink Push Engine feeds. */
export const PACIFIC_MAINNET_PRICE_FEEDS: Record<string, PriceFeedConfig> = {
  PROS: pushFeed("PROS", "0x9356C87a48F913d11C87a0d4b8cD16CD04624BF3"),
  BTC: pushFeed("BTC", "0x6BFcd14b164de6c8C4dA2d065d511055A589EB20"),
  ETH: pushFeed("ETH", "0x092ff0175Be8B2e83Ca5740d3EB13C6225901fa7"),
  WBTC: pushFeed("WBTC", "0x22E1db75084B7f0393896bc7046E64eFdC34b729"),
  USDT: pushFeed("USDT", "0x84B06e38C70DD1f0039bA25E017CAe7cFcDE53b0"),
  USDC: pushFeed("USDC", "0x8d08eA83A55ad1e805b5660F5eC76C99C6aF5eaf"),
  LINK: pushFeed("LINK", "0xCb87D7B02AC34B0aC5C3472467AB67E1de655C0A"),
  BNB: pushFeed("BNB", "0x2eaB341Db05503c73A1274f1EFbD5d4560767229"),
  SOL: pushFeed("SOL", "0x9c9FccaEf0851298321B813Ce2530c67e20F9C10"),
  XRP: pushFeed("XRP", "0x43CeBa953FF0165840f35342F6a6Bc1B923bc5FF"),
};

/** No published Push Engine feed addresses for Atlantic testnet — fail closed. */
export const ATLANTIC_TESTNET_PRICE_FEEDS: Record<string, PriceFeedConfig> = {};

/**
 * Wrapped/native aliases → canonical feed key. WBTC is NOT aliased to BTC:
 * a dedicated WBTC/USD feed exists on Pacific Mainnet.
 */
export const PRICE_FEED_ALIASES: Record<string, string> = {
  WPROS: "PROS",
  WETH: "ETH",
  // Pharos is the network/ecosystem; PROS is the token. Priced via the PROS/USD
  // feed. Matches supported-assets.json + the Anvita engine.
  PHAROS: "PROS",
};

export function activePriceFeeds(): Record<string, PriceFeedConfig> {
  return getActiveNetwork().isMainnet ? PACIFIC_MAINNET_PRICE_FEEDS : ATLANTIC_TESTNET_PRICE_FEEDS;
}

export interface FeedLookup {
  requested: string;
  canonical: string;
  aliased: boolean;
  feed: PriceFeedConfig;
}

/** Case-insensitive symbol → feed lookup with alias mapping; null if not configured for the active network. */
export function resolveFeedSymbol(symbol: string): FeedLookup | null {
  const requested = symbol.trim().toUpperCase();
  const canonical = PRICE_FEED_ALIASES[requested] ?? requested;
  const feed = activePriceFeeds()[canonical];
  if (!feed) return null;
  return { requested, canonical, aliased: canonical !== requested, feed };
}

/** Symbols the active network can price (canonical feeds + configured aliases). */
export function pricedSymbolsForActiveNetwork(): string[] {
  const canonical = Object.keys(activePriceFeeds());
  const aliases = Object.entries(PRICE_FEED_ALIASES)
    .filter(([, target]) => canonical.includes(target))
    .map(([alias]) => alias);
  return [...canonical, ...aliases].sort();
}
