// ─── Tool: get_token_price ─────────────────────────────────────────────
// Canonical USD prices from the provider-based PriceResolver (Chainlink Push
// Engine feeds on Pharos). DODO/FaroSwap is swap route/execution quoting only
// and is never used as a price oracle here.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, PROS_ADDRESS, activeTokenRegistry } from "../lib/constants.js";
import { resolvePriceUsd } from "../lib/price/priceResolver.js";
import { errorMessage, fail, ok, productionSafeMessage } from "../lib/toolResponse.js";

export const PRICE_TOKEN_SYMBOLS = [
  "PROS",
  "WPROS",
  "USDC",
  "USDT",
  "ETH",
  "WETH",
  "BTC",
  "WBTC",
  "LINK",
  "BNB",
  "SOL",
  "XRP",
] as const;

export const getTokenPriceSchema = z.object({
  token: z.enum(PRICE_TOKEN_SYMBOLS).describe("Token/asset to get the USD price for"),
});

export type GetTokenPriceInput = z.input<typeof getTokenPriceSchema>;

export const getTokenPriceTool = {
  name: "get_token_price",
  description:
    "Fetch the live USD price of a token/asset on Pharos from Chainlink Push Engine feeds read on-chain via eth_call (heartbeat-staleness checked; a stale feed is reported, never quoted as current). Supported: PROS, WPROS, USDC, USDT, ETH, WETH, BTC, WBTC, LINK, BNB, SOL, XRP.",
  inputSchema: getTokenPriceSchema,
};

function registryEntry(symbol: string) {
  if (symbol === "PROS") {
    return {
      symbol: "PROS",
      name: "Native PROS",
      address: PROS_ADDRESS,
      decimals: 18,
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
      purpose: "native PROS sentinel address for route APIs",
    };
  }
  return activeTokenRegistry()[symbol] ?? null;
}

function formatUsdDisplay(value: number): string {
  return value >= 1 ? value.toFixed(4) : value.toPrecision(6);
}

export async function handleGetTokenPrice(raw: GetTokenPriceInput) {
  const input = getTokenPriceSchema.parse(raw);

  try {
    const result = await resolvePriceUsd(input.token);
    if (!result.ok) {
      if (result.error.code === "PRICE_FEED_NOT_CONFIGURED") {
        return fail("UNSUPPORTED_TOKEN", result.error.message, false, "get_token_price");
      }
      return fail(
        result.error.code,
        productionSafeMessage(result.error.message),
        result.error.retryable,
        "chainlink_push_feed"
      );
    }
    const r = result.resolution;

    // priceInPROS is derived from the two USD feeds; its failure never fails
    // the whole call — priceUsd remains the canonical answer.
    let priceInProsValue: string | null = null;
    let priceInPROSStatus: "identity" | "derived_from_usd_feeds" | "pros_feed_unavailable";
    if (r.canonicalSymbol === "PROS") {
      priceInProsValue = "1.000000";
      priceInPROSStatus = "identity";
    } else {
      const prosResult = await resolvePriceUsd("PROS");
      if (prosResult.ok && prosResult.resolution.priceUsdNumber > 0) {
        priceInProsValue = (r.priceUsdNumber / prosResult.resolution.priceUsdNumber).toFixed(6);
        priceInPROSStatus = "derived_from_usd_feeds";
      } else {
        priceInPROSStatus = "pros_feed_unavailable";
      }
    }

    const tokenRegistry = registryEntry(input.token);
    return ok({
      token: input.token,
      canonicalSymbol: r.canonicalSymbol,
      pair: r.pair,
      assetType: tokenRegistry ? "onchain_token" : "feed_only",
      tokenRegistry,
      priceUsd: { value: formatUsdDisplay(r.priceUsdNumber), unit: "USD" },
      priceInPROS: { value: priceInProsValue, unit: "PROS" },
      priceInPROSStatus,
      provider: r.provider,
      feedAddress: r.feedAddress,
      source: r.source,
      sourceStatus: r.sourceStatus,
      confidence: r.confidence,
      timestamp: r.timestamp,
      feedAgeSeconds: r.feedAgeSeconds,
      feedStale: r.feedStale,
      heartbeatSeconds: r.heartbeatSeconds,
      cached: r.cached,
      cacheAgeSeconds: r.cacheAgeSeconds,
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
    });
  } catch (err) {
    // The resolver never throws for price-source failures — this catch only
    // covers genuine programming errors.
    return fail("TOOL_EXECUTION_FAILED", productionSafeMessage(errorMessage(err)), false, "get_token_price");
  }
}
