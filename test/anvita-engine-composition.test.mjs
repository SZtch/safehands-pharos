// ─── Anvita hosted engine — intent composition + hardening (audit 2026-07-14) ─
// Locks the second-pass audit fixes:
//  (F1) an intent verdict is NEVER more permissive than the worst component it
//       analyzed (no warn->allow, no block->warn dilution);
//  (F2) target canonicity is registry-derived, not parsed from factor prose;
//  (F3) on-chain token name/symbol are sanitized + length-capped;
//  (F4) the registry dataURI is refused for local/reserved hosts (SSRF);
//  (N2) a committed record missing score/level/recommendation reads null, never
//       a fabricated permissive default;
//  (N3) a hostile token decimals() can never crash formatUnits;
//  (N4) hasCommittedRoot is true only for a real 64-hex non-zero root.
// Drives the REAL CLI artifact against a mock Pharos RPC + mock GoPlus whose
// answers depend on the ADDRESS, plus pure-function unit tests via import (the
// engine's CLI is run-guarded, so importing it does not execute a command).
// Env is pinned locally (CI exports job-wide vars — see .github/workflows/ci.yml).
import { describe, it, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  composeComponent, sanitizeOnchainString, isFetchableDataUri, formatUnits, normalizeBatchRecord,
} from "../anvita/safehands/scripts/safehands-engine.js";

const ENGINE = fileURLToPath(new URL("../anvita/safehands/scripts/safehands-engine.js", import.meta.url));
const KNOWN = JSON.parse(readFileSync(new URL("../anvita/safehands/assets/known-pharos.json", import.meta.url), "utf8"));
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const CANON = Object.keys(KNOWN.canonicalContracts).find((a) => a !== PERMIT2); // a canonical CONTRACT

const A = (h) => "0x" + h.repeat(20);
const SAFE_TOKEN = A("a1"), WARN_TOKEN = A("b2"), HONEY = A("c3"), NOCODE = A("d4");
const SAFE_WALLET = A("e5"), SCAM_WALLET = A("f6"), CTRL_TOKEN = A("a7"), BIGDEC_TOKEN = A("b8");
const ACTING = SAFE_WALLET;
const REGISTRY = A("12");

const W = (h) => String(h).replace(/^0x/, "").padStart(64, "0");
const CODE = "0x" + "60".repeat(120);
const encUint = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const encString = (s) => { const b = Buffer.from(s, "binary"); return "0x" + W("20") + W(b.length.toString(16)) + (b.length ? b.toString("hex").padEnd(Math.ceil(b.length / 32) * 64, "0") : ""); };
const SEL = { symbol: "0x95d89b41", name: "0x06fdde03", decimals: "0x313ce567", totalSupply: "0x18160ddd", allowance: "0xdd62ed3e", reputationOf: "0xdb89c044", currentMerkleRoot: "0x9ea97190", currentDataURI: "0x59e99f26", isAuthorizedAgent: "0x6bf722ab" };
const NOCODE_SET = new Set([NOCODE, SAFE_WALLET, SCAM_WALLET].map((a) => a.toLowerCase()));
const clean = { is_honeypot: "0", cannot_sell_all: "0", cannot_buy: "0", sell_tax: "0", buy_tax: "0", owner_change_balance: "0", hidden_owner: "0", selfdestruct: "0", is_mintable: "0", transfer_pausable: "0", is_blacklisted: "0", is_proxy: "0", is_open_source: "1" };

