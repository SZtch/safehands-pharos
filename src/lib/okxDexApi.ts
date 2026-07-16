// ─── OKX DEX Aggregator API Client ─────────────────────────────────────
// Fetches swap quotes and executable calldata from the OKX DEX aggregator
// (Classic Swap API v6).
//
// CHAIN SUPPORT IS EVIDENCE-GATED. OKX's own supported-chains docs list Pharos
// with chainIndex 1672 and Trade capability, and both the aggregation router
// and the token-approve contract are registry-verified from OKX's dev docs
// plus on-chain bytecode checks (protocol:pacific-mainnet:okx-dex). Pacific
// Mainnet (1672) is therefore the only chain in the default supported set;
// quote fetches on any other chain fail closed with a structured
// SWAP_LIQUIDITY_NOT_CONFIGURED error. Override via OKX_API_SUPPORTED_CHAIN_IDS
// only with evidence the OKX API actually serves that chain.
//
// AUTH: every request is signed per OKX's REST authentication scheme:
//   OK-ACCESS-SIGN = Base64(HMAC-SHA256(timestamp + method + requestPath, secret))
// where requestPath INCLUDES the query string. Credentials come from env at
// call time (OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE, optional
// OKX_API_PROJECT_ID for the OK-ACCESS-PROJECT header) and are never logged
// or echoed into error messages. Missing credentials fail closed BEFORE any
// network call with OKX_API_CREDENTIALS_MISSING.
// ────────────────────────────────────────────────────────────────────────

import { createHmac } from "node:crypto";
import { isAddress } from "viem";
import {
  OKX_API_BASE,
  OKX_SWAP_ENDPOINT,
  OKX_DEX_APPROVE_ADDRESS,
  okxApiCredentials,
  CHAIN_ID,
} from "./constants.js";
import { fetchWithTimeoutAndRetry } from "./http.js";
import { resolveTokenAddress, resolveTokenDecimals, resolveAutoSlippage, toWei, fromWei } from "./dodoApi.js";

// ─── Types ─────────────────────────────────────────────────────────────

export interface OkxSwapApiResponse {
  code: string;
  msg?: string;
  data: Array<{
    routerResult?: {
      fromTokenAmount?: string | number;
      toTokenAmount?: string | number;
      priceImpactPercent?: string | number;
      estimateGasFee?: string | number;
    };
    tx?: {
      to?: string;
      data?: string;
      value?: string | number;
      gas?: string | number;
      minReceiveAmount?: string | number;
    };
  }> | null;
}

/** Structurally compatible with DodoQuote for every field execute_swap reads. */
export interface OkxQuote {
  amountOut: string;
  amountOutWei: string;
  priceImpact: number;
  gasLimit: string;
  value: string;
  calldata: string;
  to: string;
  approveAddress: string;
  routeAvailable: boolean;
  sourceStatus: "ok" | "no_route_available" | "auth_required" | "unavailable";
  usedFromToken: string;
  usedToToken: string;
  wasSubstituted: boolean;
  substitutionNote?: string;
  /** Aggregator-enforced minimum output after slippage, in smallest units. */
  minReceiveAmountWei: string;
  rawResponse: OkxSwapApiResponse;
}

// ─── Errors ────────────────────────────────────────────────────────────

/**
 * Structured "provider not configured for this chain" failure. Callers must
 * surface this as SWAP_LIQUIDITY_NOT_CONFIGURED: a permanent configuration
 * state, not a transient provider outage.
 */
export class OkxNotConfiguredError extends Error {
  readonly code = "SWAP_LIQUIDITY_NOT_CONFIGURED" as const;
  constructor(chainId: number) {
    super(
      `SWAP_LIQUIDITY_NOT_CONFIGURED: the OKX DEX aggregator API is not a verified provider for chainId ${chainId}. ` +
        `Swap liquidity and route quotes cannot be served on this network via the okx venue. ` +
        `Verified chains: ${okxApiSupportedChainIds().join(", ") || "none"} (override with OKX_API_SUPPORTED_CHAIN_IDS only with evidence of support).`
    );
    this.name = "OkxNotConfiguredError";
  }
}

/**
 * Structured "credentials not configured" failure raised BEFORE any network
 * call. Lists only the missing env var NAMES, never any credential value.
 */
