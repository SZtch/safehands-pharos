#!/usr/bin/env node
/**
 * safehands-engine.js — SafeHands fully-hosted risk engine (zero dependencies)
 *
 * Reads Pharos Pacific Mainnet (chainId 1672) DIRECTLY via public JSON-RPC.
 * No backend. No private keys. Read-only eth_call / eth_get* only.
 *
 * Commands:
 *   node safehands-engine.js health
 *   node safehands-engine.js analyze '<json>'      // {subjectType:"wallet"|"contract"|"intent",...}
 *   node safehands-engine.js query   '<0xaddress>' // on-chain SafeHands registry + reputation
 *   node safehands-engine.js get_gas_price
 *   node safehands-engine.js get_token_price '<symbol-or-json>'   // Chainlink Push feeds via eth_call
 *   node safehands-engine.js check_allowance '<json>'             // {token,owner,spender}
 *   node safehands-engine.js get_transaction_status '<txhash>'
 *   node safehands-engine.js estimate_gas '<json>'                // {from?,to,data?,value?|valueWei?}
 *   node safehands-engine.js simulate_transaction '<json>'        // same shape; eth_call only
 *   node safehands-engine.js get_spv_proof '<json>'               // {address,storageKeys?,blockTag?}
 *   node safehands-engine.js query_goldsky_subgraph '<json>'      // gated: assets/supported-protocols.json
 *   node safehands-engine.js get_execution_history '<json>'       // gated: assets/supported-protocols.json
 *   node safehands-engine.js get_pool_info '<json>'               // gated: assets/supported-protocols.json
 *
 * Everything is READ-ONLY: eth_call / eth_get* / eth_gasPrice / eth_estimateGas only.
 * This engine never signs, broadcasts, approves, swaps, bridges, deposits, stakes,
 * pays, creates wallets, or publishes records.
 *
 * Output: single JSON object on stdout. Exit 0 on success, 1 on failure.
 * Requires Node >= 18 (built-in fetch).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

// ── config from assets (relative to this script) ─────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
function loadJSON(rel) {
  // Anvita package layout is assets/<file>; the legacy assets/safehands/<file> layout
  // is kept as a fallback so an older bundle keeps working.
  for (const base of [path.join(HERE, "..", "assets", rel), path.join(HERE, "..", "assets", "safehands", rel)]) {
    try { return JSON.parse(readFileSync(base, "utf8")); } catch { /* try next */ }
  }
  return null;
}
const NETWORKS = loadJSON("networks.json") || {};
const CONTRACTS = loadJSON("contracts.json") || {};
const NETMAP = NETWORKS.networks || {};
const NET = Array.isArray(NETMAP)
  ? (NETMAP.find((n) => n && n.chainId === 1672) || {})
  : (Object.values(NETMAP).find((n) => n && n.chainId === 1672) || {});
const RPC_URL = process.env.PHAROS_RPC_URL || NET.rpcUrl || "https://rpc.pharos.xyz";
const CHAIN_ID = 1672; // mainnet lock — never analyze/report for other chains
const EXPLORER = NET.explorerUrl || "https://www.pharosscan.xyz";
const GOPLUS_BASE = process.env.GOPLUS_API_BASE || "https://api.gopluslabs.io"; // public v1 endpoints, no key required
// Engine version — MUST equal the repo package.json version. Enforced by
// scripts/sync-anvita-assets.ts --check (UA drift guard); update both together.
const ENGINE_VERSION = "2.3.0";
const ENGINE_UA = `SafeHands/${ENGINE_VERSION}`;

const CMAP = CONTRACTS.contracts || CONTRACTS; // supports both {contracts:{...}} and flat shapes
const REGISTRY_ADDR = process.env.SAFEHANDS_REGISTRY_ADDRESS
  || (CMAP.SafeHandsRegistry && CMAP.SafeHandsRegistry.address) || "";
const ATTEST_ADDR = process.env.SAFEHANDS_ATTESTATION_ADDRESS
  || (CMAP.SafeHandsAttestation && CMAP.SafeHandsAttestation.address) || "";

// ── precomputed keccak-256 selectors (verified against standard vectors) ─
const SEL = {
  name: "0x06fdde03", symbol: "0x95d89b41", decimals: "0x313ce567", totalSupply: "0x18160ddd",
  allowance: "0xdd62ed3e",          // allowance(address,address)
  latestAnswer: "0x50d25bcd",       // Chainlink Push latestAnswer() int256
  latestTimestamp: "0x8205bf6a",    // Chainlink Push latestTimestamp() uint256
  currentMerkleRoot: "0x9ea97190", currentDataURI: "0x59e99f26",
  isAuthorizedAgent: "0x6bf722ab", isAuthorizedOperator: "0x82d52c1e",
  reputationOf: "0xdb89c044",
};

// ── market-data + provider config (read-only sources only) ───────────────
const ASSETS_CFG = loadJSON("supported-assets.json") || {};
const FEEDS = ASSETS_CFG.feeds || {};
const FEED_ALIASES = ASSETS_CFG.aliases || {};
const FEED_ALIAS_NOTES = ASSETS_CFG.aliasNotes || {};
const FEED_HEARTBEAT_DEFAULT = Number(ASSETS_CFG.heartbeatSeconds) || 3600;
const FEED_DECIMALS_DEFAULT = Number(ASSETS_CFG.feedDecimalsDefault) || 18;
const PROTOCOLS_CFG = loadJSON("supported-protocols.json") || {};
const PROVIDERS = PROTOCOLS_CFG.providers || {};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const LEVELS = ["low", "medium", "high", "critical"];
const RECS = ["allow", "warn", "block"];
// Fail-closed floor: when the GoPlus threat-intel signal the recommendation
// depends on is UNREACHABLE, an unverified subject must not score "allow".
// 31 forces at least "warn" (scoreToRec: >30 → warn), i.e. ask-to-confirm.
const THREAT_INTEL_UNAVAILABLE_FLOOR = 31;
const KNOWN = loadJSON("known-pharos.json") || {};
const CANON_CONTRACTS = KNOWN.canonicalContracts || {};
const CANON_TOKENS = KNOWN.canonicalTokens || {}; // SYMBOL -> lowercase address (official Pharos Token Registry)
const KNOWN_INFRA = new Set(Object.keys(CANON_CONTRACTS));

