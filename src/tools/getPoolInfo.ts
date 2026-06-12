// ─── Tool: get_pool_info ───────────────────────────────────────────────
// Fetches DODO/FaroSwap route-derived liquidity info for a token pair on
// Pharos Atlantic Testnet. API key is optional: public mode is tried first
// when DODO_API_KEY is not configured.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { resolveTokenAddress } from "../lib/dodoApi.js";
import { DODO_API_BASE, DODO_API_KEY, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { fetchWithTimeoutAndRetry } from "../lib/http.js";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";

export const getPoolInfoSchema = z.object({
  tokenA: z.enum(["PHRS", "USDC", "USDT"]).describe("First token in the pair"),
  tokenB: z.enum(["PHRS", "USDC", "USDT"]).describe("Second token in the pair"),
});

export type GetPoolInfoInput = z.input<typeof getPoolInfoSchema>;

export const getPoolInfoTool = {
  name: "get_pool_info",
  description:
    "Fetch DODO/FaroSwap route-derived liquidity info for a token pair on Pharos testnet. API key is optional; public mode is attempted first.",
  inputSchema: getPoolInfoSchema,
};

interface DodoPairResponse {
  data?: {
    list?: Array<{
      baseToken?: { symbol?: string; address?: string; price?: string };
      quoteToken?: { symbol?: string; address?: string; price?: string };
      baseLiquidity?: string;
      quoteLiquidity?: string;
      volume24h?: string;
      feeRate?: string;
      type?: string;
      pairAddress?: string;
    }>;
  };
}

function addOptionalApiKey(url: URL): boolean {
  const key = DODO_API_KEY?.trim();
  if (!key) return false;
  url.searchParams.set("apikey", key);
  return true;
}

function isAuthErrorStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export async function handleGetPoolInfo(raw: GetPoolInfoInput) {
  const input = getPoolInfoSchema.parse(raw);

  if (input.tokenA === input.tokenB) {
    return fail("INVALID_PAIR", "Cannot query pool for identical tokens.", false, "get_pool_info");
  }

  try {
    const addrA = resolveTokenAddress(input.tokenA);
    const addrB = resolveTokenAddress(input.tokenB);

    const routeUrl = new URL(`${DODO_API_BASE}/route-service/v2/widget/getdodoroute`);
    routeUrl.searchParams.set("chainId", String(CHAIN_ID));
    routeUrl.searchParams.set("fromTokenAddress", addrA);
    routeUrl.searchParams.set("toTokenAddress", addrB);
    routeUrl.searchParams.set("fromAmount", "1000000000000000000");
    routeUrl.searchParams.set("userAddr", "0x0000000000000000000000000000000000000001");
    routeUrl.searchParams.set("slippage", "3");
    routeUrl.searchParams.set("source", "dodoV2AndMixWasm");
    routeUrl.searchParams.set("estimateGas", "true");
    const routeUsedApiKey = addOptionalApiKey(routeUrl);

    const routeResponse = await fetchWithTimeoutAndRetry(routeUrl, { timeoutMs: 10_000, retries: 2, retryDelayMs: 300 });
    if (isAuthErrorStatus(routeResponse.status)) {
      return fail(
        "DODO_API_AUTH_REQUIRED",
        "DODO/FaroSwap route API rejected public mode. Configure DODO_API_KEY only if this endpoint requires authenticated access.",
        false,
        "dodo_api"
      );
    }
    if (!routeResponse.ok) {
      return fail("DODO_API_UNAVAILABLE", `DODO route API returned ${routeResponse.status} ${routeResponse.statusText}.`, true, "dodo_api");
    }

    const routeJson = (await routeResponse.json()) as {
      status: number;
      message?: string;
      data: {
        resAmount?: string | number;
        priceImpact?: string | number;
        baseFeeAmount?: string | number;
        targetDecimals?: number;
        resPricePerFromToken?: string | number;
        resPricePerToToken?: string | number;
      } | null;
    };

    if (!routeJson.data || routeJson.status !== 200) {
      const msg = (routeJson.message || "").toLowerCase();
      if (msg.includes("api key") || msg.includes("apikey") || msg.includes("unauthorized") || msg.includes("forbidden")) {
        return fail(
          "DODO_API_AUTH_REQUIRED",
          "DODO/FaroSwap route API rejected public mode. Configure DODO_API_KEY only if this endpoint requires authenticated access.",
          false,
          "dodo_api"
        );
      }
      return ok({
        pair: `${input.tokenA}/${input.tokenB}`,
        available: false,
        message: "No active DODO/FaroSwap route found for this pair on Pharos testnet.",
        source: "DODO/FaroSwap public route API",
        sourceStatus: "no_route_available",
        publicMode: !routeUsedApiKey,
        chainId: CHAIN_ID,
        environment: PHAROS_ENVIRONMENT,
        isMainnet: false,
      });
    }

    const d = routeJson.data;
    const resAmount = parseFloat(String(d.resAmount || "0"));
    const priceImpact = parseFloat(String(d.priceImpact || "0"));
    const fee = parseFloat(String(d.baseFeeAmount || "0"));
    const pricePerFrom = parseFloat(String(d.resPricePerFromToken || "0"));
    const pricePerTo = parseFloat(String(d.resPricePerToToken || "0"));

    let liquidityInfo: { baseLiquidity: string; quoteLiquidity: string; poolType: string } | null = null;
    let poolListStatus = "unavailable";
    try {
      const poolsUrl = new URL(`${DODO_API_BASE}/dodo-pair/list`);
      poolsUrl.searchParams.set("chainId", String(CHAIN_ID));
      poolsUrl.searchParams.set("baseToken", addrA);
      poolsUrl.searchParams.set("quoteToken", addrB);
      addOptionalApiKey(poolsUrl);

      const poolsResp = await fetchWithTimeoutAndRetry(poolsUrl, { timeoutMs: 10_000, retries: 1, retryDelayMs: 300 });
      if (poolsResp.ok) {
        const poolsJson = (await poolsResp.json()) as DodoPairResponse;
        if (poolsJson.data?.list && poolsJson.data.list.length > 0) {
          const pool = poolsJson.data.list[0];
          liquidityInfo = {
            baseLiquidity: pool.baseLiquidity || "unknown",
            quoteLiquidity: pool.quoteLiquidity || "unknown",
            poolType: pool.type || "unknown",
          };
          poolListStatus = "ok";
        } else {
          poolListStatus = "empty";
        }
      } else if (isAuthErrorStatus(poolsResp.status)) {
        poolListStatus = "auth_required";
      }
    } catch {
      poolListStatus = "unavailable";
    }

    return ok({
      pair: `${input.tokenA}/${input.tokenB}`,
      available: true,
      priceRatio: resAmount > 0 ? { value: resAmount.toString(), unit: input.tokenB, per: `1 ${input.tokenA}` } : null,
      priceImpact: { value: priceImpact.toFixed(4), unit: "percent" },
      pricePerFromToken: pricePerFrom > 0 ? { value: pricePerFrom.toFixed(6), unit: input.tokenB } : null,
      pricePerToToken: pricePerTo > 0 ? { value: pricePerTo.toFixed(6), unit: input.tokenA } : null,
      fee: fee > 0 ? { value: fee.toString(), unit: "raw" } : null,
      liquidity: liquidityInfo,
      poolListStatus,
      source: "DODO/FaroSwap public route API",
      sourceStatus: "ok",
      publicMode: !routeUsedApiKey,
      routeAvailable: true,
      confidence: liquidityInfo ? "medium" : "low",
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INVALID_TOKEN_ADDRESS")) {
      return fail("INVALID_TOKEN_ADDRESS", message, false, "get_pool_info");
    }
    return classifyExternalError("dodo_api", err);
  }
}