export class OkxCredentialsMissingError extends Error {
  readonly code = "OKX_API_CREDENTIALS_MISSING" as const;
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `OKX_API_CREDENTIALS_MISSING: the okx swap venue requires signed API access. ` +
        `Missing environment variables: ${missing.join(", ")}. ` +
        `Create an API key in the OKX web3 developer portal and set OKX_API_KEY, OKX_API_SECRET, and OKX_API_PASSPHRASE (plus OKX_API_PROJECT_ID if your project requires it).`
    );
    this.name = "OkxCredentialsMissingError";
    this.missing = missing;
  }
}

// ─── Chain gating ──────────────────────────────────────────────────────

/**
 * Chains the OKX DEX aggregator API is treated as configured for. Defaults to
 * Pacific Mainnet (1672) only: OKX's supported-chains docs list Pharos with
 * chainIndex 1672, and no Pharos testnet is listed. Any other chain fails
 * closed until an operator opts in via OKX_API_SUPPORTED_CHAIN_IDS with
 * evidence the API supports it.
 */
export function okxApiSupportedChainIds(): number[] {
  const raw = process.env.OKX_API_SUPPORTED_CHAIN_IDS;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return [1672];
}

export function isOkxApiConfiguredForChain(chainId: number = CHAIN_ID): boolean {
  return okxApiSupportedChainIds().includes(chainId);
}

// ─── Request signing (pure, exported for tests) ────────────────────────

/**
 * Computes the OK-ACCESS-SIGN header value: Base64(HMAC-SHA256(prehash, secret))
 * with prehash = timestamp + method + requestPath (+ body for POST). The
 * requestPath must include the query string.
 */
export function signOkxRequest(params: {
  timestamp: string;
  method: "GET" | "POST";
  requestPath: string;
  body?: string;
  secret: string;
}): string {
  const prehash = `${params.timestamp}${params.method}${params.requestPath}${params.body ?? ""}`;
  return createHmac("sha256", params.secret).update(prehash).digest("base64");
}

/**
 * Builds the v6 swap request path (endpoint + query string) in a fixed
 * parameter order so the signed string is deterministic and testable.
 */
export function buildOkxSwapRequestPath(params: {
  chainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  amountWei: string;
  userWalletAddress: string;
  slippagePercent: number;
}): string {
  const query = new URLSearchParams();
  query.set("chainIndex", String(params.chainId));
  query.set("fromTokenAddress", params.fromTokenAddress);
  query.set("toTokenAddress", params.toTokenAddress);
  query.set("amount", params.amountWei);
  query.set("userWalletAddress", params.userWalletAddress);
  query.set("slippagePercent", String(params.slippagePercent));
  query.set("swapMode", "exactIn");
  return `${OKX_SWAP_ENDPOINT}?${query.toString()}`;
}

// ─── Quote fetch ───────────────────────────────────────────────────────

function emptyQuote(
  sourceStatus: OkxQuote["sourceStatus"],
  usedFromToken: string,
  usedToToken: string,
  rawResponse: OkxSwapApiResponse
): OkxQuote {
  return {
    amountOut: "0",
    amountOutWei: "0",
    priceImpact: 100,
    gasLimit: "0",
    value: "0",
    calldata: "0x",
    to: "",
    approveAddress: "",
    routeAvailable: false,
    sourceStatus,
    usedFromToken,
    usedToToken,
    wasSubstituted: false,
    minReceiveAmountWei: "0",
    rawResponse,
  };
}

/**
 * Fetches an executable swap quote from the OKX DEX aggregator. The returned
 * `to`/`calldata` come from the aggregator and MUST still be contained by the
 * caller against the OKX router allowlist; the approve address is the
 * registry-verified OKX token-approve contract (OKX's approval model always
 * targets that dedicated contract; the swap response itself does not carry a
 * spender field).
 */
