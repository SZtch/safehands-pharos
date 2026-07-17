// ─── Anvita hosted engine — the shipped deliverable ────────────────────────
// anvita/safehands/scripts/safehands-engine.js is the zero-dependency engine
// Anvita actually runs. This drives the real CLI artifact as a subprocess
// against a MOCK Pharos RPC + MOCK GoPlus so the decision logic is
// deterministic and offline (no live mainnet, no real GoPlus). Mocks live
// ONLY here — the production engine always performs real read-only calls.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENGINE = fileURLToPath(new URL("../anvita/safehands/scripts/safehands-engine.js", import.meta.url));

// ── ABI-return encoders (match the engine's decString/decUint/decInt256) ──
const word = (hex) => hex.padStart(64, "0");
const encUint = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
function encString(s) {
  const b = Buffer.from(s, "utf8");
  const data = b.length ? b.toString("hex").padEnd(Math.ceil(b.length / 32) * 64, "0") : "";
  return "0x" + word("20") + word(b.length.toString(16)) + data; // offset, length, bytes
}
const SEL = {
  name: "0x06fdde03", symbol: "0x95d89b41", decimals: "0x313ce567", totalSupply: "0x18160ddd",
  allowance: "0xdd62ed3e", balanceOf: "0x70a08231", latestAnswer: "0x50d25bcd", latestTimestamp: "0x8205bf6a",
  reputationOf: "0xdb89c044",
};
const CODE = "0x" + "60".repeat(120); // 120-byte bytecode → isContract, no small-bytecode penalty

// Start a mock that answers Pharos JSON-RPC (POST) and GoPlus (GET) on one port.
// Every option has a safe default so simpler tests stay terse.
function startMock(opts = {}) {
  const {
    symbol = "GOOD", goplusResult = null, goplusTransientFailures = 0,
    gasPrice = "0x2540be400",               // 10 gwei
    chainIdHex = "0x688",                    // 1672; override to simulate a wrong-chain endpoint
    feedAnswer = "390000000000000000",       // 0.39 * 1e18
    feedAgeSeconds = 60,                      // fresh (< heartbeat)
    decimalsValue = 18,
    allowance = "0",
    tokenBalance = null,                     // wei string; null → balanceOf answers "0x" (no data)
    nativeBalance = "0x0",
    proxyImpl = null,                        // address → EIP-1967 implementation slot answers it
    proxyBeacon = null,
    callResults = {},                        // "selector" or "to|selector" → raw eth_call result hex (checked first)
    estimateGas = "success",                 // "success" | "revert"
    emptyCodeAddrs = [],                     // addresses that return no code
    codeByAddr = {},                         // address (lowercase) → specific bytecode hex (overrides the default CODE)
    txByHash = {}, txReceipt = {},
    getProof = "success",                    // "success" | "unsupported"
  } = opts;
  const empty = new Set(emptyCodeAddrs.map((a) => a.toLowerCase()));
  const methodsCalled = [];
  let goplusHits = 0;
  const rpcError = (id, code, message) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

  const server = http.createServer((req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { id, method, params } = JSON.parse(body || "{}");
        methodsCalled.push(method);
        res.setHeader("content-type", "application/json");
        let result = "0x";
        if (method === "eth_getBalance") result = nativeBalance;
        else if (method === "eth_getTransactionCount") result = "0x1";
        else if (method === "eth_getCode") { const a = String(params?.[0] || "").toLowerCase(); result = empty.has(a) ? "0x" : (codeByAddr[a] ?? CODE); }
        else if (method === "eth_chainId") result = chainIdHex;
        else if (method === "eth_blockNumber") result = "0x100";
        else if (method === "eth_gasPrice") result = gasPrice;
        else if (method === "eth_estimateGas") {
          if (estimateGas === "revert") return void res.end(rpcError(id, 3, "execution reverted: gas estimate failed"));
          result = "0x6f36"; // 28470
        } else if (method === "eth_getStorageAt") {
          const slot = String(params?.[1] || "").toLowerCase();
          const enc = (a) => (a ? "0x" + a.toLowerCase().slice(2).padStart(64, "0") : "0x" + "0".repeat(64));
          if (slot === "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc") result = enc(proxyImpl);
          else if (slot === "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50") result = enc(proxyBeacon);
          else result = "0x" + "0".repeat(64);
        } else if (method === "eth_getTransactionByHash") result = txByHash[params?.[0]] ?? null;
        else if (method === "eth_getTransactionReceipt") result = txReceipt[params?.[0]] ?? null;
        else if (method === "eth_getProof") {
          if (getProof === "unsupported") return void res.end(rpcError(id, -32601, "the method eth_getProof does not exist/is not available"));
          result = { address: params?.[0], balance: "0x0", codeHash: "0x" + "cd".repeat(32), nonce: "0x0", storageHash: "0x" + "ab".repeat(32), accountProof: [], storageProof: [] };
        } else if (method === "eth_call") {
          const data = params?.[0]?.data ?? "";
          const to = String(params?.[0]?.to ?? "").toLowerCase();
          const sel10 = data.slice(0, 10);
          const scoped = callResults[`${to}|${sel10}`];
          if (scoped !== undefined) result = scoped;
          else if (callResults[sel10] !== undefined) result = callResults[sel10];
          else if (data.startsWith(SEL.symbol)) result = encString(symbol);
          else if (data.startsWith(SEL.name)) result = encString("Mock Token");
          else if (data.startsWith(SEL.decimals)) result = encUint(decimalsValue);
          else if (data.startsWith(SEL.totalSupply)) result = encUint(10n ** 24n);
          else if (data.startsWith(SEL.allowance)) result = encUint(allowance);
          else if (data.startsWith(SEL.balanceOf)) result = tokenBalance == null ? "0x" : encUint(tokenBalance);
          else if (data.startsWith(SEL.latestAnswer)) result = encUint(feedAnswer);
          else if (data.startsWith(SEL.latestTimestamp)) result = encUint(Math.floor(Date.now() / 1000) - feedAgeSeconds);
          else if (data.startsWith(SEL.reputationOf)) result = encUint(0);
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      });
      return;
    }
    // GET → GoPlus
    if (goplusHits++ < goplusTransientFailures) { res.statusCode = 429; return void res.end("rate limited"); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(goplusResult ? { code: 1, result: goplusResult } : { code: 0, message: "no data" }));
  });
  server.listen(0);
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close(), methodsCalled };
}

