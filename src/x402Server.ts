// ─── SafeHands x402 Server ──────────────────────────────────────────────
// Exposes SafeHands risk endpoints. /supported and /health are free and do
// not require user private keys. Paid routes are gated only when receiver +
// facilitator signer config is present.
// ────────────────────────────────────────────────────────────────────────

import "./lib/envLoader.js";
import express from "express";
import { defineChain, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as FacilitatorExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme as ServerExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";

import { handleAssessRisk } from "./tools/assessRisk.js";
import { handleCheckTokenSecurity } from "./tools/checkTokenSecurity.js";
import { handleSimulateTransaction } from "./tools/simulateTransaction.js";
import { handleSafeHandsPreflightCheck } from "./tools/safehandsPreflightCheck.js";
import { handleGetTokenPrice } from "./tools/getTokenPrice.js";
import { handleGetPoolInfo } from "./tools/getPoolInfo.js";
import { getDodoRoute } from "./lib/dodoApi.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, RPC_URL, X402_PAYMENT_TOKEN_ADDRESS, PACIFIC_WPROS_ADDRESS, WPROS_ADDRESS, activeTokenDecimals, IS_MAINNET } from "./lib/constants.js";
import { fail, ok } from "./lib/toolResponse.js";
import { checkAndRecordX402Replay } from "./lib/x402ReplayStore.js";
import { assertProductionPosture } from "./lib/productionGuards.js";
import { replayStoreUnavailableMessage } from "./api/x402Gate.js";

// Fail-fast posture check (active only when NODE_ENV=production). This
// standalone server is the DEV / self-hosted single-tenant profile: it signs
// settlements locally with X402_FACILITATOR_PRIVATE_KEY (custody). In
// production it refuses to start unless SAFEHANDS_ALLOW_LOCAL_FACILITATOR=true
// is set explicitly — the zero-custody path is the Guardian API /paid/* gate
// with an external facilitator (X402_FACILITATOR_URL).
assertProductionPosture();

// Never leak internal error detail to clients on a 5xx in production; the raw
// message may contain RPC URLs, signer state, or stack fragments.
function serverErrorMessage(e: unknown): string {
  if (process.env.NODE_ENV === "production") return "Internal x402 server error.";
  return e instanceof Error ? e.message : String(e);
}

const receiverAddress = (process.env.X402_PAY_TO || process.env.WALLET_ADDRESS || "") as `0x${string}`;
const facilitatorPrivateKey = process.env.X402_FACILITATOR_PRIVATE_KEY || "";
const port = parseInt(process.env.PORT || process.env.X402_SERVER_PORT || process.env.X402_PORT || "4021", 10);
const rpcUrl = process.env.PHAROS_RPC_URL || RPC_URL;
const paymentTokenAddress = X402_PAYMENT_TOKEN_ADDRESS;
const priceUsdc = process.env.X402_PRICE_USDC || "0.01";
const isPaidConfigured = Boolean(receiverAddress && facilitatorPrivateKey);

const pharos = defineChain({
  id: CHAIN_ID,
  name: `Pharos ${PHAROS_ENVIRONMENT}`,
  nativeCurrency: { name: IS_MAINNET ? "PROS" : "PROS", symbol: IS_MAINNET ? "PROS" : "PROS", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: !IS_MAINNET,
});

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PAYMENT, Accept");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  req.setTimeout(15_000);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "64kb" }));

const rateLimitWindowMs = 60_000;
const rateLimitMax = 120;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
app.use((req, res, next) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > rateLimitMax) {
    return res.status(429).json(fail("RATE_LIMITED", "Too many requests", true, "x402_server"));
  }
  return next();
});

let facilitator: x402Facilitator | null = null;
let resourceServer: x402ResourceServer | null = null;

