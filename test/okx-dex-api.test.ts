// ─── OKX DEX API client tests (hermetic) ───────────────────────────────
// All network I/O goes to a loopback HTTP server; no real OKX calls. Env is
// pinned explicitly at the top BEFORE the module under test is imported
// (constants.ts reads env at module load), per the CI env-leak rule: never
// rely on ambient CI-exported vars.

process.env.PHAROS_CHAIN_ID = "1672";
process.env.ALLOW_LOCAL_X402_FETCH = "true";
process.env.OKX_API_KEY = "test-key";
process.env.OKX_API_SECRET = "test-secret";
process.env.OKX_API_PASSPHRASE = "test-pass";
delete process.env.OKX_API_PROJECT_ID;
delete process.env.OKX_API_SUPPORTED_CHAIN_IDS;
delete process.env.OKX_ROUTER_ALLOWLIST;
delete process.env.SAFEHANDS_OKX_ROUTER_ALLOWLIST;
delete process.env.OKX_SPENDER_ALLOWLIST;
delete process.env.SAFEHANDS_OKX_SPENDER_ALLOWLIST;

import { test, before, after } from "node:test";
import assert from "node:assert";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

const ROUTER = "0x75f21a97bd89a9a5683a9f46b5d5b4a080708dea";
const APPROVE = "0x78466A1488f1883d71cFddd1c621351572dE0a1C";
const WALLET = "0x1111111111111111111111111111111111111111";

function okResponse() {
  return {
    code: "0",
    msg: "",
    data: [
      {
        routerResult: {
          fromTokenAmount: "100000000",
          toTokenAmount: "2000000000000000000",
          priceImpactPercent: "0.12",
          estimateGasFee: "210000",
        },
        tx: {
          to: ROUTER,
          data: "0xdeadbeef",
          value: "0",
          gas: "250000",
          minReceiveAmount: "1990000000000000000",
        },
      },
    ],
  };
}

let server: Server;
let lastRequest: { url: string; headers: IncomingMessage["headers"] } | null = null;
// Read through a function: TypeScript otherwise keeps the `= null` narrowing
// across the awaited call that mutates lastRequest from the server callback.
function seenRequest(): { url: string; headers: IncomingMessage["headers"] } | null {
  return lastRequest;
}
let nextStatus = 200;
let nextBody: unknown = okResponse();

// Imported after env + server setup (module reads OKX_API_BASE at load).
let api: typeof import("../src/lib/okxDexApi.js");
let consts: typeof import("../src/lib/constants.js");

before(async () => {
  server = createServer((req, res) => {
    lastRequest = { url: req.url ?? "", headers: req.headers };
    res.statusCode = nextStatus;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(nextBody));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.OKX_API_BASE = `http://127.0.0.1:${port}`;
  api = await import("../src/lib/okxDexApi.js");
  consts = await import("../src/lib/constants.js");
});

after(() => {
  server.close();
});

test("signOkxRequest matches the OKX prehash scheme (timestamp + method + path-with-query)", () => {
  const sign = api.signOkxRequest({
    timestamp: "2026-01-01T00:00:00.000Z",
    method: "GET",
    requestPath: "/api/v6/dex/aggregator/swap?chainIndex=1672&x=1",
    secret: "test-secret",
  });
  assert.strictEqual(sign, "2J1wZtWAFH4RovLKytKAnY7tbXkQ6N40pgVBM6HiSbc=");
});

test("buildOkxSwapRequestPath carries chainIndex, tokens, amount, wallet, slippage, exactIn", () => {
  const path = api.buildOkxSwapRequestPath({
    chainId: 1672,
    fromTokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    toTokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    amountWei: "100000000",
    userWalletAddress: WALLET,
    slippagePercent: 0.5,
  });
  assert.ok(path.startsWith("/api/v6/dex/aggregator/swap?"));
  assert.ok(path.includes("chainIndex=1672"));
  assert.ok(path.includes("amount=100000000"));
  assert.ok(path.includes("slippagePercent=0.5"));
  assert.ok(path.includes("swapMode=exactIn"));
  assert.ok(path.includes(`userWalletAddress=${WALLET}`));
});

test("missing credentials fail closed BEFORE any network call", async () => {
  const saved = process.env.OKX_API_KEY;
  delete process.env.OKX_API_KEY;
  lastRequest = null;
  try {
    await assert.rejects(
      api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET }),
      (err: Error) => err.name === "OkxCredentialsMissingError" && err.message.includes("OKX_API_KEY")
    );
    assert.strictEqual(lastRequest, null, "no HTTP request may be sent without credentials");
  } finally {
    process.env.OKX_API_KEY = saved;
  }
});

test("unsupported chain fails closed with SWAP_LIQUIDITY_NOT_CONFIGURED", async () => {
  process.env.OKX_API_SUPPORTED_CHAIN_IDS = "9999";
  lastRequest = null;
  try {
    await assert.rejects(
      api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET }),
      (err: Error) => err.name === "OkxNotConfiguredError" && err.message.includes("SWAP_LIQUIDITY_NOT_CONFIGURED")
    );
    assert.strictEqual(lastRequest, null, "no HTTP request may be sent for an unsupported chain");
  } finally {
    delete process.env.OKX_API_SUPPORTED_CHAIN_IDS;
  }
});

