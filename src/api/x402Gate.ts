// ─── SafeHands API — x402 Payment Gate (zero-custody) ─────────────
// Adds real x402 gating to the SINGLE deployed service (dist/api/server.js) for
// the additive `/paid/*` bundle entrypoints — WITHOUT breaking the free public
// read API and WITHOUT putting a signing/facilitator key on the host.
//
// Zero-custody posture (WALLET_MODE=none):
//   • The service holds NO private key. Verification + settlement are delegated to
//     an EXTERNAL facilitator via X402_FACILITATOR_URL (a relayer that runs off-host).
//   • X402_PAY_TO is a RECEIVE-only address for earned fees — not custody of user funds.
//   • When receiver + facilitator config is absent, `/paid/*` is FAIL-CLOSED (503):
//     the paid handler NEVER runs before payment is verified.
//
// Charge-once model: gating happens at the HTTP entrypoint only. A `/paid/*` route
// may fan out to several internal analyzers/tools in-process (e.g. /paid/risk-report),
// but the single verified X-PAYMENT settles exactly once. Internal helper tools are
// never individually gated. Replay protection (checkAndRecordX402Replay) guarantees the
// same payment authorization cannot buy a second call.
//
// Pure/env-driven config resolver (resolveX402GateConfig) is offline-testable; the gate
// installer only touches the Express app. Nothing here signs, sends, or creates a wallet.
// ────────────────────────────────────────────────────────────────────────────