// ── helpers ───────────────────────────────────────────────────────────────
function fail(code, message, extra = {}) {
  return { success: false, error: { code, message }, chainId: CHAIN_ID, timestamp: new Date().toISOString(), ...extra };
}
// Key-material guard. Some read-only inputs are legitimately 64-hex (a tx hash,
// calldata words, storage keys) — those exact fields may be exempted from the
// 64-hex heuristic via ignore64HexKeys, but the secret-keyword check ALWAYS runs
// on the full input. Nothing here ever stores or forwards the value beyond the
// single read-only RPC lookup it was provided for.
function rejectKeyLike(obj, ignore64HexKeys = []) {
  const full = JSON.stringify(obj || {});
  if (/private[_-]?key|mnemonic|seed[_-]?phrase|secret[_-]?key/i.test(full)) return "input contains key-like material — this engine never handles secrets";
  let scrubbed = obj;
  if (ignore64HexKeys.length && obj && typeof obj === "object") {
    scrubbed = { ...obj };
    for (const k of ignore64HexKeys) delete scrubbed[k];
  }
  if (/0x[0-9a-fA-F]{64}/.test(JSON.stringify(scrubbed || {}))) {
    return "input contains a 64-hex value; if that is a private key, never share it (pass transaction hashes only in their dedicated field)";
  }
  return null;
}
async function rpcRaw(method, params = [], timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(`RPC ${j.error.code}: ${j.error.message}`);
    return j.result;
  } finally { clearTimeout(t); }
}
// Chain-identity guard: the first RPC use in a run verifies eth_chainId === 1672
// before any other read is trusted, so the `chainId: 1672` every command stamps
// is a CHECKED claim, not an assumption (previously only `health` validated).
// Memoized in-flight so parallel first reads share one eth_chainId call; reset
// on failure so a transient error can retry.
let chainIdentityCheck = null;
function ensureChainIdentity() {
  if (!chainIdentityCheck) {
    chainIdentityCheck = rpcRaw("eth_chainId").then((cid) => {
      const n = Number(decUint(cid));
      if (n !== CHAIN_ID) {
        const err = new Error(`RPC reports chainId ${n}, expected ${CHAIN_ID} (Pharos pacific-mainnet). Refusing to report reads from an unexpected chain.`);
        err.safehandsCode = "CHAIN_MISMATCH";
        throw err;
      }
    });
    chainIdentityCheck.catch(() => { chainIdentityCheck = null; });
  }
  return chainIdentityCheck;
}
async function rpc(method, params = [], timeoutMs = 15000) {
  if (method !== "eth_chainId") await ensureChainIdentity();
  return rpcRaw(method, params, timeoutMs);
}
const pad32 = (hexNo0x) => hexNo0x.toLowerCase().padStart(64, "0");
const encAddr = (a) => pad32(a.slice(2));
async function ethCall(to, data) { return rpc("eth_call", [{ to, data }, "latest"]); }
function decUint(hex) { return hex && hex !== "0x" ? BigInt(hex) : 0n; }
function decString(hex) {
  try {
    if (!hex || hex === "0x" || hex.length < 130) return null;
    const body = hex.slice(2);
    const len = Number(BigInt("0x" + body.slice(64, 128)));
    const raw = body.slice(128, 128 + len * 2);
    return Buffer.from(raw, "hex").toString("utf8");
  } catch { return null; }
}
function prosToWei(amountStr) {
  const str = String(amountStr).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) return null; // must be a well-formed positive decimal: "1", "1.5", "0.5"
  const [i, f = ""] = str.split(".");
  return BigInt(i + f.padEnd(18, "0").slice(0, 18));
}
function formatUnits(raw, decimals) {
  const neg = raw < 0n; const v = neg ? -raw : raw;
  const s = v.toString().padStart(decimals + 1, "0");
  const i = s.slice(0, s.length - decimals) || "0";
  const f = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return (neg ? "-" : "") + i + (f ? "." + f : "");
}
function decInt256(word64) { // 64 hex chars → signed BigInt (two's complement)
  let v = BigInt("0x" + word64);
  if (v >= 2n ** 255n) v -= 2n ** 256n;
  return v;
}
// Revert/provider messages are surfaced to the user — strip non-printables and cap.
function sanitizeReason(msg) { return String(msg || "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300); }
const TXHASH_RE = /^0x[0-9a-fA-F]{64}$/;
const HEXDATA_RE = /^0x([0-9a-fA-F]{2})*$/;
// Build a validated read-only tx object for eth_call / eth_estimateGas. Never broadcast.
function buildTxObject(input) {
  const errs = []; const tx = {};
  if (!ADDRESS_RE.test(String(input.to || ""))) errs.push("'to' must be a valid 0x EVM address");
  else tx.to = input.to;
  if (input.from != null) {
    if (ADDRESS_RE.test(String(input.from))) tx.from = input.from;
    else errs.push("'from' must be a valid 0x EVM address");
  }
  if (input.data != null) {
    if (HEXDATA_RE.test(String(input.data))) tx.data = input.data;
    else errs.push("'data' must be 0x-prefixed even-length hex calldata");
  }
  if (input.valueWei != null) {
    if (/^\d+$/.test(String(input.valueWei))) tx.value = "0x" + BigInt(input.valueWei).toString(16);
    else errs.push("'valueWei' must be a base-10 integer string");
  } else if (input.value != null) {
    const wei = prosToWei(input.value);
    if (wei != null) tx.value = "0x" + wei.toString(16);
    else errs.push("'value' must be a positive decimal PROS string, e.g. \"1.5\"");
  }
  return { tx, errs };
}
function scoreToRec(score) { return score <= 30 ? "allow" : score < 70 ? "warn" : "block"; }
function scoreToLevel(score) { return score <= 30 ? "low" : score <= 60 ? "medium" : score <= 85 ? "high" : "critical"; }
function report(score, factors, subject, extra = {}) {
  score = Math.max(0, Math.min(100, Math.round(score)));
  const recommendation = scoreToRec(score);
  const explorer = subject && subject.address ? `${EXPLORER}/address/${subject.address}` : undefined;
  return {
    success: true, riskScore: score, recommendation, riskLevel: scoreToLevel(score), explorer,
    riskFactors: factors,
    explanation: factors.length ? factors.join("; ") : "No adverse on-chain signals detected by hosted heuristics.",
    nextAction: recommendation === "allow" ? "Proceed with normal caution."
      : recommendation === "warn" ? "Ask the user to confirm explicitly before proceeding."
      : "Do not proceed. Advise the user against this action.",
    analysisDepth: "hosted-heuristic (on-chain reads only — not the full SafeHands analyzer suite)",
    subject, network: "pacific-mainnet", chainId: CHAIN_ID, timestamp: new Date().toISOString(), ...extra,
  };
}

// ── subject probes ────────────────────────────────────────────────────────
async function probeAddress(addr) {
  const [balHex, nonceHex, code] = await Promise.all([
    rpc("eth_getBalance", [addr, "latest"]),
    rpc("eth_getTransactionCount", [addr, "latest"]),
    rpc("eth_getCode", [addr, "latest"]),
  ]);
  return { balance: decUint(balHex), nonce: Number(decUint(nonceHex)), isContract: code && code !== "0x", codeSize: code ? (code.length - 2) / 2 : 0 };
}
async function erc20Probe(addr) {
  const out = {};
  const tryCall = async (key, sel, dec) => { try { const r = await ethCall(addr, sel); out[key] = dec(r); } catch { out[key] = null; } };
  await Promise.all([
    tryCall("name", SEL.name, decString), tryCall("symbol", SEL.symbol, decString),
    tryCall("decimals", SEL.decimals, (h) => Number(decUint(h))), tryCall("totalSupply", SEL.totalSupply, (h) => decUint(h).toString()),
  ]);
  return out;
}

// ── GoPlus threat intelligence (public API, keyless, graceful fallback) ──
// Transient failures (rate-limit/5xx/timeout) retry with linear backoff, mirroring the
// self-hosted analyzer's fetchGoplus: a momentary GoPlus hiccup must not push a clean
// subject onto the missing-threat-intel floor. Exhausted retries still return null —
// the caller's fail-closed floor remains the last line of defense.
const GOPLUS_RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function goplusGet(pathname, timeoutMs = 10000) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) await sleep(300 * attempt);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(GOPLUS_BASE + pathname, {
        signal: ctl.signal, headers: { accept: "application/json", "user-agent": ENGINE_UA },
      });
      if (GOPLUS_RETRYABLE.has(res.status) && attempt < 2) continue;
      if (!res.ok) return null;
      const j = await res.json();
      return j && (j.code === 1 || j.code === "1") ? j.result : null;
    } catch { if (attempt === 2) return null; } finally { clearTimeout(t); }
  }
  return null;
}
const flag = (v) => v === "1" || v === 1 || v === true;
// A GoPlus flag is "known" only if it decodes to a recognizable boolean. Absent/renamed
// fields are NOT known → used to fail closed on schema drift instead of reading them false.
const flagKnown = (v) => v === "1" || v === "0" || v === 1 || v === 0 || v === true || v === false;
async function goplusToken(addr) {
  const r = await goplusGet(`/api/v1/token_security/${CHAIN_ID}?contract_addresses=${addr}`);
  const d = r && (r[addr.toLowerCase()] || r[addr]); if (!d) return { reachable: !!r, data: null };
  // P0-1 fail-closed: result object present but the honeypot decision field is unreadable
  // (renamed/retyped schema) → do NOT read every flag as false; signal drift so the caller
  // applies the missing-threat-intel floor instead of silently under-reporting the token.
  if (!flagKnown(d.is_honeypot)) return { reachable: true, data: null, schemaDrift: true, factors: [], add: 0 };
  // Display-only identity from the SAME security payload (no extra fetch). Untrusted
  // external strings: trim + cap at 128 chars. Never used in scoring or the verdict.
  const optStr = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 128) : undefined);
  const identity = (optStr(d.token_name) || optStr(d.token_symbol))
    ? { tokenName: optStr(d.token_name), tokenSymbol: optStr(d.token_symbol) } : null;
  const factors = []; let add = 0;
  if (flag(d.is_honeypot)) { factors.push("GoPlus: HONEYPOT — token cannot be sold"); add += 80; }
  if (flag(d.cannot_sell_all)) { factors.push("GoPlus: holders cannot sell all tokens"); add += 30; }
  if (flag(d.cannot_buy)) { factors.push("GoPlus: token cannot be bought"); add += 25; }
  const st = parseFloat(d.sell_tax), bt = parseFloat(d.buy_tax);
  if (st > 0.5) { factors.push(`GoPlus: extreme sell tax ${(st*100).toFixed(0)}%`); add += 50; }
  else if (st > 0.1) { factors.push(`GoPlus: high sell tax ${(st*100).toFixed(0)}%`); add += 25; }
  if (bt > 0.1) { factors.push(`GoPlus: high buy tax ${(bt*100).toFixed(0)}%`); add += 15; }
  if (flag(d.owner_change_balance)) { factors.push("GoPlus: owner can modify holder balances"); add += 50; }
  if (flag(d.hidden_owner)) { factors.push("GoPlus: hidden owner detected"); add += 30; }
  if (flag(d.selfdestruct)) { factors.push("GoPlus: contract can self-destruct"); add += 40; }
  if (flag(d.is_mintable)) { factors.push("GoPlus: owner can mint new supply"); add += 15; }
  if (flag(d.transfer_pausable)) { factors.push("GoPlus: transfers can be paused"); add += 15; }
  if (flag(d.is_blacklisted)) { factors.push("GoPlus: owner can blacklist holders"); add += 15; }
  if (flag(d.is_proxy)) { factors.push("GoPlus: upgradeable proxy — logic can change"); add += 10; }
  if (d.is_open_source !== undefined && !flag(d.is_open_source)) { factors.push("GoPlus: source code not verified"); add += 20; }
  return { reachable: true, data: d, factors, add: Math.min(add, 90), identity };
}
async function goplusAddress(addr) {
  const r = await goplusGet(`/api/v1/address_security/${addr}?chain_id=${CHAIN_ID}`);
  const d = r; if (!d) return { reachable: false, factors: [], add: 0 };
  const factors = []; let add = 0;
  const bad = { honeypot_related_address: ["linked to honeypot scams", 40], phishing_activities: ["phishing activity", 60],
    blacklist_doubt: ["blacklist-flagged", 40], stealing_attack: ["stealing attacks", 60], blackmail_activities: ["blackmail activity", 50],
    cybercrime: ["cybercrime", 60], money_laundering: ["money laundering", 50], darkweb_transactions: ["darkweb transactions", 50],
    fake_kyc: ["fake KYC", 30], financial_crime: ["financial crime", 50], malicious_mining_activities: ["malicious mining", 30] };
  for (const [k, [label, w]] of Object.entries(bad)) if (flag(d[k])) { factors.push(`GoPlus: address involved in ${label}`); add += w; }
  return { reachable: true, factors, add: Math.min(add, 90) };
}