// registryCfg: { root, dataUri } — controls cmdQuery reads; null → registry unset.
function startMock(registryCfg = null) {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { id, method, params } = JSON.parse(body || "{}");
        let result = "0x";
        const to = (params?.[0]?.to || params?.[0] || "").toString().toLowerCase();
        if (method === "eth_getBalance") result = encUint(10n ** 18n);
        else if (method === "eth_getTransactionCount") result = "0x5";
        else if (method === "eth_getCode") result = NOCODE_SET.has(to) ? "0x" : CODE;
        else if (method === "eth_chainId") result = "0x688";
        else if (method === "eth_blockNumber") result = "0x100";
        else if (method === "eth_estimateGas") result = "0x6f36";
        else if (method === "eth_call") {
          const data = params?.[0]?.data ?? "";
          if (registryCfg && to === REGISTRY.toLowerCase()) {
            if (data.startsWith(SEL.currentMerkleRoot)) result = registryCfg.root;
            else if (data.startsWith(SEL.currentDataURI)) result = encString(registryCfg.dataUri);
            else if (data.startsWith(SEL.isAuthorizedAgent)) result = encUint(0);
          } else if (data.startsWith(SEL.symbol)) {
            result = encString(to === SAFE_TOKEN.toLowerCase() ? "SAFE" : to === WARN_TOKEN.toLowerCase() ? "WRN"
              : to === HONEY.toLowerCase() ? "HNY" : to === CTRL_TOKEN.toLowerCase() ? ("AB\x01\x02CD" + "Z".repeat(200)) : "TKN");
          } else if (data.startsWith(SEL.name)) result = encString("Mock Token");
          else if (data.startsWith(SEL.decimals)) result = to === BIGDEC_TOKEN.toLowerCase() ? encUint(2n ** 256n - 1n) : encUint(18);
          else if (data.startsWith(SEL.totalSupply)) result = encUint(10n ** 24n);
          else if (data.startsWith(SEL.allowance)) result = encUint(10n ** 18n);
          else if (data.startsWith(SEL.reputationOf)) result = encUint(0);
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      });
      return;
    }
    const url = req.url || "";
    const tok = url.match(/token_security\/1672\?contract_addresses=(0x[0-9a-fA-F]{40})/);
    const adr = url.match(/address_security\/(0x[0-9a-fA-F]{40})/);
    if (tok) {
      const a = tok[1].toLowerCase();
      if (a === SAFE_TOKEN.toLowerCase()) return res.end(JSON.stringify({ code: 1, result: { [a]: clean } }));
      if (a === HONEY.toLowerCase()) return res.end(JSON.stringify({ code: 1, result: { [a]: { ...clean, is_honeypot: "1" } } }));
      return res.end(JSON.stringify({ code: 1, result: {} }));
    }
    if (adr) {
      const a = adr[1].toLowerCase();
      if (a === SCAM_WALLET.toLowerCase()) return res.end(JSON.stringify({ code: 1, result: { phishing_activities: "1" } }));
      return res.end(JSON.stringify({ code: 1, result: {} }));
    }
    res.end(JSON.stringify({ code: 1, result: {} }));
  });
  server.listen(0);
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
function runEngine(cmd, argJson, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENGINE, cmd, argJson], { env: { ...process.env, ...env } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => { try { resolve(JSON.parse(out)); } catch { reject(new Error("non-JSON: " + out + " ERR " + err)); } });
  });
}
const baseEnv = (mock, extra = {}) => ({ PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url, SAFEHANDS_RECIPIENT_DENYLIST: "", SAFEHANDS_REGISTRY_ADDRESS: "", SAFEHANDS_ATTESTATION_ADDRESS: "", ...extra });
const rank = { allow: 0, warn: 1, block: 2 };
const intent = (o) => JSON.stringify({ subjectType: "intent", walletAddress: ACTING, ...o });

