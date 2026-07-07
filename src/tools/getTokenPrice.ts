// ─── Tool: get_token_price ─────────────────────────────────────────────
// Fetches token price from DODO/FaroSwap route quotes.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { getDodoRoute } from "../lib/dodoApi.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, PROS_ADDRESS, activeTokenMap, activeTokenRegistry } from "../lib/constants.js";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";

export const getTokenPriceSchema = z.object({
  token: z.enum(["PROS", "USDC", "USDT"]).describe("Token to get price for"),
});

export type GetTokenPriceInput = z.input<typeof getTokenPriceSchema>;

export const getTokenPriceTool = {
  name: "get_token_price",
  description:
    "Fetch real-time price of PROS, USDC, or configured stable tokens on Pharos using DODO/FaroSwap liquidity quotes.",
  inputSchema: getTokenPriceSchema,
};

// Read-only address for price quotes (never signs transactions)
const QUOTE_WALLET = "0x0000000000000000000000000000000000000001";

function registryEntry(symbol: "PROS" | "USDC" | "USDT") {
  const registry = activeTokenRegistry();
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
  return registry[symbol] ?? null;
}

function ensureSupported(symbol: "PROS" | "USDC" | "USDT") {
  const map = activeTokenMap();
  return symbol === "PROS" || Boolean(map[symbol]);
}

export async function handleGetTokenPrice(raw: GetTokenPriceInput) {
  const input = getTokenPriceSchema.parse(raw);

  if (!ensureSupported(input.token)) {
    return fail(
      "UNSUPPORTED_TOKEN",
      `${input.token} is not configured for ${PHAROS_ENVIRONMENT} (${CHAIN_ID}). No quote was requested against a fallback/testnet address.`,
      false,
      "get_token_price"
    );
  }

  try {
    if (input.token === "USDC") {
      const quote = await getDodoRoute({
        fromToken: "USDC",
        toToken: "PROS",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });

      return ok({
        token: "USDC",
        tokenRegistry: registryEntry("USDC"),
        priceUsd: { value: "1.00", unit: "USD" },
        priceInPROS: {
          value: quote.routeAvailable ? parseFloat(quote.amountOut).toFixed(6) : null,
          unit: "PROS",
        },
        source: "DODO Route API / FaroSwap liquidity on Pharos",
        sourceStatus: quote.sourceStatus,
        routeAvailable: quote.routeAvailable,
        publicMode: !quote.usedApiKey,
        confidence: quote.routeAvailable ? "medium" : "low",
        chainId: CHAIN_ID,
        environment: PHAROS_ENVIRONMENT,
        isMainnet: IS_MAINNET,
      });
    }

    if (input.token === "USDT") {
      const usdQuote = await getDodoRoute({
        fromToken: "USDT",
        toToken: "USDC",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });

      const prosQuote = await getDodoRoute({
        fromToken: "USDT",
        toToken: "PROS",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });

      return ok({
        token: "USDT",
        tokenRegistry: registryEntry("USDT"),
        priceUsd: {
          value: usdQuote.routeAvailable ? parseFloat(usdQuote.amountOut).toFixed(4) : "~1.00",
          unit: "USD",
        },
        priceInPROS: {
          value: prosQuote.routeAvailable ? parseFloat(prosQuote.amountOut).toFixed(6) : null,
          unit: "PROS",
        },
        source: "DODO Route API / FaroSwap liquidity on Pharos",
        sourceStatus: usdQuote.routeAvailable && prosQuote.routeAvailable ? "ok" : usdQuote.routeAvailable || prosQuote.routeAvailable ? "partial" : "no_route_available",
        routeAvailable: usdQuote.routeAvailable || prosQuote.routeAvailable,
        publicMode: !usdQuote.usedApiKey && !prosQuote.usedApiKey,
        confidence: usdQuote.routeAvailable && prosQuote.routeAvailable ? "medium" : "low",
        chainId: CHAIN_ID,
        environment: PHAROS_ENVIRONMENT,
        isMainnet: IS_MAINNET,
      });
    }

    const usdcQuote = await getDodoRoute({
      fromToken: "PROS",
      toToken: "USDC",
      amountHuman: "1",
      walletAddress: QUOTE_WALLET,
    });

    if (!usdcQuote.routeAvailable) {
      return fail("NO_ROUTE_AVAILABLE", "No PROS -> USDC route is available for price discovery.", true, "dodo_api");
    }

    return ok({
      token: "PROS",
      tokenRegistry: registryEntry("PROS"),
      priceUsd: { value: parseFloat(usdcQuote.amountOut).toFixed(4), unit: "USD" },
      priceInPROS: { value: "1.000000", unit: "PROS" },
      source: "DODO Route API / FaroSwap liquidity on Pharos",
      sourceStatus: usdcQuote.sourceStatus,
      routeAvailable: true,
      publicMode: !usdcQuote.usedApiKey,
      confidence: "medium",
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DODO_API_AUTH_REQUIRED")) {
      return fail(
        "DODO_API_AUTH_REQUIRED",
        "DODO/FaroSwap route API rejected public mode. Configure DODO_API_KEY only if this endpoint requires authenticated access.",
        false,
        "dodo_api"
      );
    }
    if (message.includes("DODO_API_RATE_LIMITED")) {
      return fail("DODO_API_RATE_LIMITED", message, true, "dodo_api");
    }
    if (message.includes("INVALID_TOKEN_ADDRESS")) {
      return fail("INVALID_TOKEN_ADDRESS", message, false, "dodo_api");
    }
    return classifyExternalError("dodo_api", err);
  }
}
