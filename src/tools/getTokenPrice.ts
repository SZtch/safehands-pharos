// ─── Tool: get_token_price ─────────────────────────────────────────────
// Fetches testnet token price from DODO/FaroSwap route quotes.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { getDodoRoute } from "../lib/dodoApi.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, TOKEN_REGISTRY } from "../lib/constants.js";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";

export const getTokenPriceSchema = z.object({
  token: z.enum(["PHRS", "USDC", "USDT"]).describe("Token to get price for"),
});

export type GetTokenPriceInput = z.input<typeof getTokenPriceSchema>;

export const getTokenPriceTool = {
  name: "get_token_price",
  description:
    "Fetch real-time testnet price of PHRS, USDC, or USDT on Pharos using DODO/FaroSwap liquidity quotes.",
  inputSchema: getTokenPriceSchema,
};

// Read-only address for price quotes (never signs transactions)
const QUOTE_WALLET = "0x0000000000000000000000000000000000000001";

export async function handleGetTokenPrice(raw: GetTokenPriceInput) {
  const input = getTokenPriceSchema.parse(raw);

  try {
    if (input.token === "USDC") {
      const quote = await getDodoRoute({
        fromToken: "USDC",
        toToken: "PHRS",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });

      return ok({
        token: "USDC",
        tokenRegistry: TOKEN_REGISTRY.USDC,
        priceUsd: { value: "1.00", unit: "USD" },
        priceInPHRS: {
          value: quote.routeAvailable ? parseFloat(quote.amountOut).toFixed(6) : null,
          unit: "PHRS",
        },
        source: "DODO Route API / FaroSwap liquidity on Pharos testnet",
        sourceStatus: quote.sourceStatus,
        routeAvailable: quote.routeAvailable,
        publicMode: !quote.usedApiKey,
        confidence: quote.routeAvailable ? "medium" : "low",
        chainId: CHAIN_ID,
        environment: PHAROS_ENVIRONMENT,
        isMainnet: false,
      });
    }

    if (input.token === "USDT") {
      const usdQuote = await getDodoRoute({
        fromToken: "USDT",
        toToken: "USDC",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });

      const phrsQuote = await getDodoRoute({
        fromToken: "USDT",
        toToken: "PHRS",
        amountHuman: "1",
        walletAddress: QUOTE_WALLET,
      });

      return ok({
        token: "USDT",
        tokenRegistry: TOKEN_REGISTRY.USDT,
        priceUsd: {
          value: usdQuote.routeAvailable ? parseFloat(usdQuote.amountOut).toFixed(4) : "~1.00",
          unit: "USD",
        },
        priceInPHRS: {
          value: phrsQuote.routeAvailable ? parseFloat(phrsQuote.amountOut).toFixed(6) : null,
          unit: "PHRS",
        },
        source: "DODO Route API / FaroSwap liquidity on Pharos testnet",
        sourceStatus: usdQuote.routeAvailable && phrsQuote.routeAvailable ? "ok" : usdQuote.routeAvailable || phrsQuote.routeAvailable ? "partial" : "no_route_available",
        routeAvailable: usdQuote.routeAvailable || phrsQuote.routeAvailable,
        publicMode: !usdQuote.usedApiKey && !phrsQuote.usedApiKey,
        confidence: usdQuote.routeAvailable && phrsQuote.routeAvailable ? "medium" : "low",
        chainId: CHAIN_ID,
        environment: PHAROS_ENVIRONMENT,
        isMainnet: false,
      });
    }

    const usdcQuote = await getDodoRoute({
      fromToken: "PHRS",
      toToken: "USDC",
      amountHuman: "1",
      walletAddress: QUOTE_WALLET,
    });

    if (!usdcQuote.routeAvailable) {
      return fail("NO_ROUTE_AVAILABLE", "No PHRS -> USDC route is available for price discovery.", true, "dodo_api");
    }

    return ok({
      token: "PHRS",
      tokenRegistry: TOKEN_REGISTRY.PHRS,
      priceUsd: { value: parseFloat(usdcQuote.amountOut).toFixed(4), unit: "USD" },
      priceInPHRS: { value: "1.000000", unit: "PHRS" },
      source: "DODO Route API / FaroSwap liquidity on Pharos testnet",
      sourceStatus: usdcQuote.sourceStatus,
      routeAvailable: true,
      publicMode: !usdcQuote.usedApiKey,
      confidence: "medium",
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: false,
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