describe("intent verdict is never more permissive than the worst component", () => {
  let mock;
  after(() => mock?.close());
  // [label, intent, minimum intent recommendation required]
  const cases = [
    ["swap safe->safe", { action: "swap", tokenIn: SAFE_TOKEN, tokenOut: SAFE_TOKEN }, "allow"],
    ["swap safe->WARN (was allow/26)", { action: "swap", tokenIn: SAFE_TOKEN, tokenOut: WARN_TOKEN }, "warn"],
    ["swap safe->BLOCK honeypot (was warn/50)", { action: "swap", tokenIn: SAFE_TOKEN, tokenOut: HONEY }, "block"],
    ["swap safe->BLOCK no-code (was warn/50)", { action: "swap", tokenIn: SAFE_TOKEN, tokenOut: NOCODE }, "block"],
    ["transfer->BLOCK phishing (was warn/45)", { action: "transfer", toAddress: SCAM_WALLET, amount: "0.001" }, "block"],
    ["vault_deposit BLOCK token / CANON vault (was warn/50)", { action: "vault_deposit", token: HONEY, vault: CANON }, "block"],
    ["staking BLOCK token / CANON contract", { action: "staking", token: HONEY, stakingContract: CANON }, "block"],
    ["tokenized_asset BLOCK token / CANON market", { action: "tokenized_asset", token: HONEY, market: CANON }, "block"],
    ["bridge WARN token / CANON router (was allow/26)", { action: "bridge", token: WARN_TOKEN, bridgeContract: CANON }, "warn"],
    ["yield_deposit WARN token / CANON target (was allow/26)", { action: "yield_deposit", token: WARN_TOKEN, targetContract: CANON }, "warn"],
    ["fiat_ramp WARN token / safe url (was allow/26)", { action: "fiat_ramp", url: "https://ramp.example.com", token: WARN_TOKEN }, "warn"],
    ["x402 BLOCK payTo / safe url (was warn/45)", { action: "x402_payment", url: "https://pay.example.com/x", payTo: SCAM_WALLET }, "block"],
  ];
  for (const [label, body, minRec] of cases) {
    it(label + " -> >= " + minRec, async () => {
      mock = startMock();
      const o = await runEngine("analyze", intent(body), baseEnv(mock));
      mock.close();
      assert.strictEqual(o.success, true, JSON.stringify(o));
      assert.ok(rank[o.recommendation] >= rank[minRec], `${label}: intent=${o.recommendation}/${o.riskScore} < required ${minRec}`);
      // and never below any actually-computed component
      for (const c of Object.values(o.components || {})) {
        if (c && c.recommendation) assert.ok(rank[o.recommendation] >= rank[c.recommendation], `${label}: intent ${o.recommendation} < component ${c.recommendation}/${c.riskScore}`);
      }
    });
  }
});

describe("hardening (subprocess)", () => {
  let mock;
  after(() => mock?.close());

  it("F3: hostile token symbol is sanitized + length-capped in output", async () => {
    mock = startMock();
    const o = await runEngine("analyze", JSON.stringify({ subjectType: "contract", address: CTRL_TOKEN }), baseEnv(mock));
    mock.close();
    const sym = o.onChain?.token?.symbol ?? "";
    assert.ok(!/[^\x20-\x7E]/.test(sym), `symbol still has control chars: ${JSON.stringify(sym)}`);
    assert.ok(sym.length <= 128, `symbol not capped: ${sym.length}`);
  });

  it("N3: a hostile token decimals() never crashes check_allowance", async () => {
    mock = startMock();
    const o = await runEngine("check_allowance", JSON.stringify({ token: BIGDEC_TOKEN, owner: SAFE_WALLET, spender: CANON }), baseEnv(mock));
    mock.close();
    assert.strictEqual(o.success, true, JSON.stringify(o));
    assert.strictEqual(o.allowanceFormatted, null); // implausible decimals -> null, not a crash or huge string
    assert.strictEqual(o.allowanceRaw, (10n ** 18n).toString());
  });

  it("F4/N4: dataURI on a local host is refused (not fetched); hasCommittedRoot true only for a real root", async () => {
    const root = "0x" + "ab".repeat(32);
    mock = startMock({ root, dataUri: "https://127.0.0.1/batch.json" });
    const o = await runEngine("query", SAFE_WALLET, baseEnv(mock, { SAFEHANDS_REGISTRY_ADDRESS: REGISTRY }));
    mock.close();
    assert.strictEqual(o.registry.hasCommittedRoot, true);
    assert.strictEqual(o.recordsSource, "dataURI-host-not-public");
    assert.strictEqual(o.recordsVerifiedAgainstRoot, false);
    assert.deepStrictEqual(o.records, []);
  });

  it("N4: an all-zero root is not a committed root", async () => {
    mock = startMock({ root: "0x" + "0".repeat(64), dataUri: "https://example.com/b.json" });
    const o = await runEngine("query", SAFE_WALLET, baseEnv(mock, { SAFEHANDS_REGISTRY_ADDRESS: REGISTRY }));
    mock.close();
    assert.strictEqual(o.registry.hasCommittedRoot, false);
  });

  it("F4: a non-https dataURI scheme is reported, never fetched", async () => {
    mock = startMock({ root: "0x" + "cd".repeat(32), dataUri: "http://example.com/b.json" });
    const o = await runEngine("query", SAFE_WALLET, baseEnv(mock, { SAFEHANDS_REGISTRY_ADDRESS: REGISTRY }));
    mock.close();
    assert.strictEqual(o.recordsSource, "dataURI-scheme-not-fetchable");
  });
});