if (isPaidConfigured) {
  const account = privateKeyToAccount(facilitatorPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: pharos,
    transport: http(undefined, { timeout: 30_000 }),
  }).extend(publicActions);

  const evmSigner = toFacilitatorEvmSigner({
    address: account.address,
    getCode: (args) => walletClient.getCode(args),
    readContract: (args) => walletClient.readContract({ ...args, args: args.args || [] }),
    verifyTypedData: (args) => walletClient.verifyTypedData(args as any),
    writeContract: (args) => walletClient.writeContract({ ...args, args: args.args || [] }),
    sendTransaction: (args) => walletClient.sendTransaction(args),
    waitForTransactionReceipt: (args) => walletClient.waitForTransactionReceipt(args),
  });

  facilitator = new x402Facilitator();
  facilitator.register(`eip155:${CHAIN_ID}`, new FacilitatorExactEvmScheme(evmSigner, {}));

  const facilitatorClient = new HTTPFacilitatorClient({ url: `http://localhost:${port}` });
  resourceServer = new x402ResourceServer(facilitatorClient);
  const evmScheme = new ServerExactEvmScheme();
  evmScheme.registerMoneyParser(async (amount: number, network: string) => {
    if (network === `eip155:${CHAIN_ID}`) {
      const decimals = activeTokenDecimals()[paymentTokenAddress.toLowerCase()] || 6;
      const multiplier = Math.pow(10, decimals);
      const isWpros = paymentTokenAddress.toLowerCase() === PACIFIC_WPROS_ADDRESS.toLowerCase() || paymentTokenAddress.toLowerCase() === WPROS_ADDRESS.toLowerCase();
      const symbol = isWpros ? "WPROS" : "USDC";
      return {
        amount: Math.round(amount * multiplier).toString(),
        asset: paymentTokenAddress,
        extra: { token: symbol, name: symbol, version: "2" },
      };
    }
    return null;
  });
  resourceServer.register(`eip155:${CHAIN_ID}`, evmScheme);
}

app.post("/verify", async (req, res) => {
  if (!facilitator) {
    return res.status(503).json(fail("X402_SERVER_RECEIVER_CONFIG_MISSING", "x402 facilitator is not configured. Set X402_PAY_TO/WALLET_ADDRESS and X402_FACILITATOR_PRIVATE_KEY for paid endpoints. Client PRIVATE_KEY is not used for server receiver config.", false, "x402_server"));
  }
  try {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json(fail("BAD_REQUEST", "Missing required fields: paymentPayload and paymentRequirements.", false, "x402_server"));
    }
    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (e: any) {
    res.status(500).json(fail("X402_PAYMENT_FAILED", serverErrorMessage(e), true, "x402_server"));
  }
});

app.post("/settle", async (req, res) => {
  if (!facilitator) {
    return res.status(503).json(fail("X402_SERVER_RECEIVER_CONFIG_MISSING", "x402 facilitator is not configured. Set X402_PAY_TO/WALLET_ADDRESS and X402_FACILITATOR_PRIVATE_KEY for paid endpoints. Client PRIVATE_KEY is not used for server receiver config.", false, "x402_server"));
  }
  try {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json(fail("BAD_REQUEST", "Missing required fields: paymentPayload and paymentRequirements.", false, "x402_server"));
    }
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (e: any) {
    res.status(500).json(fail("X402_PAYMENT_FAILED", serverErrorMessage(e), true, "x402_server"));
  }
});

app.get("/supported", (_req, res) => {
  if (facilitator) return res.json(facilitator.getSupported());
  return res.json(
    ok({
      configured: false,
      network: `eip155:${CHAIN_ID}`,
      scheme: "exact",
      asset: paymentTokenAddress,
      priceUsdc,
      freeEndpoints: ["GET /supported", "GET /health"],
      paidEndpoints: ["GET /assess-risk", "GET /check-token-security", "GET /simulate-transaction", "GET /token-price", "GET /pool-info", "GET /swap-route"],
      configError: {
        code: "X402_SERVER_RECEIVER_CONFIG_MISSING",
        message: "Paid endpoints require receiver/payTo plus facilitator signer config. Free endpoints remain available.",
      },
    })
  );
});

app.get("/health", (_req, res) => {
  res.json(
    ok({
      status: "ok",
      service: "SafeHands x402 Resource Server",
      network: `Pharos ${PHAROS_ENVIRONMENT} (Chain ID ${CHAIN_ID})`,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
      receiverConfigured: Boolean(receiverAddress),
      paidEndpointsConfigured: isPaidConfigured,
      receiver: receiverAddress || null,
      asset: paymentTokenAddress,
      freeEndpoints: ["/supported", "/health"],
    })
  );
});