export async function getOkxSwapQuote(params: {
  fromToken: string;
  toToken: string;
  amountHuman: string;
  walletAddress: string;
  slippage?: number;
}): Promise<OkxQuote> {
  if (!isOkxApiConfiguredForChain(CHAIN_ID)) {
    throw new OkxNotConfiguredError(CHAIN_ID);
  }

  const creds = okxApiCredentials();
  if (!creds.ok) {
    throw new OkxCredentialsMissingError(creds.missing);
  }

  if (!isAddress(params.walletAddress)) {
    throw new Error(`INVALID_WALLET_ADDRESS: ${params.walletAddress}`);
  }

  const fromAddress = resolveTokenAddress(params.fromToken);
  const toAddress = resolveTokenAddress(params.toToken);
  const fromDecimals = resolveTokenDecimals(params.fromToken);
  const toDecimals = resolveTokenDecimals(params.toToken);
  const amountWei = toWei(params.amountHuman, fromDecimals);
  const slippagePercent = params.slippage ?? resolveAutoSlippage(params.fromToken, params.toToken);

  const requestPath = buildOkxSwapRequestPath({
    chainId: CHAIN_ID,
    fromTokenAddress: fromAddress,
    toTokenAddress: toAddress,
    amountWei,
    userWalletAddress: params.walletAddress,
    slippagePercent,
  });

  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": creds.credentials.apiKey,
    "OK-ACCESS-SIGN": signOkxRequest({ timestamp, method: "GET", requestPath, secret: creds.credentials.apiSecret }),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": creds.credentials.passphrase,
  };
  if (creds.credentials.projectId) {
    headers["OK-ACCESS-PROJECT"] = creds.credentials.projectId;
  }

  const response = await fetchWithTimeoutAndRetry(`${OKX_API_BASE}${requestPath}`, {
    timeoutMs: 10_000,
    retries: 2,
    retryDelayMs: 300,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("OKX_API_AUTH_REQUIRED: the OKX DEX API rejected the configured credentials. Verify OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE (and OKX_API_PROJECT_ID if required) in the OKX web3 developer portal.");
    }
    if (response.status === 429) {
      throw new Error(`OKX_API_RATE_LIMITED: ${response.status} ${response.statusText}`);
    }
    throw new Error(`OKX_API_UNAVAILABLE: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as OkxSwapApiResponse;

  if (json.code !== "0" || !Array.isArray(json.data) || json.data.length === 0) {
    const message = (json.msg || "").toLowerCase();
    if (message.includes("api key") || message.includes("apikey") || message.includes("signature") || message.includes("passphrase") || message.includes("unauthorized") || message.includes("forbidden")) {
      throw new Error("OKX_API_AUTH_REQUIRED: the OKX DEX API rejected the configured credentials. Verify OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE (and OKX_API_PROJECT_ID if required) in the OKX web3 developer portal.");
    }
    return emptyQuote("no_route_available", fromAddress, toAddress, json);
  }

  const entry = json.data[0];
  const tx = entry.tx;
  const routerResult = entry.routerResult;

  // Fail closed on a malformed "success": a quote without an executable
  // target and calldata is not tradable, whatever the response code says.
  if (!tx || typeof tx.to !== "string" || !isAddress(tx.to) || typeof tx.data !== "string" || !/^0x[0-9a-fA-F]*$/.test(tx.data) || tx.data.length <= 2) {
    return emptyQuote("no_route_available", fromAddress, toAddress, json);
  }

  const amountOutWei = String(routerResult?.toTokenAmount ?? "0");
  // A missing/unparseable price impact must NOT default to a permissive 0:
  // NaN makes the caller's PRICE_IMPACT_TOO_HIGH hard guard fail closed.
  const rawImpact = routerResult?.priceImpactPercent;
  const priceImpact = rawImpact === undefined || rawImpact === null || String(rawImpact).trim() === "" ? Number.NaN : Number(rawImpact);

  return {
    amountOut: fromWei(amountOutWei, toDecimals),
    amountOutWei,
    priceImpact,
    gasLimit: String(tx.gas ?? "0"),
    value: String(tx.value ?? "0"),
    calldata: tx.data,
    to: tx.to,
    approveAddress: OKX_DEX_APPROVE_ADDRESS,
    routeAvailable: true,
    sourceStatus: "ok",
    usedFromToken: fromAddress,
    usedToToken: toAddress,
    wasSubstituted: false,
    minReceiveAmountWei: String(tx.minReceiveAmount ?? "0"),
    rawResponse: json,
  };
}