test("happy path: signed request, parsed quote, registry-verified approve address", async () => {
  nextStatus = 200;
  nextBody = okResponse();
  lastRequest = null;

  const quote = await api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET });

  const seen = seenRequest();
  assert.ok(seen, "request reached the mock server");
  const headers = seen.headers;
  assert.strictEqual(headers["ok-access-key"], "test-key");
  assert.strictEqual(headers["ok-access-passphrase"], "test-pass");
  assert.ok(typeof headers["ok-access-timestamp"] === "string" && headers["ok-access-timestamp"].length > 0);
  // The signature must cover the FULL request path including the query string.
  const expectedSign = createHmac("sha256", "test-secret")
    .update(`${headers["ok-access-timestamp"]}GET${seen.url}`)
    .digest("base64");
  assert.strictEqual(headers["ok-access-sign"], expectedSign);
  assert.strictEqual(headers["ok-access-project"], undefined, "no project header without OKX_API_PROJECT_ID");

  assert.strictEqual(quote.routeAvailable, true);
  assert.strictEqual(quote.sourceStatus, "ok");
  assert.strictEqual(quote.to, ROUTER);
  assert.strictEqual(quote.calldata, "0xdeadbeef");
  assert.strictEqual(quote.amountOutWei, "2000000000000000000");
  assert.strictEqual(quote.amountOut, "2");
  assert.strictEqual(quote.priceImpact, 0.12);
  assert.strictEqual(quote.gasLimit, "250000");
  assert.strictEqual(quote.minReceiveAmountWei, "1990000000000000000");
  assert.strictEqual(quote.approveAddress, APPROVE);
  assert.strictEqual(quote.wasSubstituted, false);
});

test("non-zero code without auth keywords maps to no_route_available (fail-soft quote, no throw)", async () => {
  nextStatus = 200;
  nextBody = { code: "82000", msg: "insufficient liquidity", data: [] };
  const quote = await api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET });
  assert.strictEqual(quote.routeAvailable, false);
  assert.strictEqual(quote.sourceStatus, "no_route_available");
});

test("auth rejection in the body surfaces OKX_API_AUTH_REQUIRED without echoing secrets", async () => {
  nextStatus = 200;
  nextBody = { code: "50113", msg: "Invalid Sign / signature error", data: null };
  await assert.rejects(
    api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET }),
    (err: Error) => err.message.startsWith("OKX_API_AUTH_REQUIRED") && !err.message.includes("test-secret") && !err.message.includes("test-pass")
  );
});

test("HTTP 401 surfaces OKX_API_AUTH_REQUIRED", async () => {
  nextStatus = 401;
  nextBody = { code: "401", msg: "unauthorized", data: null };
  try {
    await assert.rejects(
      api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET }),
      (err: Error) => err.message.startsWith("OKX_API_AUTH_REQUIRED")
    );
  } finally {
    nextStatus = 200;
  }
});

test("malformed success (missing calldata) fails closed as no route", async () => {
  nextStatus = 200;
  nextBody = {
    code: "0",
    msg: "",
    data: [{ routerResult: { toTokenAmount: "1" }, tx: { to: ROUTER, data: "0x", value: "0" } }],
  };
  const quote = await api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET });
  assert.strictEqual(quote.routeAvailable, false);
});

test("missing priceImpact parses to NaN so the hard price-impact guard fails closed", async () => {
  nextStatus = 200;
  const body = okResponse();
  delete (body.data[0].routerResult as Record<string, unknown>).priceImpactPercent;
  nextBody = body;
  const quote = await api.getOkxSwapQuote({ fromToken: "USDC", toToken: "PROS", amountHuman: "100", walletAddress: WALLET });
  assert.strictEqual(quote.routeAvailable, true);
  assert.ok(Number.isNaN(quote.priceImpact));
});

test("allowlists default to the registry-verified pair, case-insensitive, env-overridable", () => {
  assert.strictEqual(consts.isAllowedOkxRouter(ROUTER), true);
  assert.strictEqual(consts.isAllowedOkxRouter(ROUTER.toUpperCase().replace("0X", "0x")), true);
  assert.strictEqual(consts.isAllowedOkxRouter("0x2222222222222222222222222222222222222222"), false);
  assert.strictEqual(consts.isAllowedOkxSpender(APPROVE), true);
  assert.strictEqual(consts.isAllowedOkxSpender(APPROVE.toLowerCase()), true);
  assert.strictEqual(consts.isAllowedOkxSpender("0x2222222222222222222222222222222222222222"), false);

  process.env.OKX_ROUTER_ALLOWLIST = "0x3333333333333333333333333333333333333333";
  try {
    assert.strictEqual(consts.isAllowedOkxRouter(ROUTER), false, "env override replaces the default");
    assert.strictEqual(consts.isAllowedOkxRouter("0x3333333333333333333333333333333333333333"), true);
  } finally {
    delete process.env.OKX_ROUTER_ALLOWLIST;
  }
});

test("okxApiSupportedChainIds defaults to mainnet 1672 only", () => {
  assert.deepStrictEqual(api.okxApiSupportedChainIds(), [1672]);
  assert.strictEqual(api.isOkxApiConfiguredForChain(1672), true);
  assert.strictEqual(api.isOkxApiConfiguredForChain(688689), false, "no evidence the OKX API serves the Atlantic testnet");
});