// Async spawn (NOT spawnSync): the mock server runs in THIS process's event
// loop, so blocking it would deadlock the child's RPC/GoPlus calls.
function runEngine(cmd, arg, env = {}) {
  return new Promise((resolve, reject) => {
    const args = arg === undefined ? [ENGINE, cmd] : [ENGINE, cmd, arg];
    const child = spawn(process.execPath, args, { env: { ...process.env, PHAROS_RPC_FALLBACK_URL: "", ...env } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (status) => {
      try { resolve({ out: JSON.parse(out), status }); }
      catch { reject(new Error(`engine produced non-JSON stdout: <<${out}>> stderr: <<${err}>>`)); }
    });
  });
}
const envFor = (mock) => ({ PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url });

describe("Anvita engine — input guards (no network)", () => {
  it("rejects key-like material before any network call", async () => {
    const { out, status } = await runEngine("analyze", JSON.stringify({ subjectType: "wallet", address: "0x1111111111111111111111111111111111111111", privateKey: "0x" + "ab".repeat(32) }));
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "KEY_MATERIAL_REJECTED");
    assert.strictEqual(status, 1);
  });

  it("locks to chain 1672 (rejects other chains)", async () => {
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: "0x2222222222222222222222222222222222222222", chainId: 1 }));
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "CHAIN_NOT_SUPPORTED");
  });

  it("rejects a malformed address", async () => {
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "wallet", address: "0xNOTVALID" }));
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "VALIDATION_ERROR");
  });

  it("rejects key material passed to a new command (check_allowance)", async () => {
    const { out } = await runEngine("check_allowance", JSON.stringify({ token: "0x1111111111111111111111111111111111111111", owner: "0x2222222222222222222222222222222222222222", spender: "0x3333333333333333333333333333333333333333", mnemonic: "wrong wrong wrong" }));
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "KEY_MATERIAL_REJECTED");
  });

  it("does NOT mistake a tx hash for key material in get_transaction_status", async () => {
    const mock = startMock();
    const hash = "0x" + "ab".repeat(32);
    const { out } = await runEngine("get_transaction_status", JSON.stringify({ txHash: hash }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.status, "not_found");
  });
});