function paidConfigError(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isPaidConfigured) return next();
  return res.status(503).json(
    fail(
      "X402_SERVER_RECEIVER_CONFIG_MISSING",
      "Paid endpoint receiver/payTo or facilitator signer config is missing. Free endpoints do not require a client signer/private key.",
      false,
      "x402_server"
    )
  );
}

// ─── x402 Replay Protection (durable idempotency cache) ────────────────
const REPLAY_WINDOW_MS = Number(process.env.SAFEHANDS_X402_REPLAY_WINDOW_MS || 10 * 60 * 1000); // default 10 minutes

function replayProtectionMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const paymentHeader = req.headers["x-payment"];
  if (typeof paymentHeader !== "string" || paymentHeader.length <= 10) return next();

  checkAndRecordX402Replay(paymentHeader, REPLAY_WINDOW_MS)
    .then((result) => {
      res.setHeader("X-SafeHands-X402-Replay-Store", result.backend);
      if (!result.allowed) {
        return res.status(402).json(fail("REPLAY_ATTACK_DETECTED", "This x402 payment signature has already been used.", false, "x402_server"));
      }
      return next();
    })
    .catch((err: unknown) => {
      // Raw store errors (Upstash detail, Redis hostname, fs paths) stay in
      // server logs; production clients get a generic message.
      console.error("[SafeHands x402] replay store unavailable:", err instanceof Error ? err.message : String(err));
      return res.status(503).json(fail("X402_REPLAY_STORE_UNAVAILABLE", replayStoreUnavailableMessage(err), true, "x402_server"));
    });
}
// ────────────────────────────────────────────────────────────────────────

if (isPaidConfigured && resourceServer) {
  app.use(["/assess-risk", "/check-token-security", "/simulate-transaction", "/token-price", "/pool-info", "/swap-route"], replayProtectionMiddleware);
  app.use(
    paymentMiddleware(
      {
        "GET /assess-risk": {
          accepts: { scheme: "exact", price: priceUsdc, network: `eip155:${CHAIN_ID}`, payTo: receiverAddress },
          description: `Assess transaction risk (USDC ${priceUsdc})`,
          mimeType: "application/json",
        },
        "GET /check-token-security": {
          accepts: { scheme: "exact", price: priceUsdc, network: `eip155:${CHAIN_ID}`, payTo: receiverAddress },
          description: `Verify contract token security profile (USDC ${priceUsdc})`,
          mimeType: "application/json",
        },
        "GET /simulate-transaction": {
          accepts: { scheme: "exact", price: priceUsdc, network: `eip155:${CHAIN_ID}`, payTo: receiverAddress },
          description: `Simulate EVM execution trace before broadcasting (USDC ${priceUsdc})`,
          mimeType: "application/json",
        },
        "GET /token-price": {
          accepts: { scheme: "exact", price: priceUsdc, network: `eip155:${CHAIN_ID}`, payTo: receiverAddress },
          description: `Real-time token price via DODO/FaroSwap (USDC ${priceUsdc})`,
          mimeType: "application/json",
        },
        "GET /pool-info": {
          accepts: { scheme: "exact", price: priceUsdc, network: `eip155:${CHAIN_ID}`, payTo: receiverAddress },
          description: `DODO/FaroSwap pool data: price ratio, impact, fees (USDC ${priceUsdc})`,
          mimeType: "application/json",
        },
        "GET /swap-route": {
          accepts: { scheme: "exact", price: priceUsdc, network: `eip155:${CHAIN_ID}`, payTo: receiverAddress },
          description: `Swap route with estimated output via DODO (USDC ${priceUsdc})`,
          mimeType: "application/json",
        },
      },
      resourceServer
    )
  );
} else {
  app.use(["/assess-risk", "/check-token-security", "/simulate-transaction", "/token-price", "/pool-info", "/swap-route"], paidConfigError);
}

app.get("/assess-risk", async (req, res) => {
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
    res.status(400).json(fail("BAD_REQUEST", e.message, false, "x402_server"));
  }
});