// ── commands ──────────────────────────────────────────────────────────────
async function cmdHealth() {
  const [cid, blk] = await Promise.all([rpc("eth_chainId"), rpc("eth_blockNumber")]);
  const chainId = Number(decUint(cid));
  if (chainId !== CHAIN_ID) return fail("CHAIN_MISMATCH", `RPC reports chainId ${chainId}, expected ${CHAIN_ID} (Pharos pacific-mainnet).`);
  return {
    success: true, ok: true, service: "safehands", mode: "fully-hosted", status: "healthy",
    rpc: RPC_URL, chainId, blockNumber: Number(decUint(blk)),
    registryConfigured: ADDRESS_RE.test(REGISTRY_ADDR), attestationConfigured: ADDRESS_RE.test(ATTEST_ADDR),
    timestamp: new Date().toISOString(),
  };
}

async function analyzeWallet(addr, { expect = "wallet" } = {}) {
  const p = await probeAddress(addr);
  const factors = []; let score = 10;
  if (expect === "wallet" && p.isContract) { factors.push(`Address is a smart contract (${p.codeSize} bytes), not an externally-owned wallet`); score += 35; }
  if (!p.isContract && p.nonce === 0) { factors.push("Fresh wallet: zero transaction history on Pharos"); score += 25; }
  if (p.balance === 0n) { factors.push("Zero PROS balance"); score += 15; }
  const gp = await goplusAddress(addr);
  if (gp.factors.length) { factors.push(...gp.factors); score += gp.add; }
  if (!gp.reachable) {
    factors.push("GoPlus address intelligence unreachable — scam/phishing status UNVERIFIED; treat as unsafe-until-confirmed");
    score = Math.max(score, THREAT_INTEL_UNAVAILABLE_FLOOR);
  }
  return report(score, factors, { type: "wallet", address: addr }, {
    intel: gp.reachable ? "on-chain + GoPlus" : "on-chain only (GoPlus unreachable)",
    onChain: { balanceWei: p.balance.toString(), txCount: p.nonce, isContract: p.isContract },
  });
}

async function analyzeContract(addr) {
  const p = await probeAddress(addr);
  if (!p.isContract) {
    return report(95, [`No contract code at ${addr} — either not deployed on Pharos mainnet or self-destructed`],
      { type: "contract", address: addr }, { onChain: { isContract: false } });
  }
  const factors = []; let score = 15;
  const known = KNOWN_INFRA.has(addr.toLowerCase());
  if (known) {
    return report(5, [`Canonical Pharos infrastructure: ${CANON_CONTRACTS[addr.toLowerCase()]} (official docs registry)`],
      { type: "contract", address: addr },
      { onChain: { isContract: true, codeSize: p.codeSize }, intel: "official Pharos canonical-contracts registry" });
  }
  const t = await erc20Probe(addr);
  const looksToken = t.symbol !== null; // strict: symbol must ABI-decode; fallback junk like 0x0 must not classify as token
  let canonicalVerified = false; // official-registry identity match exempts the missing-threat-intel floor
  if (looksToken && t.symbol) {
    const sym = t.symbol.trim().toUpperCase();
    const official = CANON_TOKENS[sym];
    if (official) {
      if (addr.toLowerCase() === official) { score = Math.min(score, 8); factors.push(`Canonical ${sym} from the official Pharos Token Registry`); canonicalVerified = true; }
      else { factors.push(`IMPERSONATION: claims symbol "${sym}" but is NOT the official Pharos ${sym} (official: ${official} — verify: ${EXPLORER}/address/${official})`); score += 75; }
    }
  }
  if (looksToken) {
    if (t.name === null || t.symbol === null) { factors.push("Token metadata incomplete (non-standard ERC-20 surface)"); score += 20; }
    if (t.decimals === null) { factors.push("decimals() unreadable — integrations may misprice amounts"); score += 10; }
    if (t.totalSupply === "0") { factors.push("Token totalSupply is zero"); score += 15; }
  } else {
    factors.push("Not a standard token interface — unverified custom contract; hosted engine cannot audit its logic");
    score += 25;
  }
  if (p.codeSize < 100) { factors.push(`Suspiciously small bytecode (${p.codeSize} bytes) — possible proxy shell or stub`); score += 15; }
  const gp = await goplusToken(addr);
  const gpUnindexedToken = gp.reachable && !gp.data && !gp.schemaDrift && looksToken; // GoPlus answered but has never vetted THIS token
  if (gp.data && gp.factors.length) { factors.push(...gp.factors); score += gp.add; }
  else if (gpUnindexedToken) { factors.push("Token not yet indexed by GoPlus — very new or obscure; extra caution advised"); score += 10; }
  // A drifted schema (result present but unreadable) or a reachable-but-unindexed token is
  // NOT a real verdict — treat both like an outage: floor the score and disclose, so a token
  // GoPlus has never actually vetted (the classic fresh-rug window) can never read "allow".
  const gpVerified = gp.reachable && !gp.schemaDrift && !gpUnindexedToken;
  if (!gpVerified && !canonicalVerified) {
    factors.push(gp.schemaDrift
      ? "GoPlus returned an unrecognized token-security schema — honeypot/scam status UNVERIFIED; treat as unsafe-until-confirmed"
      : gpUnindexedToken
        ? "Not yet indexed by GoPlus — honeypot status UNVERIFIED; treat as unsafe-until-confirmed"
        : "GoPlus threat intelligence unreachable — honeypot/scam status UNVERIFIED; treat as unsafe-until-confirmed");
    score = Math.max(score, THREAT_INTEL_UNAVAILABLE_FLOOR);
  }
  return report(score, factors, { type: "contract", address: addr }, {
    onChain: { isContract: true, codeSize: p.codeSize, token: looksToken ? t : null },
    ...(gp.identity ? { goplusTokenIdentity: gp.identity } : {}), // display-only, never scored
    intel: gpVerified ? "on-chain + GoPlus threat intelligence" : "on-chain only (GoPlus unverified)",
    limits: gpVerified ? "GoPlus flags included; bespoke sell-simulation and source-level audit are not performed."
      : "GoPlus verdict unavailable for this call — heuristics only; honeypot status unknown.",
  });
}