describe("Anvita engine — analyze decision logic (mock RPC + GoPlus)", () => {
  let mock;
  after(() => mock?.close());

  it("BLOCKs a honeypot token flagged by GoPlus", async () => {
    const addr = "0x3333333333333333333333333333333333333333";
    mock = startMock({ symbol: "SCAM", goplusResult: { [addr.toLowerCase()]: { is_honeypot: "1" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "block");
    assert.ok(out.riskScore >= 70);
  });

  it("flags symbol impersonation of a canonical token", async () => {
    const addr = "0x4444444444444444444444444444444444444444";
    mock = startMock({ symbol: "USDC", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), envFor(mock));
    mock.close();
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.riskFactors.some((f) => /IMPERSONATION/i.test(f)));
  });

  it("FAIL-CLOSED: never 'allow' an unverified token when GoPlus is unreachable", async () => {
    const addr = "0x5555555555555555555555555555555555555555";
    mock = startMock({ symbol: "GOOD" });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: "http://127.0.0.1:1" });
    mock.close();
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.riskFactors.some((f) => /unreachable/i.test(f)));
  });

  it("FAIL-CLOSED: never 'allow' a token GoPlus has not indexed yet (fresh-rug window)", async () => {
    const addr = "0x7777777777777777777777777777777777777777";
    mock = startMock({ symbol: "GOOD", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), envFor(mock));
    mock.close();
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.riskScore > 30);
    assert.ok(out.riskFactors.some((f) => /not yet indexed/i.test(f) && /UNVERIFIED/i.test(f)));
  });

  it("retries a transient GoPlus 429 and keeps the verified verdict (no false warn-floor)", async () => {
    const addr = "0x8888888888888888888888888888888888888888";
    mock = startMock({ symbol: "GOOD", goplusTransientFailures: 1, goplusResult: { [addr.toLowerCase()]: { is_honeypot: "0" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "allow");
    assert.ok(!out.riskFactors.some((f) => /unreachable/i.test(f)));
    assert.match(out.intel, /GoPlus threat intelligence/);
  });

  it("exposes display-only GoPlus token identity without affecting the verdict", async () => {
    const addr = "0x9999999999999999999999999999999999999999";
    const longName = "N".repeat(200);
    mock = startMock({ symbol: "GOOD", goplusResult: { [addr.toLowerCase()]: { is_honeypot: "0", token_name: `  ${longName}  `, token_symbol: "GOOD" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), envFor(mock));
    mock.close();
    assert.strictEqual(out.goplusTokenIdentity.tokenSymbol, "GOOD");
    assert.strictEqual(out.goplusTokenIdentity.tokenName.length, 128);
    assert.strictEqual(out.recommendation, "allow");
  });

  it("FAIL-CLOSED: never 'allow' when GoPlus returns a drifted/unrecognized schema", async () => {
    const addr = "0x6666666666666666666666666666666666666666";
    mock = startMock({ symbol: "GOOD", goplusResult: { [addr.toLowerCase()]: { honeypot: "1", tax: "0" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), envFor(mock));
    mock.close();
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.riskFactors.some((f) => /unrecognized|schema|UNVERIFIED/i.test(f)));
  });
});

describe("Anvita engine — market & network reads", () => {
  let mock;
  after(() => mock?.close());

  it("get_gas_price returns wei + gwei from eth_gasPrice", async () => {
    mock = startMock({ gasPrice: "0x2540be400" });
    const { out } = await runEngine("get_gas_price", undefined, envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.command, "get_gas_price");
    assert.strictEqual(out.wei, "10000000000");
    assert.strictEqual(out.gwei, "10");
  });

  it("get_token_price PROS reads the Chainlink feed via eth_call", async () => {
    mock = startMock({ feedAnswer: "390000000000000000", feedAgeSeconds: 60 });
    const { out } = await runEngine("get_token_price", "PROS", envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.pair, "PROS/USD");
    assert.strictEqual(out.price, "0.39");
    assert.strictEqual(out.stale, false);
    assert.strictEqual(out.sourceStatus, "ok");
  });

  it("'harga 1 pharos berapa?' → PHAROS alias resolves to PROS/USD with a precise note", async () => {
    mock = startMock();
    // The SKILL maps the NL phrase to get_token_price {symbol:"PHAROS"}; the engine
    // must resolve that alias to the PROS feed and disclose network-vs-token.
    const { out } = await runEngine("get_token_price", JSON.stringify({ symbol: "PHAROS" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.symbol, "PROS");
    assert.strictEqual(out.pair, "PROS/USD");
    assert.strictEqual(out.aliased, true);
    assert.match(out.aliasNote, /Pharos is the network/i);
  });

  it("WPROS alias prices via the PROS feed", async () => {
    mock = startMock();
    const { out } = await runEngine("get_token_price", "WPROS", envFor(mock));
    mock.close();
    assert.strictEqual(out.symbol, "PROS");
    assert.strictEqual(out.aliased, true);
  });

  it("USDT is feed-only: prices, but discloses no wallet-balance/token support", async () => {
    mock = startMock();
    const { out } = await runEngine("get_token_price", "USDT", envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.pair, "USDT/USD");
    assert.match(out.note, /feed-only|not claimed/i);
  });

  it("unknown symbol → FEED_NOT_CONFIGURED with supported list, never a guessed price", async () => {
    mock = startMock();
    const { out } = await runEngine("get_token_price", "FOOBAR", envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "FEED_NOT_CONFIGURED");
    assert.ok(Array.isArray(out.supportedSymbols) && out.supportedSymbols.includes("PROS"));
    assert.ok(!("price" in out));
  });

  it("stale feed (heartbeat violated) → FEED_STALE, last answer labeled, not served as current", async () => {
    mock = startMock({ feedAgeSeconds: 100000 });
    const { out } = await runEngine("get_token_price", "PROS", envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "FEED_STALE");
    assert.strictEqual(out.stale, true);
    assert.ok(out.lastKnownAnswer && !("price" in out));
  });

  it("non-positive feed answer → PROVIDER_UNAVAILABLE, no price", async () => {
    mock = startMock({ feedAnswer: "0" });
    const { out } = await runEngine("get_token_price", "PROS", envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "PROVIDER_UNAVAILABLE");
    assert.ok(!("price" in out));
  });
});

describe("Anvita engine — get_token_balance (read-only)", () => {
  const WALLET = "0x1111111111111111111111111111111111111111";
  const USDC = "0xc879c018db60520f4355c26ed1a6d572cdac1815"; // canonical, from known-pharos.json

  it("native PROS balance via eth_getBalance", async () => {
    const mock = startMock({ nativeBalance: "0xde0b6b3a7640000" }); // 1e18
    try {
      const { out, status } = await runEngine("get_token_balance", JSON.stringify({ address: WALLET }), envFor(mock));
      assert.strictEqual(status, 0);
      assert.strictEqual(out.token, "native");
      assert.strictEqual(out.tokenSymbol, "PROS");
      assert.strictEqual(out.balanceFormatted, "1");
    } finally { mock.close(); }
  });

  it("ERC-20 balance by canonical symbol resolves the bundled address and formats by decimals", async () => {
    const mock = startMock({ tokenBalance: "500000", decimalsValue: 6, symbol: "USDC" });
    try {
      const { out, status } = await runEngine("get_token_balance", JSON.stringify({ address: WALLET, token: "usdc" }), envFor(mock));
      assert.strictEqual(status, 0);
      assert.strictEqual(out.token, USDC);
      assert.strictEqual(out.tokenSymbol, "USDC");
      assert.strictEqual(out.tokenDecimals, 6);
      assert.strictEqual(out.balanceRaw, "500000");
      assert.strictEqual(out.balanceFormatted, "0.5");
    } finally { mock.close(); }
  });

  it("balanceOf returning no data is UNKNOWN, never zero (fail-closed)", async () => {
    const mock = startMock({}); // tokenBalance null → balanceOf answers "0x"
    try {
      const { out, status } = await runEngine("get_token_balance", JSON.stringify({ address: WALLET, token: "0x2222222222222222222222222222222222222222" }), envFor(mock));
      assert.strictEqual(status, 1);
      assert.strictEqual(out.error.code, "TOKEN_READ_FAILED");
      assert.ok(/not zero/i.test(out.error.message));
    } finally { mock.close(); }
  });

  it("an unrecognized token name fails closed with UNKNOWN_ALIAS, no guessing", async () => {
    const mock = startMock({});
    try {
      const { out, status } = await runEngine("get_token_balance", JSON.stringify({ address: WALLET, token: "pepe" }), envFor(mock));
      assert.strictEqual(status, 1);
      assert.strictEqual(out.error.code, "UNKNOWN_ALIAS");
      assert.strictEqual(mock.methodsCalled.length, 0, "must fail before any RPC call");
    } finally { mock.close(); }
  });
});

describe("Anvita engine — portfolio snapshot & holdings exposure", () => {
  const WALLET = "0x1111111111111111111111111111111111111111";

  it("get_portfolio values native + canonical tokens from live-feed reads", async () => {
    // 1 PROS native + 2.0 of each of the 4 canonical tokens, everything at
    // the mock feed price 0.39 with 18 decimals: (1 + 4*2) * 0.39 = 3.51.
    const mock = startMock({ nativeBalance: "0xde0b6b3a7640000", tokenBalance: (2n * 10n ** 18n).toString() });
    try {
      const { out, status } = await runEngine("get_portfolio", JSON.stringify({ address: WALLET }), envFor(mock));
      assert.strictEqual(status, 0);
      assert.strictEqual(out.assets.length, 5);
      assert.strictEqual(out.totals.unpriceableCount, 0);
      assert.ok(Math.abs(out.totals.priceableUsd - 3.51) < 1e-6, `priceableUsd ${out.totals.priceableUsd}`);
      const pros = out.assets.find((a) => a.symbol === "PROS");
      assert.strictEqual(pros.balanceFormatted, "1");
      assert.strictEqual(pros.address, null);
    } finally { mock.close(); }
  });

  it("stale feeds are disclosed and excluded from the total, never guessed", async () => {
    const mock = startMock({ nativeBalance: "0xde0b6b3a7640000", tokenBalance: (2n * 10n ** 18n).toString(), feedAgeSeconds: 999999 });
    try {
      const { out } = await runEngine("get_portfolio", JSON.stringify({ address: WALLET }), envFor(mock));
      assert.strictEqual(out.totals.priceableUsd, 0);
      assert.strictEqual(out.totals.unpriceableCount, 5);
      for (const a of out.assets) {
        assert.strictEqual(a.valueUsd, null);
        assert.ok(/never guessed/.test(a.note), a.note);
      }
    } finally { mock.close(); }
  });

  it("transfer intent moving ~90% of priceable holdings gets the near-total exposure factor", async () => {
    // Wallet holds 1 PROS and nothing else priceable (token balanceOf answers
    // no data); transferring 0.9 PROS is 90% of priceable holdings.
    const mock = startMock({ nativeBalance: "0xde0b6b3a7640000" });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "transfer", toAddress: "0x5555555555555555555555555555555555555555", amount: "0.9", walletAddress: WALLET }), envFor(mock));
      assert.ok(out.riskFactors.some((f) => /90% of the wallet's priceable holdings/.test(f) && /near-total/.test(f)), JSON.stringify(out.riskFactors));
    } finally { mock.close(); }
  });

  it("unpriceable tokenIn yields one disclosure factor and NO score change", async () => {
    const swap = (amount) => JSON.stringify({ subjectType: "intent", action: "swap", tokenIn: "0x2222222222222222222222222222222222222222", tokenOut: "0x3333333333333333333333333333333333333333", walletAddress: WALLET, ...(amount ? { amount } : {}) });
    const a = startMock({});
    const b = startMock({});
    try {
      const { out: withAmount } = await runEngine("analyze", swap("5"), envFor(a));
      const { out: withoutAmount } = await runEngine("analyze", swap(null), envFor(b));
      assert.ok(withAmount.riskFactors.some((f) => /Portfolio exposure not evaluated/.test(f) && /no score change/.test(f)));
      assert.strictEqual(withAmount.riskScore, withoutAmount.riskScore, "disclosure must not move the score");
    } finally { a.close(); b.close(); }
  });
});

describe("Anvita engine — vault & pool safety probes", () => {
  const VAULT = "0x6666666666666666666666666666666666666666";
  const POOL = "0x7777777777777777777777777777777777777777";
  const TOKEN_A = "0x8888888888888888888888888888888888888888";
  const TOKEN_B = "0x9999999999999999999999999999999999999999";
  const encAddrWord = (a) => "0x" + a.toLowerCase().slice(2).padStart(64, "0");
  const SELX = {
    asset: "0x38d52e0f", totalAssets: "0x01e1d114", timelock: "0xd33219b4",
    curator: "0xe66f53b7", guardian: "0x452a9320",
    token0: "0x0dfe1681", token1: "0xd21220a7", getReserves: "0x0902f1ac",
    dodoBase: "0x4a248d2a", dodoQuote: "0xd4b97046", dodoBaseReserve: "0x7d721504", dodoQuoteReserve: "0xbbf5ce78",
  };

  it("ERC-4626 vault: underlying asset composed escalate-only, unverified floor at warn", async () => {
    const mock = startMock({
      callResults: {
        [`${VAULT}|${SELX.asset}`]: encAddrWord(TOKEN_A),
        [`${VAULT}|${SELX.totalAssets}`]: encUint(10n ** 18n),
        [`${VAULT}|${SELX.timelock}`]: encUint(86400),
      },
    });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "vault", address: VAULT }), envFor(mock));
      assert.strictEqual(out.success, true);
      assert.strictEqual(out.subject.type, "vault");
      assert.strictEqual(out.onChain.vault.asset, TOKEN_A);
      assert.ok(out.components.underlyingAsset);
      assert.ok(out.riskScore >= 45, "unverified vault must never fall below the review floor");
      assert.ok(out.riskFactors.some((f) => /not registry-verified/i.test(f)) || out.riskScore > 45);
      assert.notStrictEqual(out.recommendation, "allow");
    } finally { mock.close(); }
  });

  it("vault with zero timelock and zero assets surfaces both findings", async () => {
    const mock = startMock({
      callResults: {
        [`${VAULT}|${SELX.asset}`]: encAddrWord(TOKEN_A),
        [`${VAULT}|${SELX.totalAssets}`]: encUint(0),
        [`${VAULT}|${SELX.timelock}`]: encUint(0),
        [`${VAULT}|${SELX.curator}`]: encAddrWord(TOKEN_B),
      },
    });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "vault", address: VAULT }), envFor(mock));
      assert.ok(out.riskFactors.some((f) => /timelock is 0 seconds/i.test(f)));
      assert.ok(out.riskFactors.some((f) => /zero assets/i.test(f)));
      assert.ok(out.riskFactors.some((f) => /No guardian/i.test(f)));
    } finally { mock.close(); }
  });

  it("a contract without asset() is held for review, never classified as a vault", async () => {
    const mock = startMock({});
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "vault", address: VAULT }), envFor(mock));
      assert.strictEqual(out.riskScore, 60);
      assert.ok(out.riskFactors.some((f) => /cannot classify this contract as a vault/i.test(f)));
      assert.strictEqual(out.onChain.vault, null);
    } finally { mock.close(); }
  });

  it("v2 pool: both tokens analyzed, reserves read, unverified floor at warn", async () => {
    const mock = startMock({
      callResults: {
        [`${POOL}|${SELX.token0}`]: encAddrWord(TOKEN_A),
        [`${POOL}|${SELX.token1}`]: encAddrWord(TOKEN_B),
        [`${POOL}|${SELX.getReserves}`]: "0x" + BigInt(5000).toString(16).padStart(64, "0") + BigInt(7000).toString(16).padStart(64, "0") + BigInt(1).toString(16).padStart(64, "0"),
      },
    });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "pool", address: POOL }), envFor(mock));
      assert.strictEqual(out.onChain.pool.shape, "v2-pair");
      assert.strictEqual(out.onChain.pool.token0, TOKEN_A);
      assert.strictEqual(out.onChain.pool.token1, TOKEN_B);
      assert.strictEqual(out.onChain.pool.reserve0Raw, "5000");
      assert.ok(out.components.token0 && out.components.token1);
      assert.ok(out.riskScore >= 45);
      assert.notStrictEqual(out.recommendation, "allow");
    } finally { mock.close(); }
  });

  it("pool with a zero reserve warns about missing exit liquidity", async () => {
    const mock = startMock({
      callResults: {
        [`${POOL}|${SELX.token0}`]: encAddrWord(TOKEN_A),
        [`${POOL}|${SELX.token1}`]: encAddrWord(TOKEN_B),
        [`${POOL}|${SELX.getReserves}`]: "0x" + "0".repeat(64) + BigInt(7000).toString(16).padStart(64, "0") + "0".repeat(64),
      },
    });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "pool", address: POOL }), envFor(mock));
      assert.ok(out.riskFactors.some((f) => /empty or drained/i.test(f)));
    } finally { mock.close(); }
  });

  it("pool escalates to its worst side: an impersonation token0 dominates the verdict", async () => {
    // Every erc20Probe answers symbol "USDC"; TOKEN_A is not the canonical
    // USDC address, so the token analysis flags impersonation (+75) and the
    // pool verdict must floor at that score (escalate-only composition).
    const mock = startMock({
      symbol: "USDC",
      callResults: {
        [`${POOL}|${SELX.token0}`]: encAddrWord(TOKEN_A),
        [`${POOL}|${SELX.token1}`]: encAddrWord(TOKEN_B),
        [`${POOL}|${SELX.getReserves}`]: "0x" + BigInt(5000).toString(16).padStart(64, "0") + BigInt(7000).toString(16).padStart(64, "0") + BigInt(1).toString(16).padStart(64, "0"),
      },
    });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "pool", address: POOL }), envFor(mock));
      assert.ok(out.components.token0.riskScore >= 75, "token0 analysis must flag impersonation");
      assert.ok(out.riskScore >= out.components.token0.riskScore, "pool must never score safer than its worst token");
      assert.strictEqual(out.recommendation, "block");
    } finally { mock.close(); }
  });

  it("DODO machine shape is recognized via base/quote getters", async () => {
    const mock = startMock({
      callResults: {
        [`${POOL}|${SELX.dodoBase}`]: encAddrWord(TOKEN_A),
        [`${POOL}|${SELX.dodoQuote}`]: encAddrWord(TOKEN_B),
        [`${POOL}|${SELX.dodoBaseReserve}`]: encUint(1000),
        [`${POOL}|${SELX.dodoQuoteReserve}`]: encUint(2000),
      },
    });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "pool", address: POOL }), envFor(mock));
      assert.strictEqual(out.onChain.pool.shape, "dodo-machine");
      assert.strictEqual(out.onChain.pool.baseToken, TOKEN_A);
      assert.strictEqual(out.onChain.pool.quoteReserveRaw, "2000");
    } finally { mock.close(); }
  });

  it("a contract with neither pool shape is held for review", async () => {
    const mock = startMock({});
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "pool", address: POOL }), envFor(mock));
      assert.strictEqual(out.riskScore, 60);
      assert.ok(out.riskFactors.some((f) => /cannot classify this contract as a pool/i.test(f)));
    } finally { mock.close(); }
  });
});