app.get("/check-token-security", async (req, res) => {
  try {
    const { tokenAddress, chainId } = req.query;
    const cid = chainId ? parseInt(chainId as string, 10) : CHAIN_ID;
    const result = await handleCheckTokenSecurity({ tokenAddress: tokenAddress as string, chainId: cid });
    res.json(result);
  } catch (e: any) {
    res.status(400).json(fail("BAD_REQUEST", e.message, false, "x402_server"));
  }
});

app.get("/simulate-transaction", async (req, res) => {
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
    res.status(400).json(fail("BAD_REQUEST", e.message, false, "x402_server"));
  }
});

app.get("/token-price", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      return res.status(400).json(fail("BAD_REQUEST", "Missing required query parameter: token (PROS, USDC, or USDT)", false, "x402_server"));
    }
    const result = await handleGetTokenPrice({ token: token as any });
    res.json(result);
  } catch (e: any) {
    res.status(400).json(fail("BAD_REQUEST", e.message, false, "x402_server"));
  }
});

app.get("/pool-info", async (req, res) => {
  try {
    const { tokenA, tokenB } = req.query;
    if (!tokenA || !tokenB || typeof tokenA !== "string" || typeof tokenB !== "string") {
      return res.status(400).json(fail("BAD_REQUEST", "Missing required query parameters: tokenA and tokenB (PROS, USDC, or USDT)", false, "x402_server"));
    }
    const result = await handleGetPoolInfo({ tokenA: tokenA as any, tokenB: tokenB as any });
    res.json(result);
  } catch (e: any) {
    res.status(400).json(fail("BAD_REQUEST", e.message, false, "x402_server"));
  }
});

app.get("/swap-route", async (req, res) => {
  try {
    const { tokenIn, tokenOut, amount } = req.query;
    if (!tokenIn || !tokenOut || !amount || typeof tokenIn !== "string" || typeof tokenOut !== "string" || typeof amount !== "string") {
      return res.status(400).json(fail("BAD_REQUEST", "Missing required query parameters: tokenIn, tokenOut, amount", false, "x402_server"));
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json(fail("BAD_REQUEST", "amount must be a positive number", false, "x402_server"));
    }
    const quote = await getDodoRoute({
      fromToken: tokenIn,
      toToken: tokenOut,
      amountHuman: amount,
      walletAddress: "0x0000000000000000000000000000000000000001",
    });
    res.json(ok({
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
    }));
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("SWAP_LIQUIDITY_NOT_CONFIGURED")) {
      return res.status(503).json(fail("SWAP_LIQUIDITY_NOT_CONFIGURED", message, false, "x402_server"));
    }
    res.status(400).json(fail("BAD_REQUEST", message, false, "x402_server"));
  }
});

// Free endpoints for live dashboard
app.get("/preflight", async (req, res) => {
  try {
    const { actionType, chainId, amount, tokenAddress, spender, approvalAmount, recipient } = req.query;
    const result = await handleSafeHandsPreflightCheck({
      actionType: actionType as any,
      chainId: chainId ? parseInt(chainId as string, 10) : CHAIN_ID,
      amount: amount as string,
      tokenAddress: tokenAddress as string,
      spender: spender as string,
      approvalAmount: approvalAmount as string,
      recipient: recipient as string,
    });
    res.json(result);
  } catch (e: any) {
    res.status(400).json(fail("BAD_REQUEST", e.message, false, "x402_server"));
  }
});

app.get("/risk", async (req, res) => {
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
    res.status(400).json(fail("BAD_REQUEST", e.message, false, "x402_server"));
  }
});

app.listen(port, () => {
  console.log(`✅ SafeHands x402 Server listening on http://localhost:${port}`);
  console.log(`📡 Network: eip155:${CHAIN_ID} (Pharos ${PHAROS_ENVIRONMENT})`);
  console.log(`💰 Paid endpoints configured: ${isPaidConfigured ? "yes" : "no"}`);
  if (receiverAddress) console.log(`💰 Paid recipient address: ${receiverAddress}`);
  console.log(`🪙 x402 payment token: ${paymentTokenAddress}`);
  console.log(`🆓 Free APIs: /supported, /health`);
});