// ── RealFi intent templates ───────────────────────────────────────────────
// These are ROUTING templates, not data sources: each evidence block runs a real
// read-only check only when its inputs are present; anything absent is reported
// in missingInputs. Provider data that is not configured is reported as
// unavailable — never invented (no fake TVL/APY/cap/paused values).
const FUND_MOVING_ACTIONS = ["transfer", "swap", "bridge", "yield_deposit", "vault_deposit", "staking", "tokenized_asset"];
const URL_ACTIONS = ["fiat_ramp", "reward_campaign", "x402_payment"];
const DEPOSIT_CLASS = new Set(["bridge", "yield_deposit", "vault_deposit", "staking"]);
const INTENT_TARGET_LABEL = {
  bridge: "bridge/router", yield_deposit: "yield contract", vault_deposit: "vault",
  staking: "staking contract", tokenized_asset: "tokenized-asset market",
};
const INTENT_TARGET_KEY = {
  bridge: "bridgeContract", yield_deposit: "targetContract", vault_deposit: "vault",
  staking: "stakingContract", tokenized_asset: "market",
};

// Static URL risk analysis. The hosted engine NEVER fetches arbitrary
// user-provided URLs — this inspects the string only.
function urlRisk(rawUrl) {
  const factors = []; let add = 0; let parsed;
  try { parsed = new URL(String(rawUrl)); } catch { return { valid: false, fetched: false, factors: ["URL is malformed"], add: 40 }; }
  if (parsed.protocol !== "https:") { factors.push("URL is not HTTPS — payment/campaign links must be https"); add += 45; }
  if (parsed.username || parsed.password) { factors.push("URL embeds credentials — classic phishing pattern"); add += 50; }
  const host = parsed.hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) { factors.push("Host is a raw IP literal, not a domain"); add += 35; }
  if (/^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) { factors.push("Host is local/private — not a public service"); add += 45; }
  if (host.split(".").some((l) => l.startsWith("xn--"))) { factors.push("Punycode hostname — possible homograph impersonation of a known brand"); add += 35; }
  if (parsed.port && parsed.port !== "443") { factors.push(`Non-standard port ${parsed.port}`); add += 15; }
  if (String(rawUrl).length > 2048) { factors.push("Unusually long URL"); add += 10; }
  return { valid: true, host, fetched: false, factors, add: Math.min(add, 90) };
}

async function reputationOfTarget(addr) {
  if (!ADDRESS_RE.test(ATTEST_ADDR)) return null;
  try {
    const hex = await ethCall(ATTEST_ADDR, SEL.reputationOf + encAddr(addr));
    const body = hex.slice(2);
    return {
      verifiedActionCount: Number(BigInt("0x" + (body.slice(0, 64) || "0"))),
      lastVerifiedActionAt: Number(BigInt("0x" + (body.slice(64, 128) || "0"))),
    };
  } catch { return null; }
}