describe("Anvita engine — EIP-1967 proxy inspection (direct storage reads)", () => {
  const ADDR = "0x2222222222222222222222222222222222222222";
  const IMPL = "0x3333333333333333333333333333333333333333";

  it("non-proxy contract reports isProxy false and no proxy factor", async () => {
    const mock = startMock({});
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: ADDR }), envFor(mock));
      assert.strictEqual(out.onChain.proxy.isProxy, false);
      assert.ok(!out.riskFactors.some((f) => /EIP-1967/.test(f)), "no proxy factor expected");
    } finally { mock.close(); }
  });

  it("proxy with a live implementation surfaces the upgradeable factor and evidence", async () => {
    const mock = startMock({ proxyImpl: IMPL });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: ADDR }), envFor(mock));
      assert.strictEqual(out.onChain.proxy.isProxy, true);
      assert.strictEqual(out.onChain.proxy.implementation, IMPL);
      assert.strictEqual(out.onChain.proxy.implementationHasCode, true);
      assert.ok(out.riskFactors.some((f) => /upgradeable proxy, EIP-1967/i.test(f) && f.includes(IMPL)));
    } finally { mock.close(); }
  });

  it("proxy whose implementation has NO code escalates hard (broken or deceptive)", async () => {
    const base = startMock({ proxyImpl: IMPL });
    const broken = startMock({ proxyImpl: IMPL, emptyCodeAddrs: [IMPL] });
    try {
      const { out: ok } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: ADDR }), envFor(base));
      const { out: bad } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: ADDR }), envFor(broken));
      assert.strictEqual(bad.onChain.proxy.implementationHasCode, false);
      assert.ok(bad.riskFactors.some((f) => /NO code/.test(f) && /proxy/i.test(f)));
      assert.ok(bad.riskScore > ok.riskScore, "codeless implementation must score strictly worse");
    } finally { base.close(); broken.close(); }
  });

  it("beacon proxy (implementation slot empty, beacon set) is still flagged upgradeable", async () => {
    const mock = startMock({ proxyBeacon: IMPL });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: ADDR }), envFor(mock));
      assert.strictEqual(out.onChain.proxy.isProxy, true);
      assert.ok(out.riskFactors.some((f) => /beacon proxy/i.test(f)));
    } finally { mock.close(); }
  });

  it("slotToAddress accepts only cleanly-padded nonzero addresses", async () => {
    const { slotToAddress } = await import(new URL("../anvita/safehands/scripts/safehands-engine.js", import.meta.url));
    assert.strictEqual(slotToAddress("0x" + "00".repeat(12) + "33".repeat(20)), "0x" + "33".repeat(20));
    assert.strictEqual(slotToAddress("0x" + "0".repeat(64)), null, "zero slot is not a proxy");
    assert.strictEqual(slotToAddress("0x" + "ab" + "0".repeat(22) + "33".repeat(20)), null, "dirty padding must not decode");
    assert.strictEqual(slotToAddress(null), null);
  });
});