import type express from "express";
import { ExactEvmScheme as ServerExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";

import {
  CHAIN_ID,
  X402_PAYMENT_TOKEN_ADDRESS,
  PACIFIC_WPROS_ADDRESS,
  WPROS_ADDRESS,
  activeTokenDecimals,
} from "../lib/constants.js";
import { fail } from "../lib/toolResponse.js";
import { checkAndRecordX402Replay } from "../lib/x402ReplayStore.js";

const SOURCE = "guardian_api_x402";

/** The additive paid bundle entrypoints. Existing free routes are never listed here. */
export const PAID_ROUTE_PATHS = [
  "/paid/assess-risk",
  "/paid/check-token-security",
  "/paid/simulate-transaction",
  "/paid/token-price",
  "/paid/pool-info",
  "/paid/swap-route",
  "/paid/risk-report",
] as const;

type Env = Record<string, string | undefined>;

export interface X402GateConfig {
  /** True only when BOTH a receiver (payTo) and an external facilitator URL are set. */
  configured: boolean;
  /** Receive-only address for earned fees (X402_PAY_TO / WALLET_ADDRESS). */
  payTo: string;
  /** External facilitator (relayer) base URL — verification/settlement happen off-host. */
  facilitatorUrl: string | null;
  /** Price per paid call, in USDC-equivalent human units (default 0.01). */
  priceUsdc: string;
  /** x402 network id, e.g. eip155:688689. */
  network: `${string}:${string}`;
  /** ERC-20 used for payment (mirrors X402_PAYMENT_TOKEN_ADDRESS). */
  paymentTokenAddress: string;
  /** Replay-protection window in ms (mirrors x402Server default: 10 minutes). */
  replayWindowMs: number;
}

/**
 * Resolve the x402 gate config from env. REMOTE facilitator only — the single service
 * never holds a key. `configured` requires payTo AND facilitatorUrl; anything else leaves
 * the gate unconfigured so `/paid/*` fails closed. Pure + offline (tests pass synthetic env).
 */
export function resolveX402GateConfig(env: Env = process.env): X402GateConfig {
  const payTo = (env.X402_PAY_TO || env.WALLET_ADDRESS || "").trim();
  const facilitatorUrl = (env.X402_FACILITATOR_URL || "").trim() || null;
  const priceUsdc = (env.X402_PRICE_USDC || "0.01").trim();
  const replayWindowMs = Number(env.SAFEHANDS_X402_REPLAY_WINDOW_MS || 10 * 60 * 1000);
  const configured = Boolean(payTo && facilitatorUrl);
  return {
    configured,
    payTo,
    facilitatorUrl,
    priceUsdc,
    network: `eip155:${CHAIN_ID}` as `${string}:${string}`,
    paymentTokenAddress: X402_PAYMENT_TOKEN_ADDRESS,
    replayWindowMs: Number.isFinite(replayWindowMs) && replayWindowMs > 0 ? replayWindowMs : 10 * 60 * 1000,
  };
}

/** Fail-closed guard: paid routes return 503 (handler never runs) when x402 is unconfigured. */
function unconfiguredGuard(_req: express.Request, res: express.Response): void {
  res.status(503).json(
    fail(
      "X402_SERVER_RECEIVER_CONFIG_MISSING",
      "Paid endpoints require an x402 receiver (X402_PAY_TO) plus an external facilitator (X402_FACILITATOR_URL). " +
        "Free endpoints remain available. The zero-custody service holds no signing key.",
      false,
      SOURCE,
    ),
  );
}

/**
 * x402 X-PAYMENT is base64-encoded JSON. Reject obvious junk BEFORE recording it in
 * the replay store (M3): each store write is an O(n) full-file rewrite, so without
 * this an attacker could flood `/paid/*` with unique random headers and grow the
 * store / burn CPU+disk. A malformed header would fail downstream verification
 * anyway; dropping it here just avoids the write. Legitimate payments decode fine.
 */
function looksLikeX402Payment(header: string): boolean {
  if (header.length > 8192) return false;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    return !!parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

/**
 * P1-3: client-facing message for a replay-store failure. Raw store errors can
 * carry internals — Upstash REST error strings, the Redis hostname from a DNS
 * failure, or state-dir filesystem paths — so production gets a generic
 * message; the detail stays in server-side logs (and in dev responses).
 * Exported for offline tests.
 */
export function replayStoreUnavailableMessage(
  err: unknown,
  production: boolean = process.env.NODE_ENV === "production",
): string {
  if (production) return "x402 replay store is temporarily unavailable.";
  const message = err instanceof Error ? err.message : String(err);
  return `x402 replay store unavailable: ${message}`;
}

/** Durable replay protection: reject a reused X-PAYMENT authorization before settlement. */
function buildReplayMiddleware(cfg: X402GateConfig) {
  return function replayProtectionMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    const paymentHeader = req.headers["x-payment"];
    if (typeof paymentHeader !== "string" || paymentHeader.length <= 10) return next();

    // Pre-filter malformed headers so junk floods can't grow the O(n) replay store.
    if (!looksLikeX402Payment(paymentHeader)) {
      res
        .status(400)
        .json(fail("X402_PAYMENT_MALFORMED", "X-PAYMENT header is not a valid x402 payment payload.", false, SOURCE));
      return;
    }

    checkAndRecordX402Replay(paymentHeader, cfg.replayWindowMs)
      .then((result) => {
        res.setHeader("X-SafeHands-X402-Replay-Store", result.backend);
        if (!result.allowed) {
          res
            .status(402)
            .json(fail("REPLAY_ATTACK_DETECTED", "This x402 payment signature has already been used.", false, SOURCE));
          return;
        }
        next();
      })
      .catch((err: unknown) => {
        console.error("[SafeHands x402] replay store unavailable:", err instanceof Error ? err.message : String(err));
        res
          .status(503)
          .json(fail("X402_REPLAY_STORE_UNAVAILABLE", replayStoreUnavailableMessage(err), true, SOURCE));
      });
  };
}

/** Money parser: convert the human price into the atomic amount + asset for the exact scheme. */
function buildMoneyParser(cfg: X402GateConfig) {
  return async (amount: number, network: string) => {
    if (network !== cfg.network) return null;
    const decimals = activeTokenDecimals()[cfg.paymentTokenAddress.toLowerCase()] || 6;
    const multiplier = Math.pow(10, decimals);
    const isWpros =
      cfg.paymentTokenAddress.toLowerCase() === PACIFIC_WPROS_ADDRESS.toLowerCase() ||
      cfg.paymentTokenAddress.toLowerCase() === WPROS_ADDRESS.toLowerCase();
    const symbol = isWpros ? "WPROS" : "USDC";
    return {
      amount: Math.round(amount * multiplier).toString(),
      asset: cfg.paymentTokenAddress,
      extra: { token: symbol, name: symbol, version: "2" },
    };
  };
}

/** paymentMiddleware route map: each paid entrypoint priced independently, settled once. */
function buildRouteConfig(cfg: X402GateConfig) {
  const accepts = { scheme: "exact" as const, price: cfg.priceUsdc, network: cfg.network, payTo: cfg.payTo };
  const entry = (description: string) => ({ accepts, description, mimeType: "application/json" });
  return {
    "GET /paid/assess-risk": entry(`Assess transaction risk (USDC ${cfg.priceUsdc})`),
    "GET /paid/check-token-security": entry(`Verify contract token security profile (USDC ${cfg.priceUsdc})`),
    "GET /paid/simulate-transaction": entry(`Simulate EVM execution before broadcast (USDC ${cfg.priceUsdc})`),
    "GET /paid/token-price": entry(`Real-time token price via DODO/FaroSwap (USDC ${cfg.priceUsdc})`),
    "GET /paid/pool-info": entry(`DODO/FaroSwap pool data — ratio, impact, fees (USDC ${cfg.priceUsdc})`),
    "GET /paid/swap-route": entry(`Swap route with estimated output via DODO (USDC ${cfg.priceUsdc})`),
    "GET /paid/risk-report": entry(`Full SafeHands risk report bundle (USDC ${cfg.priceUsdc})`),
  };
}

export interface X402Gate {
  configured: boolean;
  /**
   * Install the gate on the app. When configured: replay → x402 paymentMiddleware on
   * `/paid/*` (so the handler runs ONLY after a verified, non-replayed payment). When
   * unconfigured: a fail-closed 503 guard on `/paid/*`. Must be installed BEFORE the
   * paid route handlers so payment is verified first.
   */
  install(app: express.Application): void;
}

/**
 * Build the x402 gate for the single service. Zero-custody: uses a remote facilitator
 * client (X402_FACILITATOR_URL) for verify/settle; no local signer, no key, no wallet.
 */
export function buildX402Gate(cfg: X402GateConfig = resolveX402GateConfig()): X402Gate {
  return {
    configured: cfg.configured,
    install(app: express.Application): void {
      const paths = PAID_ROUTE_PATHS as unknown as string[];
      if (!cfg.configured) {
        app.use(paths, unconfiguredGuard);
        return;
      }

      // 1) Replay protection first — a reused authorization is rejected before settlement.
      app.use(paths, buildReplayMiddleware(cfg));

      // 2) x402 gate via an EXTERNAL facilitator (relayer runs off-host; service holds no key).
      const facilitatorClient = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl as string });
      const resourceServer = new x402ResourceServer(facilitatorClient);
      const evmScheme = new ServerExactEvmScheme();
      evmScheme.registerMoneyParser(buildMoneyParser(cfg));
      resourceServer.register(cfg.network, evmScheme);
      app.use(paymentMiddleware(buildRouteConfig(cfg), resourceServer));
    },
  };
}