async function analyzeRealFiIntent(input, action) {
  const factors = []; const parts = {}; const evidenceUsed = []; const missingInputs = [];
  let score = 10;
  const isDeposit = DEPOSIT_CLASS.has(action);
  const isUrlIntent = URL_ACTIONS.includes(action);
  const targetLabel = INTENT_TARGET_LABEL[action] || "target";

  let wallet = null;
  if (ADDRESS_RE.test(String(input.walletAddress || ""))) {
    wallet = await probeAddress(input.walletAddress);
    evidenceUsed.push("acting-wallet on-chain probe (balance, nonce, code)");
    if (wallet.nonce === 0) { factors.push("Acting wallet has zero transaction history"); score += 10; }
  }

  // token legitimacy
  const token = String(input.token || input.tokenAddress || input.tokenIn || "");
  if (ADDRESS_RE.test(token)) {
    parts.token = await analyzeContract(token);
    evidenceUsed.push("token analysis (on-chain surface + registry + GoPlus threat intel)");
    if (parts.token.riskScore > 30) { factors.push(`Token risk (${parts.token.riskLevel}): ${parts.token.riskFactors[0] || ""}`); score += Math.min(40, parts.token.riskScore / 2); }
  } else if (!isUrlIntent) {
    missingInputs.push("token (0x address) — token legitimacy was not verified");
  }

  // target contract (router / vault / staking / market) — fail closed when unknown
  const target = String(input.targetContract || input.bridgeContract || input.router || input.vault
    || input.stakingContract || input.market || input.contract || "");
  if (ADDRESS_RE.test(target)) {
    parts.target = await analyzeContract(target);
    evidenceUsed.push(`${targetLabel} contract analysis (code, canonical registry, GoPlus)`);
    const canonicalTarget = (parts.target.riskFactors || []).some((f) => /^Canonical /.test(f));
    if (parts.target.onChain && parts.target.onChain.isContract === false) {
      factors.push(`Target ${targetLabel} has NO contract code on Pharos mainnet — nothing legitimate to interact with`);
      score = Math.max(score, 95);
    } else if (!canonicalTarget) {
      factors.push(`Target ${targetLabel} is not in the official Pharos canonical registry and its source is unverified — fail-closed: verify it independently before any ${action.replace(/_/g, " ")}`);
      score = Math.max(score, isDeposit ? 45 : THREAT_INTEL_UNAVAILABLE_FLOOR);
      if (parts.target.riskScore > 30) score += Math.min(30, parts.target.riskScore / 3);
    }
    const rep = await reputationOfTarget(target);
    if (rep) {
      parts.reputation = { ...rep, interpretation: rep.verifiedActionCount > 0 ? `${rep.verifiedActionCount} SafeHands-verified action(s) on record.` : "No verified actions on record — neutral, not an adverse signal." };
      evidenceUsed.push("SafeHands attestation reputation (reputationOf)");
    }
  } else if (!isUrlIntent) {
    missingInputs.push(`${INTENT_TARGET_KEY[action] || "targetContract"} (0x address of the ${targetLabel} contract)`);
    factors.push(`No ${targetLabel} contract address provided — the contract this intent would call is unverified`);
    score = Math.max(score, isDeposit ? 45 : 35);
  }

  // current allowance exposure (owner defaults to acting wallet, spender to target)
  const owner = ADDRESS_RE.test(String(input.owner || "")) ? input.owner
    : ADDRESS_RE.test(String(input.walletAddress || "")) ? input.walletAddress : null;
  const spender = ADDRESS_RE.test(String(input.spender || "")) ? input.spender
    : ADDRESS_RE.test(target) ? target : null;
  if (!isUrlIntent) {
    if (ADDRESS_RE.test(token) && owner && spender) {
      try {
        const alHex = await ethCall(token, SEL.allowance + encAddr(owner) + encAddr(spender));
        const allowance = decUint(alHex);
        const state = allowance === 0n ? "none" : allowance >= 2n ** 255n ? "unlimited" : "scoped";
        parts.allowance = { owner, spender, allowanceRaw: allowance.toString(), approvalRisk: state };
        evidenceUsed.push("current ERC-20 allowance read (allowance(owner,spender))");
        if (state === "unlimited") { factors.push("Owner already granted an UNLIMITED approval to this spender — existing exposure is the entire token balance"); score += 20; }
      } catch { parts.allowance = { owner, spender, error: "allowance read failed — token may not expose ERC-20 allowance()" }; }
    } else {
      missingInputs.push("owner + spender + token for the allowance-exposure check");
    }
  }

  // simulation + gas estimate (only when real calldata is provided; both read-only)
  if (input.to != null || input.data != null) {
    const { tx, errs } = buildTxObject(input);
    if (errs.length) {
      factors.push(`Provided tx object is invalid: ${errs.join("; ")}`); score += 10;
    } else {
      try {
        const ret = await rpc("eth_call", [tx, "latest"]);
        parts.simulation = { reverted: false, returnData: ret };
        evidenceUsed.push("eth_call simulation against current chain state");
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (!/^RPC /.test(msg)) throw e;
        parts.simulation = { reverted: true, reason: sanitizeReason(msg) };
        factors.push("Simulation REVERTS against current chain state — the transaction would fail or is blocked");
        score += 35;
        evidenceUsed.push("eth_call simulation against current chain state");
      }
      try {
        const gasHex = await rpc("eth_estimateGas", [tx]);
        parts.gasEstimate = { estimatedGas: Number(decUint(gasHex)) };
        evidenceUsed.push("eth_estimateGas dry run");
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (!/^RPC /.test(msg)) throw e;
        parts.gasEstimate = { failed: true, reason: sanitizeReason(msg) };
      }
    }
  } else if (!isUrlIntent) {
    missingInputs.push("tx object (from,to,data,value) for eth_call simulation and gas estimate");
  }

  // native-amount sanity vs acting wallet
  if (input.amount != null && wallet && !ADDRESS_RE.test(token)) {
    const wei = prosToWei(input.amount);
    if (wei == null) factors.push("'amount' is not a well-formed decimal string — ignored");
    else if (wei > wallet.balance) { factors.push("Amount exceeds the acting wallet's PROS balance"); score += 25; }
  }

  // URL-centric intents: static link checks + recipient analysis, never a fetch
  if (isUrlIntent) {
    const url = String(input.url || input.link || "");
    if (!url) {
      missingInputs.push("url (the payment/campaign link)");
      factors.push("No URL provided — link safety was not verified");
      score = Math.max(score, 35);
    } else {
      parts.url = urlRisk(url);
      evidenceUsed.push("static URL risk analysis (string inspection only — the hosted engine never fetches arbitrary URLs)");
      if (parts.url.factors.length) { factors.push(...parts.url.factors); score += parts.url.add; }
    }
    const payTo = String(input.payTo || input.recipient || "");
    if (ADDRESS_RE.test(payTo)) {
      parts.payTo = await analyzeWallet(payTo, { expect: "any" });
      evidenceUsed.push("payTo address analysis (on-chain + GoPlus)");
      if (parts.payTo.riskScore > 30) { factors.push(`payTo risk (${parts.payTo.riskLevel}): ${parts.payTo.riskFactors[0] || ""}`); score += Math.min(35, parts.payTo.riskScore / 2); }
    } else {
      missingInputs.push("payTo (0x recipient) for recipient analysis");
    }
    if (ADDRESS_RE.test(token)) { /* token block above already ran */ }
  }

  // optional vault-status provider (real call ONLY when configured; else unavailable)
  let vaultProviderData = null;
  if (action === "vault_deposit" || action === "yield_deposit") {
    const { endpoint } = providerEndpoint("vaultStatus");
    if (endpoint && ADDRESS_RE.test(target)) {
      try {
        const data = await providerPost(endpoint, { vault: target, chainId: CHAIN_ID });
        vaultProviderData = { providerStatus: "ok", endpoint, data };
        evidenceUsed.push("vault-status provider (configured public endpoint)");
      } catch (e) {
        vaultProviderData = { providerStatus: "provider_unavailable", endpoint, reason: sanitizeReason((e && e.message) || e) };
      }
    } else {
      vaultProviderData = {
        providerStatus: "not_configured",
        tvl: null, depositCap: null, paused: null, withdrawalsOpen: null, apy: null,
        note: "No vault-status provider configured — these fields are unavailable, not zero, and are never invented.",
      };
    }
  }

  const intentNotes = [];
  if (action === "bridge") intentNotes.push("SafeHands never bridges. This is a pre-signature check of token, router, approvals, and calldata only.");
  if (action === "staking") intentNotes.push("SafeHands never stakes. This is a pre-signature check of the staking contract, token, approvals, and calldata only.");
  if (action === "vault_deposit" || action === "yield_deposit") intentNotes.push("This score rates deposit-interaction risk (contract, token, approvals, simulation) — NOT yield quality or APY.");
  if (action === "tokenized_asset") intentNotes.push("On-chain surface, registry, and GoPlus checks only — offering documents and real-world asset backing are NOT verifiable from the hosted engine.");
  if (action === "fiat_ramp") intentNotes.push("SafeHands does not process or approve fiat on/off-ramp payments and cannot attest the operator's legitimacy — this is link and address risk only.");
  if (action === "reward_campaign") intentNotes.push("SafeHands cannot confirm a campaign or reward is legitimate — absence of adverse signals is not an endorsement.");
  if (action === "x402_payment") intentNotes.push("The x402 fetch/payment is NOT executed — static URL, recipient, token, and amount checks only.");

  const rep = report(score, factors, { type: "intent", action, walletAddress: ADDRESS_RE.test(String(input.walletAddress || "")) ? input.walletAddress : null });
  rep.components = parts;
  rep.evidenceUsed = evidenceUsed;
  rep.missingInputs = missingInputs;
  rep.intentNotes = intentNotes;
  if (vaultProviderData) {
    rep.vaultRiskScore = rep.riskScore; // interaction risk, not APY quality
    rep.vaultProviderData = vaultProviderData;
  }
  return rep;
}

async function analyzeIntent(input) {
  const action = String(input.action || "");
  const all = [...FUND_MOVING_ACTIONS, ...URL_ACTIONS];
  if (!all.includes(action)) return fail("VALIDATION_ERROR", `intent 'action' must be one of: ${all.join(", ")}.`);
  if (FUND_MOVING_ACTIONS.includes(action) && !ADDRESS_RE.test(String(input.walletAddress || ""))) {
    return fail("VALIDATION_ERROR", `'${action}' intent analysis requires a valid 'walletAddress' (the acting wallet).`);
  }
  if (!["transfer", "swap"].includes(action)) return analyzeRealFiIntent(input, action);
  const factors = []; let score = 10; const parts = {};
  const wallet = await probeAddress(input.walletAddress);
  if (action === "transfer") {
    if (!ADDRESS_RE.test(String(input.toAddress || ""))) return fail("VALIDATION_ERROR", "transfer intent requires a valid 'toAddress'.");
    const rec = await analyzeWallet(input.toAddress, { expect: "any" });
    parts.recipient = rec;
    if (rec.riskScore > 30) { factors.push(`Recipient risk: ${rec.riskFactors.join("; ") || rec.riskLevel}`); score += Math.min(35, rec.riskScore / 2); }
    const wei = input.amount != null ? prosToWei(input.amount) : null;
    if (input.amount != null && wei === null) return fail("VALIDATION_ERROR", "'amount' must be a positive decimal string, e.g. \"1.5\".");
    if (wei !== null) {
      if (wei <= 0n) return fail("VALIDATION_ERROR", "'amount' must be greater than zero.");
      if (wei > wallet.balance) { factors.push("Amount exceeds the acting wallet's PROS balance"); score += 40; }
      else if (wallet.balance - wei < wei / 100n) { factors.push("Transfer nearly empties the wallet (leaves <1% headroom for gas)"); score += 15; }
    }
  } else {
    for (const k of ["tokenIn", "tokenOut"]) {
      if (!ADDRESS_RE.test(String(input[k] || ""))) return fail("VALIDATION_ERROR", `swap intent requires a valid '${k}' address.`);
    }
    const [ti, to] = await Promise.all([analyzeContract(input.tokenIn), analyzeContract(input.tokenOut)]);
    parts.tokenIn = ti; parts.tokenOut = to;
    for (const [label, r] of [["tokenIn", ti], ["tokenOut", to]]) {
      if (r.riskScore > 30) { factors.push(`${label} risk (${r.riskLevel}): ${r.riskFactors[0] || ""}`); score += Math.min(40, r.riskScore / 2); }
    }
  }
  if (wallet.nonce === 0) { factors.push("Acting wallet has zero transaction history"); score += 10; }
  const rep = report(score, factors, { type: "intent", action, walletAddress: input.walletAddress });
  rep.components = parts;
  return rep;
}