describe("Anvita engine — transaction introspection (read-only)", () => {
  let mock;
  after(() => mock?.close());

  it("check_allowance reports unlimited approval risk", async () => {
    mock = startMock({ allowance: (2n ** 256n - 1n).toString() });
    const { out } = await runEngine("check_allowance", JSON.stringify({ token: "0x1111111111111111111111111111111111111111", owner: "0x2222222222222222222222222222222222222222", spender: "0x3333333333333333333333333333333333333333" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.approvalRisk, "unlimited");
    assert.match(out.approvalRiskHint, /UNLIMITED/);
  });

  it("check_allowance reports scoped approval risk", async () => {
    mock = startMock({ allowance: "1000000", decimalsValue: 6 });
    const { out } = await runEngine("check_allowance", JSON.stringify({ token: "0x1111111111111111111111111111111111111111", owner: "0x2222222222222222222222222222222222222222", spender: "0x3333333333333333333333333333333333333333" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.approvalRisk, "scoped");
    assert.strictEqual(out.allowanceFormatted, "1");
  });

  it("get_transaction_status: pending / success / failed / not_found", async () => {
    const hPending = "0x" + "11".repeat(32), hSuccess = "0x" + "22".repeat(32), hFailed = "0x" + "33".repeat(32), hMissing = "0x" + "44".repeat(32);
    mock = startMock({
      txByHash: {
        [hPending]: { hash: hPending, blockNumber: null, from: "0xaa", to: "0xbb" },
        [hSuccess]: { hash: hSuccess, blockNumber: "0x100", from: "0xaa", to: "0xbb" },
        [hFailed]: { hash: hFailed, blockNumber: "0x101", from: "0xaa", to: "0xbb" },
      },
      txReceipt: {
        [hSuccess]: { status: "0x1", blockNumber: "0x100", gasUsed: "0x5208", from: "0xaa", to: "0xbb" },
        [hFailed]: { status: "0x0", blockNumber: "0x101", gasUsed: "0x5208", from: "0xaa", to: "0xbb" },
      },
    });
    const pending = await runEngine("get_transaction_status", hPending, envFor(mock));
    const success = await runEngine("get_transaction_status", hSuccess, envFor(mock));
    const failed = await runEngine("get_transaction_status", hFailed, envFor(mock));
    const missing = await runEngine("get_transaction_status", hMissing, envFor(mock));
    mock.close();
    assert.strictEqual(pending.out.status, "pending");
    assert.strictEqual(success.out.status, "success");
    assert.strictEqual(failed.out.status, "failed");
    assert.strictEqual(missing.out.status, "not_found");
  });

  it("estimate_gas success returns a numeric estimate, broadcast:false", async () => {
    mock = startMock({ estimateGas: "success" });
    const { out } = await runEngine("estimate_gas", JSON.stringify({ from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222", valueWei: "0" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.estimatedGas, 28470);
    assert.strictEqual(out.broadcast, false);
  });

  it("estimate_gas revert → structured ESTIMATE_FAILED, broadcast:false", async () => {
    mock = startMock({ estimateGas: "revert" });
    const { out } = await runEngine("estimate_gas", JSON.stringify({ to: "0x2222222222222222222222222222222222222222", data: "0xdeadbeef" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "ESTIMATE_FAILED");
    assert.strictEqual(out.broadcast, false);
  });

  it("simulate_transaction returns eth_call return data, broadcast:false", async () => {
    mock = startMock({ symbol: "GOOD" });
    const { out } = await runEngine("simulate_transaction", JSON.stringify({ to: "0x1111111111111111111111111111111111111111", data: SEL.symbol }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.reverted, false);
    assert.strictEqual(out.broadcast, false);
    assert.ok(out.returnData.startsWith("0x"));
  });

  it("get_spv_proof returns proof when eth_getProof is supported", async () => {
    mock = startMock({ getProof: "success" });
    const { out } = await runEngine("get_spv_proof", JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.ok(out.proof && out.proof.storageHash);
  });

  it("get_spv_proof → NOT_SUPPORTED when the RPC lacks eth_getProof", async () => {
    mock = startMock({ getProof: "unsupported" });
    const { out } = await runEngine("get_spv_proof", JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "NOT_SUPPORTED");
    assert.ok(!("proof" in out));
  });
});

describe("Anvita engine — provider-gated commands (not configured today)", () => {
  let mock;
  after(() => mock?.close());

  it("query_goldsky_subgraph → GOLDSKY_NOT_CONFIGURED", async () => {
    mock = startMock();
    const { out } = await runEngine("query_goldsky_subgraph", JSON.stringify({ query: "{ tokens { id } }" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "GOLDSKY_NOT_CONFIGURED");
    assert.strictEqual(out.providerStatus, "not_configured");
  });

  it("get_execution_history → HISTORY_PROVIDER_NOT_CONFIGURED", async () => {
    mock = startMock();
    const { out } = await runEngine("get_execution_history", JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.error.code, "HISTORY_PROVIDER_NOT_CONFIGURED");
    assert.strictEqual(out.providerStatus, "not_configured");
  });

  it("get_pool_info → PROVIDER_NOT_CONFIGURED", async () => {
    mock = startMock();
    const { out } = await runEngine("get_pool_info", JSON.stringify({ poolAddress: "0x1111111111111111111111111111111111111111" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.error.code, "PROVIDER_NOT_CONFIGURED");
    assert.strictEqual(out.providerStatus, "not_configured");
  });

  it("provider commands reject secret/auth fields", async () => {
    mock = startMock();
    const { out } = await runEngine("query_goldsky_subgraph", JSON.stringify({ query: "{ x }", apiKey: "should-not-be-here" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "VALIDATION_ERROR");
  });
});

describe("Anvita engine — RealFi intents (fail-closed)", () => {
  let mock;
  after(() => mock?.close());

  it("bridge intent with no router address → warn + missingInputs", async () => {
    mock = startMock({ symbol: "GOOD", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "bridge", walletAddress: "0x1111111111111111111111111111111111111111", token: "0x2222222222222222222222222222222222222222" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.missingInputs.some((m) => /bridgeContract|targetContract/i.test(m)));
  });

  it("yield_deposit to a contractless target → block (no code to interact with)", async () => {
    const target = "0x0000000000000000000000000000000000000009";
    mock = startMock({ symbol: "GOOD", goplusResult: {}, emptyCodeAddrs: [target] });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "yield_deposit", walletAddress: "0x1111111111111111111111111111111111111111", token: "0x2222222222222222222222222222222222222222", targetContract: target }), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "block");
    assert.strictEqual(out.vaultRiskScore, out.riskScore);
    assert.strictEqual(out.vaultProviderData.providerStatus, "not_configured");
    assert.strictEqual(out.vaultProviderData.apy, null);
  });

  it("vault_deposit to an unknown (non-canonical) vault with code → does not allow", async () => {
    mock = startMock({ symbol: "GOOD", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "vault_deposit", walletAddress: "0x1111111111111111111111111111111111111111", token: "0x2222222222222222222222222222222222222222", vault: "0x4444444444444444444444444444444444444444" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.notStrictEqual(out.recommendation, "allow");
  });

  it("staking intent to an unknown (non-canonical) contract → at least warn", async () => {
    mock = startMock({ symbol: "GOOD", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "staking", walletAddress: "0x1111111111111111111111111111111111111111", stakingContract: "0x3333333333333333333333333333333333333333" }), envFor(mock));
    mock.close();
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.riskScore >= 31);
  });

  it("tokenized_asset intent surfaces a not-verifiable-backing note", async () => {
    mock = startMock({ symbol: "GOOD", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "tokenized_asset", walletAddress: "0x1111111111111111111111111111111111111111", market: "0x3333333333333333333333333333333333333333" }), envFor(mock));
    mock.close();
    assert.ok(out.intentNotes.some((n) => /backing|offering documents/i.test(n)));
    assert.notStrictEqual(out.recommendation, "allow");
  });

  it("fiat_ramp intent flags a non-HTTPS local URL and needs no wallet", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "fiat_ramp", url: "http://127.0.0.1:8080/pay" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.recommendation, "block");
    assert.strictEqual(out.components.url.fetched, false);
  });

  it("reward_campaign intent returns a structured verdict and legitimacy caveat", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "reward_campaign", url: "https://claims.example.com/airdrop" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.ok(["allow", "warn", "block"].includes(out.recommendation));
    assert.ok(out.intentNotes.some((n) => /legitimate|endorsement/i.test(n)));
  });

  it("x402_payment intent never fetches the URL", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "x402_payment", url: "https://api.example.com/x402", payTo: "0x2222222222222222222222222222222222222222" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.components.url.fetched, false);
    assert.ok(out.evidenceUsed.some((e) => /never fetches/i.test(e)));
  });

  it("fund-moving intent still requires a wallet address", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "vault_deposit", vault: "0x3333333333333333333333333333333333333333" }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error.code, "VALIDATION_ERROR");
  });
});

describe("Anvita engine — read-only invariant", () => {
  const WRITE_RE = /send|sign|personal_|unlock|sendraw|submitwork|importraw/i;
  const READ_ONLY_ALLOWED = new Set([
    "eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_getTransactionCount",
    "eth_getCode", "eth_call", "eth_gasPrice", "eth_estimateGas",
    "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getProof",
    "eth_getStorageAt",
  ]);

  it("a full command battery only ever issues read-only JSON-RPC methods", async () => {
    const mock = startMock({ symbol: "GOOD", goplusResult: {} });
    const env = envFor(mock);
    const tok = "0x2222222222222222222222222222222222222222";
    await runEngine("health", undefined, env);
    await runEngine("get_gas_price", undefined, env);
    await runEngine("get_token_price", "PROS", env);
    await runEngine("check_allowance", JSON.stringify({ token: tok, owner: "0x1111111111111111111111111111111111111111", spender: "0x3333333333333333333333333333333333333333" }), env);
    await runEngine("get_transaction_status", "0x" + "ab".repeat(32), env);
    await runEngine("estimate_gas", JSON.stringify({ to: tok, valueWei: "0" }), env);
    await runEngine("simulate_transaction", JSON.stringify({ to: tok, data: SEL.symbol }), env);
    await runEngine("get_spv_proof", JSON.stringify({ address: tok }), env);
    await runEngine("get_token_balance", JSON.stringify({ address: "0x1111111111111111111111111111111111111111", token: tok }), env);
    await runEngine("get_portfolio", JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }), env);
    await runEngine("get_active_approvals", JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }), env);
    await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: tok }), env);
    await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "bridge", walletAddress: "0x1111111111111111111111111111111111111111", token: tok, bridgeContract: "0x3333333333333333333333333333333333333333" }), env);
    const methods = mock.methodsCalled;
    mock.close();
    assert.ok(methods.length > 0);
    for (const m of methods) {
      assert.ok(!WRITE_RE.test(m), `write-shaped RPC method leaked: ${m}`);
      assert.ok(READ_ONLY_ALLOWED.has(m), `unexpected RPC method (not in read-only allowlist): ${m}`);
    }
  });
});

