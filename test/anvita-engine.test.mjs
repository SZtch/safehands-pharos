// ─── Anvita hosted engine — the shipped deliverable ────────────────────────
// anvita/safehands/scripts/safehands-engine.js is the zero-dependency engine
// Anvita actually runs. It had no automated tests. This drives the real CLI
// artifact as a subprocess against a MOCK Pharos RPC + MOCK GoPlus so the
// decision logic is deterministic and offline (no live mainnet, no real GoPlus).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENGINE = fileURLToPath(new URL("../anvita/safehands/scripts/safehands-engine.js", import.meta.url));

// ── ABI-return encoders (match the engine's decString/decUint) ──
const word = (hex) => hex.padStart(64, "0");
const encUint = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
function encString(s) {
  const b = Buffer.from(s, "utf8");
  const data = b.length ? b.toString("hex").padEnd(Math.ceil(b.length / 32) * 64, "0") : "";
  return "0x" + word("20") + word(b.length.toString(16)) + data; // offset, length, bytes
}
const SEL = { name: "0x06fdde03", symbol: "0x95d89b41", decimals: "0x313ce567", totalSupply: "0x18160ddd" };
const CODE = "0x" + "60".repeat(120); // 120-byte bytecode → isContract, no small-bytecode penalty

// Start a mock that answers Pharos JSON-RPC (POST) and GoPlus (GET) on one port.
// goplusTransientFailures: answer 429 to the first N GoPlus GETs, then serve normally.
function startMock({ symbol = "GOOD", goplusResult = null, goplusTransientFailures = 0 } = {}) {
  let goplusHits = 0;
  const server = http.createServer((req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { method, params } = JSON.parse(body || "{}");
        let result = "0x";
        if (method === "eth_getBalance") result = "0x0";
        else if (method === "eth_getTransactionCount") result = "0x1";
        else if (method === "eth_getCode") result = CODE;
        else if (method === "eth_chainId") result = "0x688"; // 1672
        else if (method === "eth_blockNumber") result = "0x100";
        else if (method === "eth_call") {
          const data = params?.[0]?.data ?? "";
          if (data.startsWith(SEL.symbol)) result = encString(symbol);
          else if (data.startsWith(SEL.name)) result = encString("Mock Token");
          else if (data.startsWith(SEL.decimals)) result = encUint(18);
          else if (data.startsWith(SEL.totalSupply)) result = encUint(10n ** 24n);
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
      });
      return;
    }
    // GET → GoPlus
    if (goplusHits++ < goplusTransientFailures) {
      res.statusCode = 429;
      res.end("rate limited");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(goplusResult ? { code: 1, result: goplusResult } : { code: 0, message: "no data" }));
  });
  server.listen(0);
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

// Async spawn (NOT spawnSync): the mock server runs in THIS process's event
// loop, so blocking it would deadlock the child's RPC/GoPlus calls.
function runEngine(cmd, arg, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENGINE, cmd, arg], { env: { ...process.env, ...env } });
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
});

describe("Anvita engine — decision logic (mock RPC + GoPlus)", () => {
  let mock;
  after(() => mock?.close());

  it("BLOCKs a honeypot token flagged by GoPlus", async () => {
    const addr = "0x3333333333333333333333333333333333333333";
    mock = startMock({ symbol: "SCAM", goplusResult: { [addr.toLowerCase()]: { is_honeypot: "1" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url });
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.recommendation, "block");
    assert.ok(out.riskScore >= 70, `expected high score, got ${out.riskScore}`);
  });

  it("flags symbol impersonation of a canonical token", async () => {
    const addr = "0x4444444444444444444444444444444444444444"; // NOT the canonical USDC address
    mock = startMock({ symbol: "USDC", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url });
    mock.close();
    assert.strictEqual(out.success, true);
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.riskFactors.some((f) => /IMPERSONATION/i.test(f)), "should flag impersonation");
  });

  it("FAIL-CLOSED: never 'allow' an unverified token when GoPlus is unreachable", async () => {
    const addr = "0x5555555555555555555555555555555555555555";
    mock = startMock({ symbol: "GOOD" }); // clean on-chain metadata, would be low-risk on-chain-only
    // Point GoPlus at a closed port so threat-intel is genuinely unreachable.
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: "http://127.0.0.1:1" });
    mock.close();
    assert.strictEqual(out.success, true);
    assert.notStrictEqual(out.recommendation, "allow"); // the core fix: no silent fail-open
    assert.ok(out.riskFactors.some((f) => /unreachable/i.test(f)), "should disclose the unreachable threat-intel");
  });

  it("FAIL-CLOSED: never 'allow' a token GoPlus has not indexed yet (fresh-rug window)", async () => {
    const addr = "0x7777777777777777777777777777777777777777";
    // GoPlus IS reachable and answers code:1, but has no entry for this address — the
    // just-deployed-scam window. Pre-fix: +10 only → score 25 → "allow" with a caution note.
    mock = startMock({ symbol: "GOOD", goplusResult: {} });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url });
    mock.close();
    assert.strictEqual(out.success, true);
    assert.notStrictEqual(out.recommendation, "allow"); // unvetted token must never read "allow"
    assert.ok(out.riskScore > 30, `score must leave the allow band, got ${out.riskScore}`);
    assert.ok(out.riskFactors.some((f) => /not yet indexed/i.test(f) && /UNVERIFIED/i.test(f)), "should disclose unindexed-unverified status");
  });

  it("retries a transient GoPlus 429 and keeps the verified verdict (no false warn-floor)", async () => {
    const addr = "0x8888888888888888888888888888888888888888";
    // First GoPlus GET is rate-limited; the retry succeeds with a clean verdict. A clean
    // token must come back "allow" with GoPlus intel — not floored as unreachable.
    mock = startMock({ symbol: "GOOD", goplusTransientFailures: 1, goplusResult: { [addr.toLowerCase()]: { is_honeypot: "0" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url });
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.recommendation, "allow");
    assert.ok(!out.riskFactors.some((f) => /unreachable/i.test(f)), "transient 429 must not read as unreachable");
    assert.match(out.intel, /GoPlus threat intelligence/);
  });

  it("exposes display-only GoPlus token identity without affecting the verdict", async () => {
    const addr = "0x9999999999999999999999999999999999999999";
    const longName = "N".repeat(200); // must be trimmed and capped at 128
    mock = startMock({ symbol: "GOOD", goplusResult: { [addr.toLowerCase()]: { is_honeypot: "0", token_name: `  ${longName}  `, token_symbol: "GOOD" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url });
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.goplusTokenIdentity.tokenSymbol, "GOOD");
    assert.strictEqual(out.goplusTokenIdentity.tokenName.length, 128);
    assert.strictEqual(out.recommendation, "allow"); // identity metadata never scores
  });

  it("FAIL-CLOSED: never 'allow' when GoPlus returns a drifted/unrecognized schema", async () => {
    const addr = "0x6666666666666666666666666666666666666666";
    // GoPlus is reachable and returns an entry, but the honeypot field is renamed/retyped —
    // the pre-fix engine would read every flag as false and 'allow'. Must floor to unverified.
    mock = startMock({ symbol: "GOOD", goplusResult: { [addr.toLowerCase()]: { honeypot: "1", tax: "0" } } });
    const { out } = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: addr }), { PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url });
    mock.close();
    assert.strictEqual(out.success, true);
    assert.notStrictEqual(out.recommendation, "allow"); // schema drift must never fail open
    assert.ok(out.riskFactors.some((f) => /unrecognized|schema|UNVERIFIED/i.test(f)), "should disclose the unreadable GoPlus schema");
  });
});