async function cmdAnalyze(raw) {
  let input; try { input = JSON.parse(raw); } catch { return fail("VALIDATION_ERROR", "analyze expects a JSON argument."); }
  // 'data' (calldata) legitimately contains 64-hex words; it is exempt from the
  // 64-hex heuristic only — the secret-keyword check still covers the full input.
  const keyErr = rejectKeyLike(input, ["data", "txHash", "storageKeys"]); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  if (input.chainId != null && Number(input.chainId) !== CHAIN_ID)
    return fail("CHAIN_NOT_SUPPORTED", `Only Pharos pacific-mainnet (chainId ${CHAIN_ID}) is supported.`);
  const st = String(input.subjectType || "");
  if (st === "wallet" || st === "contract") {
    if (!ADDRESS_RE.test(String(input.address || ""))) return fail("VALIDATION_ERROR", "'address' must be a valid 0x EVM address.");
    return st === "wallet" ? analyzeWallet(input.address) : analyzeContract(input.address);
  }
  if (st === "intent") return analyzeIntent(input);
  return fail("VALIDATION_ERROR", "subjectType must be 'wallet', 'contract', or 'intent'. (tx-hash analysis requires the full SafeHands backend and is not available fully-hosted.)");
}

async function cmdQuery(subject) {
  if (!ADDRESS_RE.test(String(subject || ""))) return fail("VALIDATION_ERROR", "query expects a valid 0x EVM address argument.");
  const out = { success: true, subject, registry: { configured: false }, reputation: { configured: false }, records: [], recordsSource: null, network: "pacific-mainnet", chainId: CHAIN_ID, timestamp: new Date().toISOString() };
  if (ADDRESS_RE.test(REGISTRY_ADDR)) {
    const [root, uriHex, agentHex] = await Promise.all([
      ethCall(REGISTRY_ADDR, SEL.currentMerkleRoot),
      ethCall(REGISTRY_ADDR, SEL.currentDataURI),
      ethCall(REGISTRY_ADDR, SEL.isAuthorizedAgent + encAddr(subject)),
    ]);
    const dataURI = decString(uriHex);
    out.registry = {
      configured: true, contractAddress: REGISTRY_ADDR, currentMerkleRoot: root,
      hasCommittedRoot: root && !/^0x0+$/.test(root), currentDataURI: dataURI,
      isAuthorizedAgent: decUint(agentHex) === 1n,
      explorer: `${EXPLORER}/address/${REGISTRY_ADDR}`,
    };
    if (dataURI && /^https?:\/\//.test(dataURI)) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(dataURI, { signal: ctl.signal }); clearTimeout(t);
        const text = (await res.text()).slice(0, 1_500_000);
        const batch = JSON.parse(text);
        const recs = (batch.records || []).filter((r) => String(r.target || "").toLowerCase() === subject.toLowerCase());
        out.records = recs.map((r) => ({
          target: r.target, actionHash: r.actionHash, riskScore: Number(String(r.score ?? r.riskScore ?? "").replace(/n$/, "")),
          riskLevel: LEVELS[Number(String(r.level ?? "").replace(/n$/, ""))] ?? r.level,
          recommendation: RECS[Number(String(r.recommendation ?? "").replace(/n$/, ""))] ?? r.recommendation,
          expiresAt: r.expiresAt, expired: r.expiresAt ? Number(String(r.expiresAt).replace(/n$/, "")) * 1000 < Date.now() : null,
        }));
        out.recordsSource = "dataURI";
      } catch { out.recordsSource = "dataURI-unreachable"; }
    }
  }
  if (ADDRESS_RE.test(ATTEST_ADDR)) {
    try {
      const repHex = await ethCall(ATTEST_ADDR, SEL.reputationOf + encAddr(subject));
      const body = repHex.slice(2);
      out.reputation = {
        configured: true, contractAddress: ATTEST_ADDR,
        verifiedActionCount: Number(BigInt("0x" + (body.slice(0, 64) || "0"))),
        lastVerifiedActionAt: Number(BigInt("0x" + (body.slice(64, 128) || "0"))),
      };
      out.reputation.interpretation = out.reputation.verifiedActionCount > 0
        ? `Agent has ${out.reputation.verifiedActionCount} verified on-chain action(s).`
        : "No verified actions recorded — neutral, not necessarily unsafe.";
    } catch { out.reputation = { configured: true, contractAddress: ATTEST_ADDR, error: "reputation read failed" }; }
  }
  if (!out.registry.configured && !out.reputation.configured) {
    out.note = "SafeHands contract addresses are not configured in assets/contracts.json — on-chain record/reputation queries unavailable; analysis features are unaffected.";
  }
  return out;
}

// ── read-only market & network data commands ─────────────────────────────
// Every command below performs ONLY eth_call / eth_get* / eth_gasPrice /
// eth_estimateGas reads (or a gated public keyless HTTPS provider). No command
// signs, broadcasts, approves, or mutates anything.

function parseJsonArg(raw) {
  try { const j = JSON.parse(raw); return (j && typeof j === "object") ? j : null; } catch { return null; }
}
function chainGuard(input) {
  if (input && input.chainId != null && Number(input.chainId) !== CHAIN_ID)
    return fail("CHAIN_NOT_SUPPORTED", `Only Pharos pacific-mainnet (chainId ${CHAIN_ID}) is supported.`);
  return null;
}

async function cmdGasPrice() {
  const hex = await rpc("eth_gasPrice");
  const wei = decUint(hex);
  return {
    success: true, command: "get_gas_price",
    wei: wei.toString(), gwei: formatUnits(wei, 9),
    source: "pharos-rpc eth_gasPrice", chainId: CHAIN_ID, timestamp: new Date().toISOString(),
  };
}

async function cmdTokenPrice(raw) {
  const j = parseJsonArg(raw);
  let symbol = raw;
  if (j) {
    const keyErr = rejectKeyLike(j); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
    const cg = chainGuard(j); if (cg) return cg;
    symbol = j.symbol ?? j.token ?? "";
  }
  const requested = String(symbol || "").trim().toUpperCase().replace(/^\$/, "");
  if (!/^[A-Z0-9]{2,12}$/.test(requested)) {
    return fail("VALIDATION_ERROR", "get_token_price expects a token symbol, e.g. 'PROS' or '{\"symbol\":\"PROS\"}'.");
  }
  const canonical = String(FEED_ALIASES[requested] || requested);
  const feed = FEEDS[canonical];
  const supported = [...Object.keys(FEEDS), ...Object.keys(FEED_ALIASES)].sort();
  if (!feed || !ADDRESS_RE.test(String(feed.feedAddress || ""))) {
    return fail("FEED_NOT_CONFIGURED", `No Chainlink Push feed is configured for '${requested}' on Pharos Pacific Mainnet.`, {
      command: "get_token_price", provider: "chainlink-push",
      reason: "symbol not present in assets/supported-assets.json",
      supportedSymbols: supported,
      safeFallback: "Do not guess or hardcode a price. Offer one of the supported symbols instead.",
    });
  }
  const base = {
    command: "get_token_price", requestedSymbol: requested, symbol: canonical,
    pair: feed.pair || `${canonical}/USD`, aliased: canonical !== requested,
    feedAddress: feed.feedAddress,
    source: "chainlink-push feed via Pharos RPC eth_call (latestAnswer/latestTimestamp)",
    chainId: CHAIN_ID, timestamp: new Date().toISOString(),
  };
  if (FEED_ALIAS_NOTES[requested]) base.aliasNote = FEED_ALIAS_NOTES[requested];
  if (feed.feedOnly) base.note = feed.note || "Feed-only symbol: price reads supported; wallet-balance/token analysis not claimed.";
  // Sequential reads on purpose: the public Pharos RPC rate-limits parallel eth_call bursts.
  const answerHex = await ethCall(feed.feedAddress, SEL.latestAnswer);
  const tsHex = await ethCall(feed.feedAddress, SEL.latestTimestamp);
  const decHex = await ethCall(feed.feedAddress, SEL.decimals).catch(() => null);
  const answerBody = (answerHex || "0x").slice(2);
  if (answerBody.length < 64) {
    return fail("PROVIDER_UNAVAILABLE", "Chainlink feed returned an unreadable latestAnswer payload.", {
      ...base, provider: "chainlink-push", reason: "short/invalid eth_call return",
      safeFallback: "Do not guess a price; report the feed as unavailable.",
    });
  }
  const answer = decInt256(answerBody.slice(0, 64));
  const updatedAt = Number(decUint(tsHex));
  const feedDecimals = decHex ? Number(decUint(decHex)) : FEED_DECIMALS_DEFAULT;
  if (answer <= 0n) {
    return fail("PROVIDER_UNAVAILABLE", "Feed answered a non-positive value — treating the feed as unavailable.", {
      ...base, provider: "chainlink-push", feedDecimals, answerRaw: answer.toString(),
      safeFallback: "Do not guess a price; report the feed as unavailable.",
    });
  }
  const feedAgeSeconds = Math.max(0, Math.floor(Date.now() / 1000) - updatedAt);
  const heartbeatSeconds = Number(feed.heartbeatSeconds) || FEED_HEARTBEAT_DEFAULT;
  const price = formatUnits(answer, feedDecimals);
  const detail = { feedDecimals, answerRaw: answer.toString(), updatedAt, feedAgeSeconds, heartbeatSeconds };
  if (feedAgeSeconds > heartbeatSeconds) {
    // Stale = heartbeat violation. The last answer is included as EVIDENCE, clearly
    // labeled — it must never be presented as a current price.
    return fail("FEED_STALE", `Feed heartbeat violated: last update ${feedAgeSeconds}s ago (heartbeat ${heartbeatSeconds}s). Not serving this as a current price.`, {
      ...base, ...detail, provider: "chainlink-push", stale: true, sourceStatus: "stale",
      lastKnownAnswer: price,
      safeFallback: "Report the feed as stale; do not quote lastKnownAnswer as the current price.",
    });
  }
  return { success: true, ...base, ...detail, price, stale: false, sourceStatus: "ok" };
}