describe("Anvita engine — get_active_approvals (allowance sweep)", () => {
  const OWNER = "0x1111111111111111111111111111111111111111";

  it("clean sweep: zero allowances everywhere reports no approvals, with honest limits", async () => {
    const mock = startMock({ allowance: "0" });
    try {
      const { out } = await runEngine("get_active_approvals", JSON.stringify({ address: OWNER }), envFor(mock));
      assert.strictEqual(out.success, true);
      assert.strictEqual(out.summary.activeApprovals, 0);
      assert.ok(out.summary.pairsChecked >= 36, `expected the full canonical x verified sweep, got ${out.summary.pairsChecked}`);
      assert.match(out.limits, /outside the bundled registry|indexer/i, "the sweep must disclose what it cannot see");
      assert.match(out.nextAction, /no active approvals/i);
    } finally { mock.close(); }
  });

  it("an unlimited allowance is classified and drives the revoke nextAction", async () => {
    const unlimited = (2n ** 256n - 1n).toString();
    const mock = startMock({ allowance: unlimited });
    try {
      const { out } = await runEngine("get_active_approvals", JSON.stringify({ address: OWNER }), envFor(mock));
      assert.strictEqual(out.success, true);
      assert.ok(out.summary.unlimited > 0, "unlimited approvals must be counted");
      assert.strictEqual(out.approvals[0].unlimited, true);
      assert.strictEqual(out.approvals[0].allowanceFormatted, "unlimited");
      assert.match(out.approvals[0].note, /UNLIMITED/);
      assert.match(out.nextAction, /revoke/i);
    } finally { mock.close(); }
  });

  it("a finite allowance is reported scoped with a formatted amount", async () => {
    const mock = startMock({ allowance: (5n * 10n ** 18n).toString() });
    try {
      const { out } = await runEngine("get_active_approvals", JSON.stringify({ address: OWNER }), envFor(mock));
      assert.strictEqual(out.success, true);
      assert.ok(out.approvals.length > 0);
      assert.strictEqual(out.approvals[0].unlimited, false);
      assert.strictEqual(out.approvals[0].allowanceFormatted, "5");
    } finally { mock.close(); }
  });

  it("rejects a malformed owner address", async () => {
    const mock = startMock();
    try {
      const { out } = await runEngine("get_active_approvals", JSON.stringify({ address: "0x123" }), envFor(mock));
      assert.strictEqual(out.success, false);
      assert.strictEqual(out.error.code, "VALIDATION_ERROR");
    } finally { mock.close(); }
  });

  it("all reads failing is UNKNOWN, never a clean result", async () => {
    const { out } = await runEngine("get_active_approvals", JSON.stringify({ address: OWNER }), {
      PHAROS_RPC_URL: "http://127.0.0.1:1", GOPLUS_API_BASE: "http://127.0.0.1:1",
    });
    assert.strictEqual(out.success, false, "an unreachable chain must not read as approval-clean");
  });
});

