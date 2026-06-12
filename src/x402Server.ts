// ─── SafeHands x402 Server ──────────────────────────────────────────────
// Exposes SafeHands risk endpoints. /supported and /health are free and do
// not require user private keys. Paid routes are gated only when receiver +
// facilitator signer config is present.
// ────────────────────────────────────────────────────────────────────────

import express from "express";
import { join } from "path";
import { readFileSync } from "fs";
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
import { CHAIN_ID, PHAROS_ENVIRONMENT, RPC_URL, X402_PAYMENT_TOKEN_ADDRESS } from "./lib/constants.js";
import { fail, ok } from "./lib/toolResponse.js";

function loadEnv() {
  try {
    const f = readFileSync(join(process.cwd(), ".env"), "utf-8");
    for (const l of f.split("\n")) {
      const t = l.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      if (process.env[key] === undefined) process.env[key] = t.slice(i + 1).trim();
    }
  } catch {}
}
loadEnv();

const receiverAddress = (process.env.X402_PAY_TO || process.env.WALLET_ADDRESS || "") as `0x${string}`;
const facilitatorPrivateKey = process.env.X402_FACILITATOR_PRIVATE_KEY || "";
const port = parseInt(process.env.X402_SERVER_PORT || process.env.X402_PORT || "4021", 10);
const rpcUrl = process.env.PHAROS_RPC_URL || RPC_URL;
const usdcAddress = X402_PAYMENT_TOKEN_ADDRESS;
const priceUsdc = process.env.X402_PRICE_USDC || "0.001";
const isPaidConfigured = Boolean(receiverAddress && facilitatorPrivateKey);

const pharos = defineChain({
  id: CHAIN_ID,
  name: `Pharos ${PHAROS_ENVIRONMENT}`,
  nativeCurrency: { name: "PHRS", symbol: "PHRS", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
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
      return {
        amount: Math.round(amount * 1e6).toString(),
        asset: usdcAddress,
        extra: { token: "USDC", name: "USDC", version: "2" },
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
    const { paymentPayload, paymentRequirements } = req.body;
    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (e: any) {
    res.status(500).json(fail("X402_PAYMENT_FAILED", e.message, true, "x402_server"));
  }
});

app.post("/settle", async (req, res) => {
  if (!facilitator) {
    return res.status(503).json(fail("X402_SERVER_RECEIVER_CONFIG_MISSING", "x402 facilitator is not configured. Set X402_PAY_TO/WALLET_ADDRESS and X402_FACILITATOR_PRIVATE_KEY for paid endpoints. Client PRIVATE_KEY is not used for server receiver config.", false, "x402_server"));
  }
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (e: any) {
    res.status(500).json(fail("X402_PAYMENT_FAILED", e.message, true, "x402_server"));
  }
});

app.get("/supported", (_req, res) => {
  if (facilitator) return res.json(facilitator.getSupported());
  return res.json(
    ok({
      configured: false,
      network: `eip155:${CHAIN_ID}`,
      scheme: "exact",
      asset: usdcAddress,
      priceUsdc,
      freeEndpoints: ["GET /supported", "GET /health"],
      paidEndpoints: ["GET /assess-risk", "GET /check-token-security", "GET /simulate-transaction"],
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
      isMainnet: false,
      receiverConfigured: Boolean(receiverAddress),
      paidEndpointsConfigured: isPaidConfigured,
      receiver: receiverAddress || null,
      asset: usdcAddress,
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

if (isPaidConfigured && resourceServer) {
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
      },
      resourceServer
    )
  );
} else {
  app.use(["/assess-risk", "/check-token-security", "/simulate-transaction"], paidConfigError);
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

app.listen(port, () => {
  console.log(`✅ SafeHands x402 Server listening on http://localhost:${port}`);
  console.log(`📡 Network: eip155:${CHAIN_ID} (Pharos ${PHAROS_ENVIRONMENT})`);
  console.log(`💰 Paid endpoints configured: ${isPaidConfigured ? "yes" : "no"}`);
  if (receiverAddress) console.log(`💰 Paid recipient address: ${receiverAddress}`);
  console.log(`🪙 x402 payment token: ${usdcAddress}`);
  console.log(`🆓 Free APIs: /supported, /health`);
});