async function cmdCheckAllowance(raw) {
  const j = parseJsonArg(raw);
  if (!j) return fail("VALIDATION_ERROR", "check_allowance expects JSON: {\"token\":…,\"owner\":…,\"spender\":…}.");
  const keyErr = rejectKeyLike(j); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const cg = chainGuard(j); if (cg) return cg;
  for (const k of ["token", "owner", "spender"]) {
    if (!ADDRESS_RE.test(String(j[k] || ""))) return fail("VALIDATION_ERROR", `'${k}' must be a valid 0x EVM address.`);
  }
  const [alHex, t] = await Promise.all([
    ethCall(j.token, SEL.allowance + encAddr(j.owner) + encAddr(j.spender)),
    erc20Probe(j.token),
  ]);
  const allowance = decUint(alHex);
  const UNLIMITED_FLOOR = 2n ** 255n;
  const approvalRisk = allowance === 0n ? "none" : allowance >= UNLIMITED_FLOOR ? "unlimited" : "scoped";
  const approvalRiskHint = approvalRisk === "unlimited"
    ? "UNLIMITED approval — the spender can move the owner's entire current and future balance of this token. High risk; revoke or scope it unless the spender is fully trusted."
    : approvalRisk === "scoped"
      ? "Finite approval — exposure is capped at the approved amount. Verify the spender before increasing it."
      : "No approval — the spender cannot move this token for this owner.";
  return {
    success: true, command: "check_allowance",
    token: j.token, owner: j.owner, spender: j.spender,
    tokenSymbol: t.symbol ?? null, tokenDecimals: t.decimals ?? null,
    allowanceRaw: allowance.toString(),
    allowanceFormatted: t.decimals != null ? formatUnits(allowance, t.decimals) : null,
    approvalRisk, approvalRiskHint,
    readOnly: "reads allowance(owner,spender) only — this command never grants, changes, or revokes an approval",
    chainId: CHAIN_ID, timestamp: new Date().toISOString(),
  };
}

async function cmdTxStatus(raw) {
  const j = parseJsonArg(raw);
  let h = raw;
  if (j) {
    const keyErr = rejectKeyLike(j, ["txHash", "hash"]); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
    const cg = chainGuard(j); if (cg) return cg;
    h = j.txHash ?? j.hash ?? "";
  }
  h = String(h || "").trim();
  if (!TXHASH_RE.test(h)) return fail("VALIDATION_ERROR", "get_transaction_status expects a 0x + 64-hex TRANSACTION HASH. Never pass private keys or seed phrases.");
  const [tx, rc] = await Promise.all([
    rpc("eth_getTransactionByHash", [h]),
    rpc("eth_getTransactionReceipt", [h]),
  ]);
  const status = (!tx && !rc) ? "not_found" : !rc ? "pending" : rc.status === "0x1" ? "success" : "failed";
  return {
    success: true, command: "get_transaction_status", txHash: h, status,
    blockNumber: rc && rc.blockNumber ? Number(decUint(rc.blockNumber)) : (tx && tx.blockNumber ? Number(decUint(tx.blockNumber)) : null),
    gasUsed: rc && rc.gasUsed ? decUint(rc.gasUsed).toString() : null,
    receiptStatus: rc ? (rc.status ?? null) : null,
    from: (rc && rc.from) || (tx && tx.from) || null,
    to: (rc && rc.to) || (tx && tx.to) || null,
    explorer: `${EXPLORER}/tx/${h}`,
    chainId: CHAIN_ID, timestamp: new Date().toISOString(),
  };
}

async function cmdEstimateGas(raw) {
  const j = parseJsonArg(raw);
  if (!j) return fail("VALIDATION_ERROR", "estimate_gas expects JSON: {\"from\":…,\"to\":…,\"data\":…,\"value\":…}.");
  const keyErr = rejectKeyLike(j, ["data"]); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const cg = chainGuard(j); if (cg) return cg;
  const { tx, errs } = buildTxObject(j);
  if (errs.length) return fail("VALIDATION_ERROR", errs.join("; "));
  try {
    const hex = await rpc("eth_estimateGas", [tx]);
    return {
      success: true, command: "estimate_gas",
      estimatedGas: Number(decUint(hex)), estimatedGasHex: hex,
      broadcast: false, note: "eth_estimateGas is a node-side dry run — nothing was signed or broadcast",
      chainId: CHAIN_ID, timestamp: new Date().toISOString(),
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!/^RPC /.test(msg)) throw e; // network/HTTP failure → outer PHAROS_RPC_UNAVAILABLE mapping
    return fail("ESTIMATE_FAILED", sanitizeReason(msg), {
      command: "estimate_gas", reverted: /revert|execution/i.test(msg), broadcast: false,
      safeFallback: "Treat the transaction as likely to fail on-chain; do not execute it as-is.",
    });
  }
}

async function cmdSimulateTransaction(raw) {
  const j = parseJsonArg(raw);
  if (!j) return fail("VALIDATION_ERROR", "simulate_transaction expects JSON: {\"from\":…,\"to\":…,\"data\":…,\"value\":…}.");
  const keyErr = rejectKeyLike(j, ["data"]); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const cg = chainGuard(j); if (cg) return cg;
  const { tx, errs } = buildTxObject(j);
  if (errs.length) return fail("VALIDATION_ERROR", errs.join("; "));
  try {
    const ret = await rpc("eth_call", [tx, "latest"]);
    return {
      success: true, command: "simulate_transaction", reverted: false, returnData: ret,
      broadcast: false, note: "eth_call simulation only — nothing was signed or broadcast",
      chainId: CHAIN_ID, timestamp: new Date().toISOString(),
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!/^RPC /.test(msg)) throw e;
    return fail("SIMULATION_REVERTED", sanitizeReason(msg), {
      command: "simulate_transaction", reverted: true, broadcast: false,
      safeFallback: "The call reverts against current chain state; treat the action as failing and do not execute it.",
    });
  }
}