describe("Anvita engine — codehash recognition & drift", () => {
  const MORPHO_BLUE = "0x18573fa18fd17ddfd790b4a5b5b2977aad3b4efb"; // registry-verified, has a recorded codeHash

  it("known-code lookup matches a recorded hash and rejects an unknown one", async () => {
    const { knownCodeMatch, KNOWN_CODEHASHES } = await import("../anvita/safehands/scripts/safehands-engine.js");
    const [recordedHash, entry] = Object.entries(KNOWN_CODEHASHES)[0];
    const hit = knownCodeMatch(recordedHash);
    assert.ok(hit, "a recorded codehash must resolve to its verified contract");
    assert.strictEqual(hit.label, entry.label);
    assert.strictEqual(knownCodeMatch("0x" + "00".repeat(32)), null, "an unknown codehash must not match");
    assert.strictEqual(knownCodeMatch(null), null);
  });

  it("silent-change guard: a verified address whose live code no longer matches the recorded hash fails closed", async () => {
    // The mock serves generic bytecode for MORPHO_BLUE, whose hash cannot equal
    // the real recorded Morpho hash, so this exercises the drift branch.
    const mock = startMock();
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: MORPHO_BLUE }), envFor(mock));
      assert.strictEqual(out.recommendation, "block");
      assert.strictEqual(out.onChain.codeHashMatchesRegistry, false);
      assert.match(out.riskFactors.join(" "), /no longer matches|silent/i);
    } finally { mock.close(); }
  });

  it("surfaces a computed codeHash on every contract analysis", async () => {
    const target = "0x2222222222222222222222222222222222222222";
    const bytecode = "0x" + "61".repeat(64);
    const mock = startMock({ symbol: "GOOD", goplusResult: {}, codeByAddr: { [target]: bytecode } });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: target }), envFor(mock));
      const { keccak256 } = await import("../anvita/safehands/scripts/safehands-engine.js");
      assert.strictEqual(out.onChain.codeHash, keccak256(Buffer.from(bytecode.slice(2), "hex")), "codeHash must be keccak256 of the served bytecode");
    } finally { mock.close(); }
  });

  it("NEVER recognizes an attacker's contract by a shared proxy-shell codehash (false-ALLOW guard)", async () => {
    // A generic ERC-1967 proxy reads its implementation from a storage slot, so
    // its runtime bytecode (and codehash) is identical across every unrelated
    // deployment. This is the exact 170-byte AquaFluxCore proxy shell. An
    // attacker deploying any standard ERC-1967 proxy would share it. Recognizing
    // by this hash would let the firewall vouch for an attacker's contract by
    // name and return ALLOW. It must not: a proxy is identified by its
    // implementation, never by its shell.
    const AQUAFLUX_PROXY_SHELL = "0x6080604052600a600c565b005b60186014601a565b6051565b565b6000604c7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc546001600160a01b031690565b905090565b3660008037600080366000845af43d6000803e808015606f573d6000f35b3d6000fdfea264697066735822122051da5b51f2e43cd956e2b3e18d302642bb371a72f196cc4a9776ab84ef5e725a64736f6c634300081d0033";
    const attacker = "0xdeadbeef00000000000000000000000000000001";
    const maliciousImpl = "0xbaddad0000000000000000000000000000000002";
    const mock = startMock({ codeByAddr: { [attacker]: AQUAFLUX_PROXY_SHELL }, proxyImpl: maliciousImpl });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: attacker }), envFor(mock));
      assert.strictEqual(out.onChain.codeRecognizedAs, undefined, "an attacker proxy must NOT be recognized as a verified contract");
      assert.doesNotMatch(out.riskFactors.join(" "), /exact same code as AquaFlux|byte-identical to AquaFlux/i, "the firewall must not vouch for the attacker by name");
      assert.notStrictEqual(out.recommendation, "allow", "an unverified attacker proxy must never read ALLOW");
    } finally { mock.close(); }
  });

  it("still recognizes a genuine non-proxy copy by codehash (recognition preserved)", async () => {
    const { KNOWN_CODEHASHES } = await import("../anvita/safehands/scripts/safehands-engine.js");
    // A registry-verified NON-proxy contract's codehash must still resolve.
    const entries = Object.entries(KNOWN_CODEHASHES);
    assert.ok(entries.length > 0, "recognition map must not be empty after the proxy-shell exclusion");
  });

  it("an unrecognized non-token contract is still flagged as unverified custom code", async () => {
    const target = "0x3333333333333333333333333333333333333333";
    // Force a non-token surface: symbol()/name() return no data → not a token,
    // and the served bytecode's hash is not in known-code → no recognition.
    const mock = startMock({ goplusResult: {}, callResults: { [SEL.symbol]: "0x", [SEL.name]: "0x" } });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: target }), envFor(mock));
      assert.match(out.riskFactors.join(" "), /unverified custom contract/i, "no codehash match means no recognition");
    } finally { mock.close(); }
  });
});