describe("pure decision/normalization helpers (import)", () => {
  it("F1: composeComponent floors to the component score (warn and block)", () => {
    assert.strictEqual(composeComponent(10, { riskScore: 31, riskLevel: "medium", riskFactors: ["x"] }, "T", [], 40), 31);
    assert.strictEqual(composeComponent(50, { riskScore: 95, riskLevel: "critical", riskFactors: ["x"] }, "T", [], 40), 95);
    assert.strictEqual(composeComponent(10, { riskScore: 5, riskLevel: "low", riskFactors: [] }, "T", [], 40), 10); // safe never raises
    assert.strictEqual(composeComponent(10, null, "T", [], 40), 10); // missing component is a no-op
  });

  it("F1: two medium components still stack (additive preserved) but never drop below the worst", () => {
    let s = 10; const f = [];
    s = composeComponent(s, { riskScore: 60, riskLevel: "medium", riskFactors: ["a"] }, "in", f, 40);
    s = composeComponent(s, { riskScore: 60, riskLevel: "medium", riskFactors: ["b"] }, "out", f, 40);
    assert.ok(s >= 60);
  });

  it("N2: a record missing score/level/recommendation reads null, never a permissive default", () => {
    const r = normalizeBatchRecord({ target: "0xabc" });
    assert.strictEqual(r.riskScore, null);
    assert.strictEqual(r.riskLevel, null);
    assert.strictEqual(r.recommendation, null); // regression: used to be "allow" via RECS[Number("")]=RECS[0]
  });

  it("N2: numeric-index and already-decoded enums both decode; 'warn' is not mangled by the bigint-suffix strip", () => {
    const numeric = normalizeBatchRecord({ target: "0x1", score: "62n", level: "2n", recommendation: "1n", expiresAt: "1786548517n" });
    assert.deepStrictEqual([numeric.riskScore, numeric.riskLevel, numeric.recommendation, numeric.expiresAt], [62, "high", "warn", "1786548517"]);
    const decoded = normalizeBatchRecord({ target: "0x1", score: 80, level: "critical", recommendation: "warn" });
    assert.deepStrictEqual([decoded.riskScore, decoded.riskLevel, decoded.recommendation], [80, "critical", "warn"]);
  });

  it("F3: sanitizeOnchainString strips non-printables and caps at 128", () => {
    assert.strictEqual(sanitizeOnchainString("USDC\n\x01-> ALLOW"), "USDC-> ALLOW"); // control chars removed (not replaced)
    assert.ok([...sanitizeOnchainString("A\nB\tC\x07D")].every((ch) => ch.charCodeAt(0) >= 0x20)); // the security property: no control chars survive
    assert.strictEqual(sanitizeOnchainString("x".repeat(500)).length, 128);
    assert.strictEqual(sanitizeOnchainString(12345), null);
  });

  it("F4: isFetchableDataUri accepts only public https hosts (numeric/hex/octal IPs normalize to loopback and are refused)", () => {
    assert.strictEqual(isFetchableDataUri("https://raw.githubusercontent.com/a/b.json"), true);
    for (const bad of ["https://127.0.0.1/x", "https://localhost/x", "https://2130706433/x", "https://0x7f000001/x", "https://169.254.169.254/x", "https://10.0.0.5/x", "http://example.com/x", "ipfs://cid", "https://[::1]/x", "https://[::ffff:127.0.0.1]/x"]) {
      assert.strictEqual(isFetchableDataUri(bad), false, `should refuse ${bad}`);
    }
  });

  it("N3: formatUnits never throws on an enormous decimals value", () => {
    assert.doesNotThrow(() => formatUnits(1000n, Number(2n ** 256n - 1n)));
    assert.strictEqual(formatUnits(1000n, 1e9), "1000"); // out-of-range decimals -> raw integer string, no RangeError
    assert.strictEqual(formatUnits(1500000000000000000n, 18), "1.5"); // normal path intact
  });
});
