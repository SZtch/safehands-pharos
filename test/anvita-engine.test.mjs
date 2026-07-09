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
  allowance: "0xdd62ed3e", latestAnswer: "0x50d25bcd", latestTimestamp: "0x8205bf6a",
  reputationOf: "0xdb89c044",
};
const CODE = "0x" + "60".repeat(120); // 120-byte bytecode → isContract, no small-bytecode penalty

// Start a mock that answers Pharos JSON-RPC (POST) and GoPlus (GET) on one port.
// Every option has a safe default so simpler tests stay terse.
function startMock(opts = {}) {
  const {
    symbol = "GOOD", goplusResult = null, goplusTransientFailures = 0,
    gasPrice = "0x2540be400",               // 10 gwei
    feedAnswer = "390000000000000000",       // 0.39 * 1e18
    feedAgeSeconds = 60,                      // fresh (< heartbeat)
    decimalsValue = 18,
    allowance = "0",
    estimateGas = "success",                 // "success" | "revert"
    emptyCodeAddrs = [],                     // addresses that return no code
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
        if (method === "eth_getBalance") result = "0x0";
        else if (method === "eth_getTransactionCount") result = "0x1";
        else if (method === "eth_getCode") result = empty.has(String(params?.[0] || "").toLowerCase()) ? "0x" : CODE;
        else if (method === "eth_chainId") result = "0x688"; // 1672
        else if (method === "eth_blockNumber") result = "0x100";
        else if (method === "eth_gasPrice") result = gasPrice;
        else if (method === "eth_estimateGas") {
          if (estimateGas === "revert") return void res.end(rpcError(id, 3, "execution reverted: gas estimate failed"));
          result = "0x6f36"; // 28470
        } else if (method === "eth_getTransactionByHash") result = txByHash[params?.[0]] ?? null;
        else if (method === "eth_getTransactionReceipt") result = txReceipt[params?.[0]] ?? null;
        else if (method === "eth_getProof") {
          if (getProof === "unsupported") return void res.end(rpcError(id, -32601, "the method eth_getProof does not exist/is not available"));
          result = { address: params?.[0], balance: "0x0", codeHash: "0x" + "cd".repeat(32), nonce: "0x0", storageHash: "0x" + "ab".repeat(32), accountProof: [], storageProof: [] };
        } else if (method === "eth_call") {
          const data = params?.[0]?.data ?? "";
          if (data.startsWith(SEL.symbol)) result = encString(symbol);
          else if (data.startsWith(SEL.name)) result = encString("Mock Token");
          else if (data.startsWith(SEL.decimals)) result = encUint(decimalsValue);
          else if (data.startsWith(SEL.totalSupply)) result = encUint(10n ** 24n);
          else if (data.startsWith(SEL.allowance)) result = encUint(allowance);
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
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env } });
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