describe("Anvita engine — permissioned RWA / security tokens", () => {
  const encAddr32 = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const IR = "0x1010101010101010101010101010101010101010";
  const COMPLIANCE = "0x2020202020202020202020202020202020202020";
  // ERC-3643 selectors (mirror the engine SEL block)
  const S = { identityRegistry: "0x134e18f4", compliance: "0x6290865d", paused: "0x5c975abb", isFrozen: "0xe5839836", isVerified: "0xb9209e33", isControllable: "0x4c783bf5" };

  it("detects an ERC-3643 permissioned RWA token and discloses the identity gating", async () => {
    const token = "0x4444444444444444444444444444444444444444";
    const mock = startMock({ goplusResult: {}, callResults: {
      [`${token}|${S.identityRegistry}`]: encAddr32(IR),
      [`${token}|${S.compliance}`]: encAddr32(COMPLIANCE),
      [`${token}|${S.paused}`]: encUint(0),
    } });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: token }), envFor(mock));
      assert.strictEqual(out.onChain.permissioned.standard, "ERC-3643");
      assert.strictEqual(out.onChain.permissioned.identityRegistry, IR);
      assert.match(out.riskFactors.join(" "), /permissioned RWA token, ERC-3643/i);
    } finally { mock.close(); }
  });

  it("a paused ERC-3643 token escalates and says transfers are blocked", async () => {
    const token = "0x4444444444444444444444444444444444444444";
    const mock = startMock({ goplusResult: {}, callResults: {
      [`${token}|${S.identityRegistry}`]: encAddr32(IR),
      [`${token}|${S.paused}`]: encUint(1),
    } });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: token }), envFor(mock));
      assert.match(out.riskFactors.join(" "), /PAUSED/);
    } finally { mock.close(); }
  });

  it("swap: an unverified wallet against an ERC-3643 leg is flagged as a will-revert (>= warn)", async () => {
    const tokenOut = "0x5555555555555555555555555555555555555555";
    const tokenIn = "0x6666666666666666666666666666666666666666";
    const wallet = "0x1111111111111111111111111111111111111111";
    const mock = startMock({ goplusResult: {}, callResults: {
      [`${tokenOut}|${S.identityRegistry}`]: encAddr32(IR),
      [`${tokenOut}|${S.paused}`]: encUint(0),
      [`${IR}|${S.isVerified}`]: encUint(0),          // wallet NOT verified
      [`${tokenOut}|${S.isFrozen}`]: encUint(0),
    } });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "swap", tokenIn, tokenOut, walletAddress: wallet }), envFor(mock));
      assert.ok(out.riskScore >= 70, `expected escalation to >=70, got ${out.riskScore}`);
      assert.match(out.riskFactors.join(" "), /NOT verified|will revert/i);
      assert.strictEqual(out.components.tokenOutEligibility.verified, false);
    } finally { mock.close(); }
  });

  it("swap: a verified wallet against an ERC-3643 leg adds no eligibility escalation", async () => {
    const tokenOut = "0x5555555555555555555555555555555555555555";
    const tokenIn = "0x6666666666666666666666666666666666666666";
    const wallet = "0x1111111111111111111111111111111111111111";
    const mock = startMock({ goplusResult: {}, callResults: {
      [`${tokenOut}|${S.identityRegistry}`]: encAddr32(IR),
      [`${tokenOut}|${S.paused}`]: encUint(0),
      [`${IR}|${S.isVerified}`]: encUint(1),          // wallet verified
      [`${tokenOut}|${S.isFrozen}`]: encUint(0),
    } });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "swap", tokenIn, tokenOut, walletAddress: wallet }), envFor(mock));
      assert.strictEqual(out.components.tokenOutEligibility.verified, true);
      assert.doesNotMatch(out.riskFactors.join(" "), /NOT verified in/i, "a verified wallet must not get the eligibility-revert escalation");
    } finally { mock.close(); }
  });

  it("detects an ERC-1400 controllable security token", async () => {
    const token = "0x7777777777777777777777777777777777777777";
    const mock = startMock({ goplusResult: {}, callResults: { [`${token}|${S.isControllable}`]: encUint(1) } });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: token }), envFor(mock));
      assert.strictEqual(out.onChain.permissioned.standard, "ERC-1400");
      assert.match(out.riskFactors.join(" "), /[Cc]ontrollable security token/);
    } finally { mock.close(); }
  });

  it("an ordinary ERC-20 is not flagged as permissioned", async () => {
    const token = "0x8888888888888888888888888888888888888888";
    const mock = startMock({ symbol: "GOOD", goplusResult: {} });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: token }), envFor(mock));
      assert.strictEqual(out.onChain.permissioned, undefined, "a plain ERC-20 must carry no permissioned block");
    } finally { mock.close(); }
  });
});

describe("Anvita engine — RPC fallback (availability only, never trust)", () => {
  it("serves from the fallback when the primary is unreachable, with an honest rpcNote", async () => {
    const mock = startMock();
    try {
      const { out } = await runEngine("health", undefined, {
        PHAROS_RPC_URL: "http://127.0.0.1:1", PHAROS_RPC_FALLBACK_URL: mock.url, GOPLUS_API_BASE: mock.url,
      });
      assert.strictEqual(out.success, true);
      assert.strictEqual(out.rpc, mock.url, "health must report the endpoint that actually served");
      assert.match(out.rpcNote ?? "", /fallback/i, "failover must be disclosed, never silent");
    } finally { mock.close(); }
  });

  it("refuses a wrong-chain fallback: availability never overrides chain identity", async () => {
    const wrongChain = startMock({ chainIdHex: "0x1" });
    try {
      const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "wallet", address: "0x" + "11".repeat(20) }), {
        PHAROS_RPC_URL: "http://127.0.0.1:1", PHAROS_RPC_FALLBACK_URL: wrongChain.url, GOPLUS_API_BASE: wrongChain.url,
      });
      assert.strictEqual(out.success, false, "reads from a wrong-chain endpoint must never be reported");
    } finally { wrongChain.close(); }
  });

  it("does not fail over on a JSON-RPC application error: a revert is an answer, not an outage", async () => {
    const primary = startMock({ estimateGas: "revert" });
    const fallback = startMock();
    try {
      const { out } = await runEngine("estimate_gas", JSON.stringify({ to: "0x" + "22".repeat(20), data: "0x" }), {
        PHAROS_RPC_URL: primary.url, PHAROS_RPC_FALLBACK_URL: fallback.url, GOPLUS_API_BASE: primary.url,
      });
      assert.match(JSON.stringify(out), /revert/i, "the revert answer must surface");
      const fallbackEstimates = fallback.methodsCalled.filter((m) => m === "eth_estimateGas");
      assert.strictEqual(fallbackEstimates.length, 0, "a revert must never be retried on the fallback endpoint");
    } finally { primary.close(); fallback.close(); }
  });
});
