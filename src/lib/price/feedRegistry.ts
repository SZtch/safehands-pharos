// ─── Price Feed Registry ───────────────────────────────────────────────
// Network-keyed oracle feed configuration. Feed addresses/decimals/heartbeats
// are static config; prices are ALWAYS read live from the feed contracts.
// ────────────────────────────────────────────────────────────────────────

import { getActiveNetwork } from "../networks.js";
import { ECOSYSTEM_REGISTRY_ITEMS } from "../../data/ecosystemRegistry.data.js";
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

/**
 * Pacific Mainnet (1672) Chainlink Push Engine feeds — derived from the
 * canonical ecosystem registry (src/data/ecosystemRegistry.data.ts) so the
 * price resolver and the Anvita hosted-skill assets share one feed set.
 */
export const PACIFIC_MAINNET_PRICE_FEEDS: Record<string, PriceFeedConfig> = (() => {
  const item = ECOSYSTEM_REGISTRY_ITEMS.find((i) => i.id === "oracle:pacific-mainnet:chainlink-push-feeds");
  const feeds: Record<string, PriceFeedConfig> = {};
  for (const c of item?.contracts ?? []) {
    if (c.symbol) feeds[c.symbol] = pushFeed(c.symbol, c.address);
  }
  return feeds;
})();

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