async function cmdSpvProof(raw) {
  const j = parseJsonArg(raw) || { address: raw };
  const keyErr = rejectKeyLike(j, ["storageKeys"]); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const cg = chainGuard(j); if (cg) return cg;
  if (!ADDRESS_RE.test(String(j.address || ""))) return fail("VALIDATION_ERROR", "'address' must be a valid 0x EVM address.");
  const keys = Array.isArray(j.storageKeys) ? j.storageKeys : [];
  for (const k of keys) {
    if (!TXHASH_RE.test(String(k || ""))) return fail("VALIDATION_ERROR", "each storageKeys entry must be a 0x + 64-hex storage slot key.");
  }
  const tag = j.blockTag != null ? String(j.blockTag) : "latest";
  if (!/^(latest|finalized|safe|earliest|0x[0-9a-fA-F]+)$/.test(tag)) return fail("VALIDATION_ERROR", "'blockTag' must be latest|finalized|safe|earliest or a 0x block number.");
  try {
    const proof = await rpc("eth_getProof", [j.address, keys, tag], 20000);
    return {
      success: true, command: "get_spv_proof", address: j.address, blockTag: tag, storageKeys: keys,
      proof, source: "pharos-rpc eth_getProof",
      chainId: CHAIN_ID, timestamp: new Date().toISOString(),
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/RPC -32601|method not (found|supported)|does not exist|not supported|unsupported/i.test(msg)) {
      return fail("NOT_SUPPORTED", "eth_getProof is not supported by this Pharos RPC endpoint.", {
        command: "get_spv_proof", method: "eth_getProof",
        safeFallback: "No proof is available from this endpoint. Never fabricate or approximate a proof.",
      });
    }
    if (!/^RPC /.test(msg)) throw e;
    return fail("PROOF_QUERY_FAILED", sanitizeReason(msg), { command: "get_spv_proof" });
  }
}

// ── gated public-provider commands (assets/supported-protocols.json) ─────
// An endpoint is honored ONLY if it is https and keyless. When unset, the
// command reports *_NOT_CONFIGURED — it never invents provider data.
function providerEndpoint(name) {
  const p = PROVIDERS[name] || {};
  const ep = typeof p.endpoint === "string" && /^https:\/\//.test(p.endpoint) ? p.endpoint : null;
  return { endpoint: ep, config: p };
}
function providerNotConfigured(command, provider, code) {
  return fail(code, `No ${provider} endpoint is configured in assets/supported-protocols.json.`, {
    command, provider, providerStatus: "not_configured",
    reason: "endpoint is null — only verified public keyless endpoints may be configured",
    safeFallback: "Report this data as unavailable. Do not scrape, guess, or invent results.",
  });
}
const SECRETISH_FIELDS = ["headers", "authorization", "apiKey", "api_key", "token", "cookie", "passKey", "pass_key", "bearer"];
function rejectSecretFields(j) {
  for (const f of SECRETISH_FIELDS) if (j[f] != null) return `'${f}' is not accepted — provider calls are keyless and header-free by policy`;
  return null;
}
async function providerPost(endpoint, payload) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload), signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
    return JSON.parse((await res.text()).slice(0, 1_500_000));
  } finally { clearTimeout(t); }
}

async function cmdGoldsky(raw) {
  const j = parseJsonArg(raw);
  if (!j) return fail("VALIDATION_ERROR", "query_goldsky_subgraph expects JSON: {\"query\":\"{ … }\",\"variables\":{…}}.");
  const keyErr = rejectKeyLike(j); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const secErr = rejectSecretFields(j); if (secErr) return fail("VALIDATION_ERROR", secErr);
  const { endpoint } = providerEndpoint("goldsky");
  if (!endpoint) return providerNotConfigured("query_goldsky_subgraph", "goldsky", "GOLDSKY_NOT_CONFIGURED");
  const query = String(j.query || "");
  if (!query.trim() || query.length > 10000) return fail("VALIDATION_ERROR", "'query' must be a non-empty GraphQL string (max 10000 chars).");
  try {
    const data = await providerPost(endpoint, { query, variables: j.variables ?? {} });
    return { success: true, command: "query_goldsky_subgraph", provider: "goldsky", endpoint, data, chainId: CHAIN_ID, timestamp: new Date().toISOString() };
  } catch (e) {
    return fail("PROVIDER_UNAVAILABLE", sanitizeReason((e && e.message) || e), {
      command: "query_goldsky_subgraph", provider: "goldsky", endpoint,
      safeFallback: "Report subgraph data as unavailable; do not invent indexer results.",
    });
  }
}

async function cmdExecutionHistory(raw) {
  const j = parseJsonArg(raw) || { address: raw };
  const keyErr = rejectKeyLike(j); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const secErr = rejectSecretFields(j); if (secErr) return fail("VALIDATION_ERROR", secErr);
  if (!ADDRESS_RE.test(String(j.address || ""))) return fail("VALIDATION_ERROR", "'address' must be a valid 0x EVM address.");
  const { endpoint } = providerEndpoint("executionHistory");
  if (!endpoint) return providerNotConfigured("get_execution_history", "execution-history indexer", "HISTORY_PROVIDER_NOT_CONFIGURED");
  try {
    const data = await providerPost(endpoint, { address: j.address, limit: Math.min(Number(j.limit) || 25, 100) });
    return { success: true, command: "get_execution_history", provider: "execution-history indexer", endpoint, address: j.address, data, chainId: CHAIN_ID, timestamp: new Date().toISOString() };
  } catch (e) {
    return fail("PROVIDER_UNAVAILABLE", sanitizeReason((e && e.message) || e), {
      command: "get_execution_history", provider: "execution-history indexer", endpoint,
      safeFallback: "Report history as unavailable; do not scrape explorers or invent transactions.",
    });
  }
}

async function cmdPoolInfo(raw) {
  const j = parseJsonArg(raw) || {};
  const keyErr = rejectKeyLike(j); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const secErr = rejectSecretFields(j); if (secErr) return fail("VALIDATION_ERROR", secErr);
  const { endpoint } = providerEndpoint("poolInfo");
  if (!endpoint) return providerNotConfigured("get_pool_info", "pool-info provider", "PROVIDER_NOT_CONFIGURED");
  for (const k of ["poolAddress", "tokenA", "tokenB"]) {
    if (j[k] != null && !ADDRESS_RE.test(String(j[k]))) return fail("VALIDATION_ERROR", `'${k}' must be a valid 0x EVM address.`);
  }
  try {
    const data = await providerPost(endpoint, { poolAddress: j.poolAddress ?? null, tokenA: j.tokenA ?? null, tokenB: j.tokenB ?? null });
    return {
      success: true, command: "get_pool_info", provider: "pool-info provider", endpoint, data,
      note: "Pool/route data is liquidity context only — NEVER a canonical price. Use get_token_price (Chainlink Push) for pricing.",
      chainId: CHAIN_ID, timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return fail("PROVIDER_UNAVAILABLE", sanitizeReason((e && e.message) || e), {
      command: "get_pool_info", provider: "pool-info provider", endpoint,
      safeFallback: "Report pool data as unavailable; do not invent liquidity, routes, or prices.",
    });
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────
const [cmd, arg] = process.argv.slice(2);
const run = cmd === "health" ? cmdHealth()
  : cmd === "analyze" ? cmdAnalyze(arg ?? "")
  : cmd === "query" ? cmdQuery(arg ?? "")
  : cmd === "get_gas_price" ? cmdGasPrice()
  : cmd === "get_token_price" ? cmdTokenPrice(arg ?? "")
  : cmd === "check_allowance" ? cmdCheckAllowance(arg ?? "")
  : cmd === "get_transaction_status" ? cmdTxStatus(arg ?? "")
  : cmd === "estimate_gas" ? cmdEstimateGas(arg ?? "")
  : cmd === "simulate_transaction" ? cmdSimulateTransaction(arg ?? "")
  : cmd === "get_spv_proof" ? cmdSpvProof(arg ?? "")
  : cmd === "query_goldsky_subgraph" ? cmdGoldsky(arg ?? "")
  : cmd === "get_execution_history" ? cmdExecutionHistory(arg ?? "")
  : cmd === "get_pool_info" ? cmdPoolInfo(arg ?? "")
  : Promise.resolve(fail("USAGE", "usage: safehands-engine.js <health|analyze|query|get_gas_price|get_token_price|check_allowance|get_transaction_status|estimate_gas|simulate_transaction|get_spv_proof|query_goldsky_subgraph|get_execution_history|get_pool_info> ['<json-or-arg>']"));
run.then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.success ? 0 : 1); })
   .catch((e) => {
     const msg = String(e && e.message || e);
     const code = e && e.safehandsCode ? e.safehandsCode
       : /abort/i.test(msg) ? "RPC_TIMEOUT" : /HTTP|fetch|network/i.test(msg) ? "PHAROS_RPC_UNAVAILABLE" : "ENGINE_ERROR";
     const retryable = code === "RPC_TIMEOUT" || code === "PHAROS_RPC_UNAVAILABLE";
     console.log(JSON.stringify(fail(code, msg, { retryable }), null, 2)); process.exit(1);
   });
