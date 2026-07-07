// ─── SafeHands API — x402 Paid Bundle Entrypoints ─────────────────
// The additive `/paid/*` routes gated by src/api/x402Gate.ts. Each is a BUNDLE
// entrypoint: gating/charging happens once at the HTTP boundary (the x402 gate is
// installed on these paths BEFORE these handlers run), then the handler may fan out
// to several internal analyzers/tools in-process. Internal helper tools are never
// individually charged.
//
// These are read-only value-added endpoints (risk assessment, token security,
// simulation, market data, full risk report). They wrap the SAME pure tool handlers
// used by MCP/Anvita and x402Server — no signer, no wallet, no write path. Registered
// only after the x402 gate, so by the time a handler executes the payment is verified
// and non-replayed. Handlers return the standard ToolResponse envelope.
// ────────────────────────────────────────────────────────────────────────────

import type express from "express";

import { handleAssessRisk } from "../tools/assessRisk.js";
import { handleCheckTokenSecurity } from "../tools/checkTokenSecurity.js";
import { handleSimulateTransaction } from "../tools/simulateTransaction.js";
import { handleGetTokenPrice } from "../tools/getTokenPrice.js";
import { handleGetPoolInfo } from "../tools/getPoolInfo.js";
import { handleSafeHandsRiskReport } from "../tools/safehandsRiskReport.js";
import { getDodoRoute } from "../lib/dodoApi.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET } from "../lib/constants.js";
import { fail, ok } from "../lib/toolResponse.js";

const SOURCE = "guardian_api_x402";

/**
 * Register the x402 paid bundle entrypoints. MUST be called AFTER the x402 gate is
 * installed on PAID_ROUTE_PATHS, so a verified (non-replayed) payment is guaranteed
 * before any handler here executes.
 */
export function registerPaidRoutes(app: express.Application): void {
  app.get("/paid/assess-risk", async (req, res) => {
    try {
      const { action, tokenIn, tokenOut, amount, toAddress, walletAddress } = req.query;
      const result = await handleAssessRisk({
        action: action as any,
        tokenIn: tokenIn as string,
        tokenOut: tokenOut as string,
        amount: amount as string,
        toAddress: toAddress as string,
        walletAddress: walletAddress as string,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json(fail("BAD_REQUEST", e.message, false, SOURCE));
    }
  });

  app.get("/paid/check-token-security", async (req, res) => {
    try {
      const { tokenAddress, chainId } = req.query;
      const cid = chainId ? parseInt(chainId as string, 10) : CHAIN_ID;
      const result = await handleCheckTokenSecurity({ tokenAddress: tokenAddress as string, chainId: cid });
      res.json(result);
    } catch (e: any) {
      res.status(400).json(fail("BAD_REQUEST", e.message, false, SOURCE));
    }
  });

  app.get("/paid/simulate-transaction", async (req, res) => {
    try {
      const { action, tokenIn, tokenOut, amount, toAddress, walletAddress } = req.query;
      const result = await handleSimulateTransaction({
        action: action as any,
        tokenIn: tokenIn as string,
        tokenOut: tokenOut as string,
        amount: amount as string,
        toAddress: toAddress as string,
        walletAddress: walletAddress as string,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json(fail("BAD_REQUEST", e.message, false, SOURCE));
    }
  });

  app.get("/paid/token-price", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res
          .status(400)
          .json(fail("BAD_REQUEST", "Missing required query parameter: token (PROS, USDC, or USDT)", false, SOURCE));
      }
      const result = await handleGetTokenPrice({ token: token as any });
      res.json(result);
    } catch (e: any) {
      res.status(400).json(fail("BAD_REQUEST", e.message, false, SOURCE));
    }
  });

  app.get("/paid/pool-info", async (req, res) => {
    try {
      const { tokenA, tokenB } = req.query;
      if (!tokenA || !tokenB || typeof tokenA !== "string" || typeof tokenB !== "string") {
        return res
          .status(400)
          .json(
            fail("BAD_REQUEST", "Missing required query parameters: tokenA and tokenB (PROS, USDC, or USDT)", false, SOURCE),
          );
      }
      const result = await handleGetPoolInfo({ tokenA: tokenA as any, tokenB: tokenB as any });
      res.json(result);
    } catch (e: any) {
      res.status(400).json(fail("BAD_REQUEST", e.message, false, SOURCE));
    }
  });

  app.get("/paid/swap-route", async (req, res) => {
    try {
      const { tokenIn, tokenOut, amount } = req.query;
      if (
        !tokenIn ||
        !tokenOut ||
        !amount ||
        typeof tokenIn !== "string" ||
        typeof tokenOut !== "string" ||
        typeof amount !== "string"
      ) {
        return res
          .status(400)
          .json(fail("BAD_REQUEST", "Missing required query parameters: tokenIn, tokenOut, amount", false, SOURCE));
      }
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return res.status(400).json(fail("BAD_REQUEST", "amount must be a positive number", false, SOURCE));
      }
      const quote = await getDodoRoute({
        fromToken: tokenIn,
        toToken: tokenOut,
        amountHuman: amount,
        walletAddress: "0x0000000000000000000000000000000000000001",
      });
      res.json(
        ok({
          tokenIn,
          tokenOut,
          amountIn: amount,
          estimatedOutput: quote.routeAvailable ? quote.amountOut : null,
          priceImpact: quote.priceImpact,
          routeAvailable: quote.routeAvailable,
          gasEstimate: quote.gasLimit,
          wasSubstituted: quote.wasSubstituted,
          substitutionNote: quote.substitutionNote || null,
          source: "DODO/FaroSwap route API",
          chainId: CHAIN_ID,
          environment: PHAROS_ENVIRONMENT,
          isMainnet: IS_MAINNET,
        }),
      );
    } catch (e: any) {
      res.status(400).json(fail("BAD_REQUEST", e.message, false, SOURCE));
    }
  });

  // Flagship bundle: one payment fans out to preflight (multiple analyzers) + registry
  // lookup in-process. Charged exactly once at the /paid/risk-report entrypoint.
  app.get("/paid/risk-report", async (req, res) => {
    try {
      const { actionType, chainId, amount, tokenAddress, spender, approvalAmount, recipient, walletAddress, includeChecks } =
        req.query;
      const result = await handleSafeHandsRiskReport({
        actionType: actionType as any,
        chainId: chainId ? parseInt(chainId as string, 10) : CHAIN_ID,
        amount: amount as string,
        tokenAddress: tokenAddress as string,
        spender: spender as string,
        approvalAmount: approvalAmount as string,
        recipient: recipient as string,
        walletAddress: walletAddress as string,
        includeChecks: includeChecks === undefined ? undefined : includeChecks !== "false",
      });
      res.status(result.success ? 200 : 400).json(result);
    } catch (e: any) {
      res.status(400).json(fail("BAD_REQUEST", e.message, false, SOURCE));
    }
  });
}
