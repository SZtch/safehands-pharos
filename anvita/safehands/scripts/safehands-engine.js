#!/usr/bin/env node
/**
 * safehands-engine.js: SafeHands fully-hosted risk engine (zero dependencies)
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
 * `analyze` intents that carry tx calldata additionally get an OFFLINE decode of
 * approval / transfer / admin selectors (unlimited-approval detection, operator
 * denylist, dangerous-admin recognition): pure string inspection, escalate-only
 * risk floors, no extra RPC.
 *
 * Env overrides: PHAROS_RPC_URL, GOPLUS_API_BASE, SAFEHANDS_REGISTRY_ADDRESS,
 * SAFEHANDS_ATTESTATION_ADDRESS, SAFEHANDS_RECIPIENT_DENYLIST (comma-separated
 * 0x addresses the operator wants transfers/payments to hard-block on; EMPTY by
 * default; SafeHands never ships a fabricated scam list).
 *
 * Everything is READ-ONLY: eth_call / eth_get* / eth_gasPrice / eth_estimateGas only.
 * This engine never signs, broadcasts, approves, swaps, bridges, deposits, stakes,
 * pays, creates wallets, or publishes records.
 *
 * Output: single JSON object on stdout. Exit 0 means the ANALYSIS completed
 * (a BLOCK verdict still exits 0); exit 1 means the analysis itself failed. A
 * caller MUST branch on the `recommendation` field (allow/warn/block), NEVER on
 * the exit code, to decide whether an action is safe.
 * Requires Node >= 18 (built-in fetch).
 */
import { readFileSync, realpathSync } from "node:fs";
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
const CHAIN_ID = 1672; // mainnet lock; never analyze/report for other chains
const EXPLORER = NET.explorerUrl || "https://www.pharosscan.xyz";
const GOPLUS_BASE = process.env.GOPLUS_API_BASE || "https://api.gopluslabs.io"; // public v1 endpoints, no key required
// Engine version: MUST equal the repo package.json version. Enforced by
// scripts/sync-anvita-assets.ts --check (UA drift guard); update both together.
const ENGINE_VERSION = "2.5.0";
const ENGINE_UA = `SafeHands/${ENGINE_VERSION}`;

const CMAP = CONTRACTS.contracts || CONTRACTS; // supports both {contracts:{...}} and flat shapes
const REGISTRY_ADDR = process.env.SAFEHANDS_REGISTRY_ADDRESS
  || (CMAP.SafeHandsRegistry && CMAP.SafeHandsRegistry.address) || "";
const ATTEST_ADDR = process.env.SAFEHANDS_ATTESTATION_ADDRESS
  || (CMAP.SafeHandsAttestation && CMAP.SafeHandsAttestation.address) || "";

// ── precomputed keccak-256 selectors (verified against standard vectors) ─
// Single object by design: scripts/sync-anvita-assets.ts regex-parses this
// block up to the FIRST closing brace; keep every selector in here and never
// add a second selector object.
const SEL = {
  name: "0x06fdde03", symbol: "0x95d89b41", decimals: "0x313ce567", totalSupply: "0x18160ddd",
  allowance: "0xdd62ed3e",          // allowance(address,address)
  balanceOf: "0x70a08231",          // balanceOf(address)
  latestAnswer: "0x50d25bcd",       // Chainlink Push latestAnswer() int256
  latestTimestamp: "0x8205bf6a",    // Chainlink Push latestTimestamp() uint256
  currentMerkleRoot: "0x9ea97190", currentDataURI: "0x59e99f26",
  isAuthorizedAgent: "0x6bf722ab", isAuthorizedOperator: "0x82d52c1e",
  reputationOf: "0xdb89c044",
  // action selectors for the offline calldata decode (escalate-only floors)
  approve: "0x095ea7b3",            // approve(address,uint256)
  permit: "0xd505accf",             // ERC-2612 permit(owner,spender,value,deadline,v,r,s)
  permit2Approve: "0x87517c45",     // Permit2 approve(token,spender,amount,expiration)
  setApprovalForAll: "0xa22cb465",  // setApprovalForAll(operator,approved)
  transferFrom: "0x23b872dd",       // transferFrom(from,to,amount)
  transfer: "0xa9059cbb",           // transfer(to,amount)
  increaseAllowance: "0x39509351", decreaseAllowance: "0xa457c2d7",
  transferOwnership: "0xf2fde38b", renounceOwnership: "0x715018a6",
  upgradeTo: "0x3659cfe6", upgradeToAndCall: "0x4f1ef286", changeAdmin: "0x8f283970",
  multiSend: "0x8d80ff0a",          // Safe MultiSend multiSend(bytes)
  execTransaction: "0x6a761202",    // Safe execTransaction(...)
};

// Approval-amount semantics, shared with the TS engine (isUnlimitedApprovalAmount):
// any value >= 2^255 counts as unlimited. Permit2 amounts are uint160, so
// type(uint160).max means "infinite" there.
const UNLIMITED_FLOOR = 2n ** 255n;
const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3"; // canonical singleton
const PERMIT2_MAX = (1n << 160n) - 1n;

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
// calldata words, storage keys); those exact fields may be exempted from the
// 64-hex heuristic via ignore64HexKeys, but the secret-keyword check ALWAYS runs
// on the full input. Nothing here ever stores or forwards the value beyond the
// single read-only RPC lookup it was provided for.
function rejectKeyLike(obj, ignore64HexKeys = []) {
  const full = JSON.stringify(obj || {});
  if (/private[_-]?key|mnemonic|seed[_-]?phrase|secret[_-]?key/i.test(full)) return "input contains key-like material; this engine never handles secrets";
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
  const d = Number(decimals);
  // Defensive: a hostile token/feed decimals() can be enormous; padStart with a
  // huge target length throws RangeError. Never crash on attacker-controlled
  // decimals; a caller wanting a strict result should pre-validate the range.
  if (!Number.isInteger(d) || d < 0 || d > 100) return raw.toString();
  const neg = raw < 0n; const v = neg ? -raw : raw;
  const s = v.toString().padStart(d + 1, "0");
  const i = s.slice(0, s.length - d) || "0";
  const f = d ? s.slice(s.length - d).replace(/0+$/, "") : "";
  return (neg ? "-" : "") + i + (f ? "." + f : "");
}
function decInt256(word64) { // 64 hex chars → signed BigInt (two's complement)
  let v = BigInt("0x" + word64);
  if (v >= 2n ** 255n) v -= 2n ** 256n;
  return v;
}
// Revert/provider messages are surfaced to the user; strip non-printables and cap.
function sanitizeReason(msg) { return String(msg || "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300); }
// On-chain token metadata (name/symbol) is attacker-controlled and flows into
// user-facing factors/output: strip non-printable bytes and cap length so a
// hostile token cannot inject misleading/control-character text downstream.
function sanitizeOnchainString(s) {
  if (typeof s !== "string") return null;
  return s.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, 128);
}
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
    analysisDepth: "hosted-heuristic (on-chain reads + offline calldata decode; not the full SafeHands analyzer suite)",
    subject, network: "pacific-mainnet", chainId: CHAIN_ID, timestamp: new Date().toISOString(), ...extra,
  };
}

// Escalate-only component composition. An intent verdict must NEVER be more
// permissive than any sub-analysis it performed: a component the engine itself
// scored WARN cannot yield an ALLOW intent, and a BLOCK component cannot yield a
// WARN intent. The additive term keeps multiple medium signals stacking; the
// trailing Math.max is the fail-closed FLOOR to the component's own score.
function composeComponent(score, sub, label, factors, cap) {
  if (!sub || typeof sub.riskScore !== "number") return score;
  if (sub.riskScore > 30) {
    factors.push(`${label} risk (${sub.riskLevel}): ${(sub.riskFactors && sub.riskFactors[0]) || ""}`);
    score += Math.min(cap, sub.riskScore / 2);
  }
  return Math.max(score, sub.riskScore);
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
// ── EIP-1967 proxy probe (direct storage reads; no external intel needed) ──
// An upgradeable proxy's logic can be replaced by its admin at any time, so
// proxy-ness is first-class on-chain evidence, read from the standard slots
// rather than inferred from third-party flags. Reads are serialized: public
// RPC rate limits punish parallel bursts (same reason cmdQuery serializes).
const EIP1967_SLOTS = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
};
function slotToAddress(hex) {
  const h = String(hex || "").toLowerCase().replace(/^0x/, "").padStart(64, "0");
  if (!/^0{24}[0-9a-f]{40}$/.test(h)) return null;
  const addr = "0x" + h.slice(24);
  return addr === "0x0000000000000000000000000000000000000000" ? null : addr;
}
async function proxyProbe(addr) {
  const out = { isProxy: false, implementation: null, implementationHasCode: null, implementationLabel: null, admin: null, beacon: null };
  try {
    for (const [key, slot] of Object.entries(EIP1967_SLOTS)) {
      const raw = await rpc("eth_getStorageAt", [addr, slot, "latest"]);
      const a = slotToAddress(raw);
      if (key === "implementation") out.implementation = a;
      else if (key === "admin") out.admin = a;
      else out.beacon = a;
    }
    out.isProxy = Boolean(out.implementation || out.beacon);
    if (out.implementation) {
      const code = await rpc("eth_getCode", [out.implementation, "latest"]);
      out.implementationHasCode = Boolean(code && code !== "0x");
      out.implementationLabel = CANON_CONTRACTS[out.implementation.toLowerCase()] || null;
    }
  } catch {
    // Storage reads failing is not evidence either way; report proxy status unknown.
    return { isProxy: null, implementation: null, implementationHasCode: null, implementationLabel: null, admin: null, beacon: null };
  }
  return out;
}

async function erc20Probe(addr) {
  const out = {};
  const tryCall = async (key, sel, dec) => { try { const r = await ethCall(addr, sel); out[key] = dec(r); } catch { out[key] = null; } };
  // name/symbol decode through the on-chain-string sanitizer (attacker-controlled).
  const decStrSafe = (h) => { const v = decString(h); return v == null ? null : (sanitizeOnchainString(v) || null); };
  await Promise.all([
    tryCall("name", SEL.name, decStrSafe), tryCall("symbol", SEL.symbol, decStrSafe),
    tryCall("decimals", SEL.decimals, (h) => Number(decUint(h))), tryCall("totalSupply", SEL.totalSupply, (h) => decUint(h).toString()),
  ]);
  return out;
}

// ── GoPlus threat intelligence (public API, keyless, graceful fallback) ──
// Transient failures (rate-limit/5xx/timeout) retry with linear backoff, mirroring the
// self-hosted analyzer's fetchGoplus: a momentary GoPlus hiccup must not push a clean
// subject onto the missing-threat-intel floor. Exhausted retries still return null;
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
  // Fail-closed: result object present but the honeypot decision field is unreadable
  // (renamed/retyped schema) → do NOT read every flag as false; signal drift so the caller
  // applies the missing-threat-intel floor instead of silently under-reporting the token.
  if (!flagKnown(d.is_honeypot)) return { reachable: true, data: null, schemaDrift: true, factors: [], add: 0 };
  // Display-only identity from the SAME security payload (no extra fetch). Untrusted
  // external strings: trim + cap at 128 chars. Never used in scoring or the verdict.
  const optStr = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 128) : undefined);
  const identity = (optStr(d.token_name) || optStr(d.token_symbol))
    ? { tokenName: optStr(d.token_name), tokenSymbol: optStr(d.token_symbol) } : null;
  const factors = []; let add = 0;
  if (flag(d.is_honeypot)) { factors.push("GoPlus: HONEYPOT; token cannot be sold"); add += 80; }
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
  if (flag(d.is_proxy)) { factors.push("GoPlus: upgradeable proxy; logic can change"); add += 10; }
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
    factors.push("GoPlus address intelligence unreachable: scam/phishing status UNVERIFIED; treat as unsafe-until-confirmed");
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
    return report(95, [`No contract code at ${addr}; either not deployed on Pharos mainnet or self-destructed`],
      { type: "contract", address: addr }, { onChain: { isContract: false } });
  }
  const factors = []; let score = 15;
  const known = KNOWN_INFRA.has(addr.toLowerCase());
  if (known) {
    return report(5, [`Canonical registry contract: ${CANON_CONTRACTS[addr.toLowerCase()]} (verified via official-docs citation + on-chain check)`],
      { type: "contract", address: addr },
      { onChain: { isContract: true, codeSize: p.codeSize }, intel: "verified canonical registry (Pharos docs + registry-verified protocol docs)" });
  }
  const t = await erc20Probe(addr);
  const looksToken = t.symbol !== null; // strict: symbol must ABI-decode; fallback junk like 0x0 must not classify as token
  let canonicalVerified = false; // official-registry identity match exempts the missing-threat-intel floor
  if (looksToken && t.symbol) {
    const sym = t.symbol.trim().toUpperCase();
    const official = CANON_TOKENS[sym];
    if (official) {
      if (addr.toLowerCase() === official) { score = Math.min(score, 8); factors.push(`Canonical ${sym} from the official Pharos Token Registry`); canonicalVerified = true; }
      else { factors.push(`IMPERSONATION: claims symbol "${sym}" but is NOT the official Pharos ${sym} (official: ${official}; verify: ${EXPLORER}/address/${official})`); score += 75; }
    }
  }
  if (looksToken) {
    if (t.name === null || t.symbol === null) { factors.push("Token metadata incomplete (non-standard ERC-20 surface)"); score += 20; }
    if (t.decimals === null) { factors.push("decimals() unreadable; integrations may misprice amounts"); score += 10; }
    if (t.totalSupply === "0") { factors.push("Token totalSupply is zero"); score += 15; }
  } else {
    factors.push("Not a standard token interface: unverified custom contract; hosted engine cannot audit its logic");
    score += 25;
  }
  if (p.codeSize < 100) { factors.push(`Suspiciously small bytecode (${p.codeSize} bytes); possible proxy shell or stub`); score += 15; }
  const px = await proxyProbe(addr);
  if (px.isProxy) {
    if (px.implementation && px.implementationHasCode === false) {
      factors.push(`EIP-1967 proxy whose implementation slot points to ${px.implementation}, an address with NO code: a broken or deceptive proxy that cannot execute its advertised logic`);
      score += 40;
    } else if (px.implementation) {
      factors.push(`Upgradeable EIP-1967 proxy (implementation ${px.implementation}${px.implementationLabel ? `; that bytecode address carries the registry label "${px.implementationLabel}", but this proxy address itself is NOT registry-verified and inherits no trust from it` : ""}): the logic can be replaced by its admin at any time`);
      score += 10;
    } else {
      factors.push("Upgradeable beacon proxy (EIP-1967 beacon slot set): the logic can be replaced through the beacon at any time");
      score += 10;
    }
  }
  const gp = await goplusToken(addr);
  const gpUnindexedToken = gp.reachable && !gp.data && !gp.schemaDrift && looksToken; // GoPlus answered but has never vetted THIS token
  if (gp.data && gp.factors.length) { factors.push(...gp.factors); score += gp.add; }
  else if (gpUnindexedToken) { factors.push("Token not yet indexed by GoPlus: very new or obscure; extra caution advised"); score += 10; }
  // A drifted schema (result present but unreadable) or a reachable-but-unindexed token is
  // NOT a real verdict; treat both like an outage: floor the score and disclose, so a token
  // GoPlus has never actually vetted (the classic fresh-rug window) can never read "allow".
  const gpVerified = gp.reachable && !gp.schemaDrift && !gpUnindexedToken;
  if (!gpVerified && !canonicalVerified) {
    factors.push(gp.schemaDrift
      ? "GoPlus returned an unrecognized token-security schema: honeypot/scam status UNVERIFIED; treat as unsafe-until-confirmed"
      : gpUnindexedToken
        ? "Not yet indexed by GoPlus: honeypot status UNVERIFIED; treat as unsafe-until-confirmed"
        : "GoPlus threat intelligence unreachable: honeypot/scam status UNVERIFIED; treat as unsafe-until-confirmed");
    score = Math.max(score, THREAT_INTEL_UNAVAILABLE_FLOOR);
  }
  return report(score, factors, { type: "contract", address: addr }, {
    onChain: { isContract: true, codeSize: p.codeSize, token: looksToken ? t : null, proxy: px },
    ...(gp.identity ? { goplusTokenIdentity: gp.identity } : {}), // display-only, never scored
    intel: gpVerified ? "on-chain + GoPlus threat intelligence" : "on-chain only (GoPlus unverified)",
    limits: gpVerified ? "GoPlus flags included; bespoke sell-simulation and source-level audit are not performed."
      : "GoPlus verdict unavailable for this call: heuristics only; honeypot status unknown.",
  });
}

// ── RealFi intent templates ───────────────────────────────────────────────
// These are ROUTING templates, not data sources: each evidence block runs a real
// read-only check only when its inputs are present; anything absent is reported
// in missingInputs. Provider data that is not configured is reported as
// unavailable, never invented (no fake TVL/APY/cap/paused values).
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
// user-provided URLs; this inspects the string only. IP-range coverage mirrors
// the TS engine's isSuspiciousUrl/isBlockedIp at string level (no DNS lookups).
function ipv4InCidr(ip, cidrBase, prefix) {
  const parse = (s) => s.split(".").map(Number);
  const a = parse(ip), b = parse(cidrBase);
  if (a.length !== 4 || a.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const toN = (o) => (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((toN(a) & mask) >>> 0) === ((toN(b) & mask) >>> 0);
}
// Reserved/special-use IPv4 ranges beyond the classic private set: "this" net,
// CGNAT, link-local (cloud metadata), IETF/TEST-NETs, benchmarking, multicast,
// class E, broadcast.
const RESERVED_IPV4 = [
  ["0.0.0.0", 8], ["100.64.0.0", 10], ["169.254.0.0", 16], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
];
function urlRisk(rawUrl) {
  const factors = []; let add = 0; let parsed;
  try { parsed = new URL(String(rawUrl)); } catch { return { valid: false, fetched: false, factors: ["URL is malformed"], add: 40 }; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    factors.push(`URL scheme '${parsed.protocol}' is not a web link (javascript:/data:/file:-class); never a legitimate payment/campaign target`); add += 60;
  } else if (parsed.protocol !== "https:") { factors.push("URL is not HTTPS; payment/campaign links must be https"); add += 45; }
  if (parsed.username || parsed.password) { factors.push("URL embeds credentials; classic phishing pattern"); add += 50; }
  const host = parsed.hostname;
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase(); // WHATWG keeps [] around IPv6 literals
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare);
  if (isIpv4 || bare.includes(":")) { factors.push("Host is a raw IP literal, not a domain"); add += 35; }
  if (/^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(bare)) {
    factors.push("Host is local/private, not a public service"); add += 45;
  } else if (isIpv4 && RESERVED_IPV4.some(([base, prefix]) => ipv4InCidr(bare, base, prefix))) {
    factors.push("Host is a reserved/special-use IPv4 address (link-local/CGNAT/test-net/multicast), not a public service"); add += 45;
  } else if (bare.includes(":") && (bare === "::1" || bare.startsWith("fc") || bare.startsWith("fd") || bare.startsWith("fe80:"))) {
    factors.push("Host is a local/private IPv6 address, not a public service"); add += 45;
  }
  if (host.split(".").some((l) => l.startsWith("xn--"))) { factors.push("Punycode hostname; possible homograph impersonation of a known brand"); add += 35; }
  if (parsed.port && parsed.port !== "443") { factors.push(`Non-standard port ${parsed.port}`); add += 15; }
  if (String(rawUrl).length > 2048) { factors.push("Unusually long URL"); add += 10; }
  return { valid: true, host, fetched: false, factors, add: Math.min(add, 90) };
}

// The registry dataURI is operator-controlled on-chain. Even over https it must
// not point the hosted engine at a local/reserved host (SSRF). String-only
// classification mirroring urlRisk; no DNS lookups. Returns false to refuse.
function isFetchableDataUri(u) {
  let p; try { p = new URL(String(u)); } catch { return false; }
  if (p.protocol !== "https:") return false;
  const bare = p.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(bare)) return false;
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare);
  if (isIpv4 && RESERVED_IPV4.some(([b, pfx]) => ipv4InCidr(bare, b, pfx))) return false;
  if (bare.includes(":") && (bare === "::1" || bare.startsWith("fc") || bare.startsWith("fd") || bare.startsWith("fe80:") || bare.startsWith("::ffff:"))) return false;
  return true;
}
// Bounded body reader: res.text() buffers the whole response first, so a hostile
// or misconfigured endpoint could exhaust memory. Cap the bytes we buffer.
async function readCapped(res, cap) {
  if (!res.body || typeof res.body.getReader !== "function") return (await res.text()).slice(0, cap);
  const reader = res.body.getReader(); let received = 0; const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > cap) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error("response exceeds size cap"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ── offline calldata decode (approval / transfer / admin / batch) ─────────
// Hand-ported from the TS analyzers (analysis/calldata.ts, approval.ts,
// safeTx.ts, recipientSafety.ts). Pure string inspection: no RPC, no fetch,
// no keys. ESCALATE-ONLY: callers apply the returned floor via
// score = Math.max(score, floor): a decode can hold or raise a verdict, never
// relax one; undecodable input is held, never treated as safe. The selector
// dictionary is NON-EXHAUSTIVE: absence of a warning is not proof of safety.
const DANGEROUS_ADMIN = {
  [SEL.transferOwnership]: ["transferOwnership", "transfers contract ownership"],
  [SEL.renounceOwnership]: ["renounceOwnership", "renounces contract ownership (irreversible)"],
  [SEL.upgradeTo]: ["upgradeTo", "upgrades the contract implementation (proxy)"],
  [SEL.upgradeToAndCall]: ["upgradeToAndCall", "upgrades the contract implementation and calls into it (proxy)"],
  [SEL.changeAdmin]: ["changeAdmin", "changes the proxy admin"],
};
// Operator-configurable recipient denylist (comma-separated 0x addresses).
// EMPTY by default: SafeHands ships NO fabricated scam list; operators point
// this at their own known-bad set. Parsed per call so tests can pin the env.
function recipientDenylist() {
  const raw = process.env.SAFEHANDS_RECIPIENT_DENYLIST || "";
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => ADDRESS_RE.test(s)));
}
function isDenylistedRecipient(addr) {
  return typeof addr === "string" && ADDRESS_RE.test(addr) && recipientDenylist().has(addr.toLowerCase());
}
// Counterparty recognition: canonical Pharos infrastructure (known-pharos.json)
// or the Permit2 singleton ONLY. The hosted assets ship no addresses for
// UNVERIFIED ecosystem protocols, so a recognition-only tier cannot occur here
// and nothing can wrongly relax risk. Never a hardcoded "known spender" map.
function classifyCounterparty(addr) {
  const lower = String(addr || "").toLowerCase();
  if (KNOWN_INFRA.has(lower)) return { known: true, label: CANON_CONTRACTS[lower] };
  if (lower === PERMIT2_ADDRESS) return { known: true, label: "Permit2" };
  return { known: false, label: null };
}
const wordAt = (body, i) => body.slice(i * 64, (i + 1) * 64);
// A calldata address word must be zero-padded to 12 bytes; dirty padding is
// malformed or deceptive calldata and decodes to null (invalid counterparty).
function wordToAddress(w) { return /^0{24}[0-9a-f]{40}$/.test(w) ? "0x" + w.slice(24) : null; }
// Shared approve-style floor matrix (approve/permit/permit2/increaseAllowance).
function applyApprovalFloor(c, methodLabel) {
  if (!c.spender) { c.floor = Math.max(c.floor, 90); c.factors.push(`${methodLabel} spender word is not a clean address: malformed or deceptive calldata`); return; }
  if (c.isRevoke) { c.notes.push(`${methodLabel} revokes/zeroes the allowance for ${c.spender}; no new exposure`); return; }
  if (c.unlimited && !c.counterpartyKnown) { c.floor = Math.max(c.floor, 90); c.factors.push(`UNLIMITED ${methodLabel} to an UNKNOWN spender (${c.spender}); the spender could move the entire current and future token balance`); return; }
  if (c.unlimited) { c.floor = Math.max(c.floor, 65); c.factors.push(`UNLIMITED ${methodLabel} to a known spender (${c.counterpartyLabel}); high risk, confirm intent`); return; }
  if (!c.counterpartyKnown) { c.floor = Math.max(c.floor, 45); c.factors.push(`${methodLabel} (amount ${c.amountRaw}) to an unknown spender (${c.spender}); confirm before approving`); return; }
  c.notes.push(`Limited ${methodLabel} to a known spender (${c.counterpartyLabel})`);
}
const MULTISEND_MAX_INNER = 64;
// multiSend(bytes transactions): head = offset word + length word, then the
// packed batch; per call: operation(1) | to(20) | value(32) | dataLen(32) | data.
function decodeMultiSendInner(body) {
  const offset = Number(BigInt("0x" + (wordAt(body, 0) || "0"))) * 2;
  const len = Number(BigInt("0x" + (body.slice(offset, offset + 64) || "0"))) * 2;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(len)) return null;
  const packed = body.slice(offset + 64, offset + 64 + len);
  if (packed.length !== len) return null;
  const calls = []; let i = 0; let overflow = false;
  while (i < packed.length) {
    if (calls.length >= MULTISEND_MAX_INNER) { overflow = true; break; }
    const operation = parseInt(packed.slice(i, i + 2), 16); i += 2;
    const to = "0x" + packed.slice(i, i + 40); i += 40;
    const value = BigInt("0x" + (packed.slice(i, i + 64) || "0")); i += 64;
    const dataLen = Number(BigInt("0x" + (packed.slice(i, i + 64) || "0"))) * 2; i += 64;
    if (!Number.isSafeInteger(dataLen) || i + dataLen > packed.length) return null;
    const data = "0x" + packed.slice(i, i + dataLen); i += dataLen;
    if (!Number.isInteger(operation) || !/^0x[0-9a-f]{40}$/.test(to)) return null;
    calls.push({ index: calls.length, operation, to, value: value.toString(), data });
  }
  return { calls, overflow };
}
function analyzeTxCalldata(data, to, depth = 0) {
  const hex = String(data || "").toLowerCase();
  const c = {
    decoded: false, method: null, selector: null, category: "unknown", token: to || null,
    spender: null, operator: null, recipient: null, from: null, amountRaw: null,
    unlimited: false, isRevoke: false, approved: null, counterpartyKnown: false,
    counterpartyLabel: null, recipientDenylisted: false, dangerous: false,
    factors: [], floor: 0, notes: [],
  };
  if (!HEXDATA_RE.test(hex) || hex.length < 10) return c;
  c.selector = hex.slice(0, 10);
  const body = hex.slice(10);
  const words = body.length / 64;
  const malformed = (method) => {
    c.method = method; c.floor = Math.max(c.floor, 45);
    c.factors.push(`Calldata matches ${method} but the payload is malformed; held for review, never treated as safe`);
    return c;
  };
  const classify = (addr) => { const k = classifyCounterparty(addr); c.counterpartyKnown = k.known; c.counterpartyLabel = k.label; };
  const sel = c.selector;
  if (sel === SEL.approve || sel === SEL.increaseAllowance) {
    const method = sel === SEL.approve ? "approve" : "increaseAllowance";
    if (words !== 2) return malformed(method);
    c.method = method; c.category = "approval"; c.decoded = true;
    c.spender = wordToAddress(wordAt(body, 0));
    const amount = BigInt("0x" + (wordAt(body, 1) || "0"));
    c.amountRaw = amount.toString(); c.unlimited = amount >= UNLIMITED_FLOOR; c.isRevoke = amount === 0n;
    if (c.spender) classify(c.spender);
    applyApprovalFloor(c, method);
    if (method === "increaseAllowance" && !c.isRevoke) c.notes.push("increaseAllowance raises an existing allowance on top of the current one");
  } else if (sel === SEL.permit) {
    if (words !== 7) return malformed("permit");
    c.method = "permit"; c.category = "approval"; c.decoded = true;
    c.spender = wordToAddress(wordAt(body, 1));
    const value = BigInt("0x" + (wordAt(body, 2) || "0"));
    c.amountRaw = value.toString(); c.unlimited = value >= UNLIMITED_FLOOR; c.isRevoke = value === 0n;
    if (c.spender) classify(c.spender);
    applyApprovalFloor(c, "permit");
    c.notes.push("ERC-2612 permit is a gasless, signature-based approval: the allowance is granted off-chain and can later authorize transfers");
  } else if (sel === SEL.permit2Approve) {
    if (words !== 4) return malformed("Permit2 approve");
    c.method = "permit2_approve"; c.category = "approval"; c.decoded = true;
    c.token = wordToAddress(wordAt(body, 0)) || c.token;
    c.spender = wordToAddress(wordAt(body, 1));
    const amount = BigInt("0x" + (wordAt(body, 2) || "0"));
    c.amountRaw = amount.toString(); c.unlimited = amount >= PERMIT2_MAX; c.isRevoke = amount === 0n;
    if (c.spender) classify(c.spender);
    applyApprovalFloor(c, "Permit2 approval");
    c.notes.push("Permit2 approval: authorizes the spender to move the token via Permit2 signatures; deep PermitSingle/PermitBatch decode is out of scope");
  } else if (sel === SEL.setApprovalForAll) {
    if (words !== 2) return malformed("setApprovalForAll");
    const approvedWord = BigInt("0x" + (wordAt(body, 1) || "0"));
    if (approvedWord > 1n) return malformed("setApprovalForAll");
    c.method = "setApprovalForAll"; c.category = "approval"; c.decoded = true;
    c.operator = wordToAddress(wordAt(body, 0)); c.approved = approvedWord === 1n;
    if (!c.operator) { c.floor = Math.max(c.floor, 90); c.factors.push("setApprovalForAll operator word is not a clean address: malformed or deceptive calldata"); }
    else {
      classify(c.operator);
      if (!c.approved) c.notes.push(`Revoking blanket operator approval for ${c.operator}; no new exposure`);
      else if (!c.counterpartyKnown) { c.floor = Math.max(c.floor, 90); c.factors.push(`Blanket collection approval (setApprovalForAll) to an UNKNOWN operator (${c.operator}); authorizes transfer of EVERY token in the collection, a common NFT-drainer vector`); }
      else { c.floor = Math.max(c.floor, 65); c.factors.push(`Blanket collection approval to a known operator (${c.counterpartyLabel}); high risk, confirm intent`); }
    }
  } else if (sel === SEL.transfer || sel === SEL.transferFrom) {
    const isFrom = sel === SEL.transferFrom;
    const method = isFrom ? "transferFrom" : "transfer";
    if (words !== (isFrom ? 3 : 2)) return malformed(method);
    c.method = method; c.category = "transfer"; c.decoded = true;
    if (isFrom) c.from = wordToAddress(wordAt(body, 0));
    c.recipient = wordToAddress(wordAt(body, isFrom ? 1 : 0));
    c.amountRaw = BigInt("0x" + (wordAt(body, isFrom ? 2 : 1) || "0")).toString();
    if (!c.recipient) { c.floor = Math.max(c.floor, 90); c.factors.push(`${method} recipient word is not a clean address: malformed or deceptive calldata`); }
    else if (isDenylistedRecipient(c.recipient)) { c.recipientDenylisted = true; c.floor = Math.max(c.floor, 95); c.factors.push(`${method} recipient ${c.recipient} is on the operator denylist (SAFEHANDS_RECIPIENT_DENYLIST); blocked`); }
    else { c.floor = Math.max(c.floor, 35); c.factors.push(`${method} moves tokens to ${c.recipient}; recipient is not verified; confirm before signing`); }
  } else if (sel === SEL.decreaseAllowance) {
    if (words !== 2) return malformed("decreaseAllowance");
    c.method = "decreaseAllowance"; c.category = "approval"; c.decoded = true;
    c.spender = wordToAddress(wordAt(body, 0));
    c.amountRaw = BigInt("0x" + (wordAt(body, 1) || "0")).toString();
    if (c.spender) { classify(c.spender); c.notes.push(`decreaseAllowance lowers the existing allowance for ${c.spender}; no new exposure`); }
    else { c.floor = Math.max(c.floor, 45); c.factors.push("decreaseAllowance spender word is not a clean address: malformed calldata, held for review"); }
  } else if (DANGEROUS_ADMIN[sel]) {
    const [method, label] = DANGEROUS_ADMIN[sel];
    const expectedWords = { transferOwnership: 1, renounceOwnership: 0, upgradeTo: 1, changeAdmin: 1 };
    if (method in expectedWords && words !== expectedWords[method]) return malformed(method);
    if (method === "upgradeToAndCall" && words < 3) return malformed(method);
    c.method = method; c.category = "admin"; c.decoded = true; c.dangerous = true;
    const target = words >= 1 ? wordToAddress(wordAt(body, 0)) : null;
    if (target) { c.spender = target; classify(target); }
    c.floor = Math.max(c.floor, 61);
    c.factors.push(`Dangerous/admin call: this transaction ${label}${target ? ` (target ${target})` : ""}; confirm this is intended`);
    c.notes.push("Recognized as a privileged/admin function; the dangerous-selector list is NOT exhaustive; absence of a warning is not proof of safety");
  } else if (sel === SEL.multiSend) {
    c.method = "multiSend"; c.category = "batch"; c.decoded = true;
    if (depth > 0) { c.floor = Math.max(c.floor, 45); c.factors.push("Nested MultiSend inside a batch; not decoded, held for review"); return c; }
    let inner;
    try { inner = decodeMultiSendInner(body); } catch { inner = null; }
    if (!inner) { c.floor = Math.max(c.floor, 45); c.factors.push("MultiSend batch bytes could not be parsed; held for review"); return c; }
    if (inner.overflow) { c.floor = Math.max(c.floor, 45); c.factors.push(`MultiSend batch exceeds ${MULTISEND_MAX_INNER} inner calls; oversized batch held for review`); }
    c.notes.push(`MultiSend batch with ${inner.calls.length} decoded inner call(s); the aggregate follows the highest-risk inner call`);
    for (const call of inner.calls) {
      if (call.operation === 1) { c.floor = Math.max(c.floor, 45); c.factors.push(`MultiSend inner #${call.index} uses delegatecall; elevated risk`); }
      if (call.data.length >= 10) {
        const ic = analyzeTxCalldata(call.data, call.to, depth + 1);
        c.floor = Math.max(c.floor, ic.floor);
        for (const f of ic.factors) c.factors.push(`MultiSend inner #${call.index}: ${f}`);
        c.recipientDenylisted = c.recipientDenylisted || ic.recipientDenylisted;
        c.unlimited = c.unlimited || ic.unlimited;
        c.dangerous = c.dangerous || ic.dangerous;
      } else if (call.data.length > 2) {
        c.floor = Math.max(c.floor, 45);
        c.factors.push(`MultiSend inner #${call.index} carries a truncated calldata payload; held for review`);
      } else if (BigInt(call.value) > 0n) {
        c.floor = Math.max(c.floor, 35);
        c.factors.push(`MultiSend inner #${call.index} moves native value to ${call.to}; recipient is not verified; confirm before signing`);
      }
    }
  } else if (sel === SEL.execTransaction) {
    c.method = "execTransaction"; c.category = "batch"; c.decoded = true;
    c.floor = Math.max(c.floor, 45);
    c.factors.push("Safe execTransaction recognized; nested call decode is not performed; verify the wrapped call independently before signing");
  } else {
    c.floor = Math.max(c.floor, 31);
    c.factors.push(`Calldata selector ${c.selector} is not a recognized method; held for review, confirm before signing`);
  }
  return c;
}
// Label-only summary for estimate_gas / simulate_transaction output (additive
// field; no scoring there; verdicts stay with analyze).
function calldataSummary(data, to) {
  if (typeof data !== "string" || !HEXDATA_RE.test(data) || data.length < 10) return null;
  const c = analyzeTxCalldata(data, typeof to === "string" && ADDRESS_RE.test(to) ? to.toLowerCase() : null);
  const out = {
    method: c.method, category: c.category, selector: c.selector, unlimited: c.unlimited,
    counterpartyKnown: c.counterpartyKnown, dangerous: c.dangerous,
    hints: [...c.factors, ...c.notes],
  };
  if (c.spender) out.spender = c.spender;
  if (c.operator) out.operator = c.operator;
  if (c.recipient) out.recipient = c.recipient;
  return out;
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

// Offline calldata decode (escalate-only floor) plus a read-only eth_call simulation and gas
// estimate for any fund-moving intent that carries a tx. Consolidated into ONE place so that
// no intent action can silently skip the calldata drainer check (the unlimited-approval and
// dangerous-selector detection). evidenceUsed / missingInputs are optional: transfer and swap
// use the compact report shape and pass neither. The decode floor may only RAISE the score
// (Math.max), never lower it.
async function evaluateCarriedTx(input, score, factors, parts, evidenceUsed, missingInputs, isUrlIntent, doSimulate) {
  if (input.to == null && input.data == null) {
    if (doSimulate && !isUrlIntent && missingInputs) missingInputs.push("tx object (from,to,data,value) for eth_call simulation and gas estimate");
    return score;
  }
  if (typeof input.data === "string" && HEXDATA_RE.test(input.data) && input.data.length >= 10) {
    const cd = analyzeTxCalldata(input.data, ADDRESS_RE.test(String(input.to || "")) ? String(input.to).toLowerCase() : null);
    parts.calldata = cd;
    if (evidenceUsed) evidenceUsed.push("offline calldata decode (approval/transfer/admin selectors; escalate-only)");
    if (cd.factors.length) factors.push(...cd.factors);
    score = Math.max(score, cd.floor);
  }
  // The offline decode above is the safety-critical, zero-RPC part and runs for every intent.
  // The read-only eth_call simulation + gas estimate below add RPC load, so they run only for
  // callers that opt in (RealFi intents). transfer/swap already probe tokenIn/tokenOut/recipient,
  // so they skip the extra round-trips and rely on the deterministic decode floor.
  if (!doSimulate) return score;
  const { tx, errs } = buildTxObject(input);
  if (errs.length) {
    factors.push(`Provided tx object is invalid: ${errs.join("; ")}`); score += 10;
  } else {
    try {
      const ret = await rpc("eth_call", [tx, "latest"]);
      parts.simulation = { reverted: false, returnData: ret };
      if (evidenceUsed) evidenceUsed.push("eth_call simulation against current chain state");
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (!/^RPC /.test(msg)) throw e;
      parts.simulation = { reverted: true, reason: sanitizeReason(msg) };
      factors.push("Simulation REVERTS against current chain state; the transaction would fail or is blocked");
      score += 35;
      if (evidenceUsed) evidenceUsed.push("eth_call simulation against current chain state");
    }
    try {
      const gasHex = await rpc("eth_estimateGas", [tx]);
      parts.gasEstimate = { estimatedGas: Number(decUint(gasHex)) };
      if (evidenceUsed) evidenceUsed.push("eth_estimateGas dry run");
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (!/^RPC /.test(msg)) throw e;
      parts.gasEstimate = { failed: true, reason: sanitizeReason(msg) };
    }
  }
  return score;
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
    score = composeComponent(score, parts.token, "Token", factors, 40);
  } else if (!isUrlIntent) {
    missingInputs.push("token (0x address); token legitimacy was not verified");
  }

  // target contract (router / vault / staking / market); fail closed when unknown
  const target = String(input.targetContract || input.bridgeContract || input.router || input.vault
    || input.stakingContract || input.market || input.contract || "");
  if (ADDRESS_RE.test(target)) {
    parts.target = await analyzeContract(target);
    evidenceUsed.push(`${targetLabel} contract analysis (code, canonical registry, GoPlus)`);
    // Role-correct recognition: a router/vault/market/staking target counts as
    // "known" ONLY if it is a canonical Pharos CONTRACT (or the Permit2 singleton),
    // never merely a canonical token address. Derived from the registry via
    // classifyCounterparty, not by parsing display-string factors.
    const canonicalTarget = classifyCounterparty(target).known;
    if (parts.target.onChain && parts.target.onChain.isContract === false) {
      factors.push(`Target ${targetLabel} has NO contract code on Pharos mainnet; nothing legitimate to interact with`);
      score = Math.max(score, 95);
    } else if (!canonicalTarget) {
      factors.push(`Target ${targetLabel} is not in the official Pharos canonical registry and its source is unverified; fail-closed: verify it independently before any ${action.replace(/_/g, " ")}`);
      // Fail-closed unverified-target floor AND never more permissive than the
      // target contract's own analysis.
      score = Math.max(score, isDeposit ? 45 : THREAT_INTEL_UNAVAILABLE_FLOOR, parts.target.riskScore);
    }
    const rep = await reputationOfTarget(target);
    if (rep) {
      parts.reputation = { ...rep, interpretation: rep.verifiedActionCount > 0 ? `${rep.verifiedActionCount} SafeHands-verified action(s) on record.` : "No verified actions on record; neutral, not an adverse signal." };
      evidenceUsed.push("SafeHands attestation reputation (reputationOf)");
    }
  } else if (!isUrlIntent) {
    missingInputs.push(`${INTENT_TARGET_KEY[action] || "targetContract"} (0x address of the ${targetLabel} contract)`);
    factors.push(`No ${targetLabel} contract address provided; the contract this intent would call is unverified`);
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
        if (state === "unlimited") { factors.push("Owner already granted an UNLIMITED approval to this spender; existing exposure is the entire token balance"); score += 20; }
      } catch { parts.allowance = { owner, spender, error: "allowance read failed; token may not expose ERC-20 allowance()" }; }
    } else {
      missingInputs.push("owner + spender + token for the allowance-exposure check");
    }
  }

  // offline calldata decode + read-only simulation + gas estimate (shared with transfer/swap)
  score = await evaluateCarriedTx(input, score, factors, parts, evidenceUsed, missingInputs, isUrlIntent, true);

  // native-amount sanity vs acting wallet
  if (input.amount != null && wallet && !ADDRESS_RE.test(token)) {
    const wei = prosToWei(input.amount);
    if (wei == null) factors.push("'amount' is not a well-formed decimal string; ignored");
    else if (wei > wallet.balance) { factors.push("Amount exceeds the acting wallet's PROS balance"); score += 25; }
  }

  // URL-centric intents: static link checks + recipient analysis, never a fetch
  if (isUrlIntent) {
    const url = String(input.url || input.link || "");
    if (!url) {
      missingInputs.push("url (the payment/campaign link)");
      factors.push("No URL provided; link safety was not verified");
      score = Math.max(score, 35);
    } else {
      parts.url = urlRisk(url);
      evidenceUsed.push("static URL risk analysis (string inspection only; the hosted engine never fetches arbitrary URLs)");
      if (parts.url.factors.length) { factors.push(...parts.url.factors); score += parts.url.add; }
    }
    const payTo = String(input.payTo || input.recipient || "");
    if (ADDRESS_RE.test(payTo)) {
      parts.payTo = await analyzeWallet(payTo, { expect: "any" });
      evidenceUsed.push("payTo address analysis (on-chain + GoPlus)");
      score = composeComponent(score, parts.payTo, "payTo", factors, 35);
      if (isDenylistedRecipient(payTo)) { factors.push(`payTo ${payTo} is on the operator denylist (SAFEHANDS_RECIPIENT_DENYLIST); blocked`); score = Math.max(score, 95); }
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
        note: "No vault-status provider configured; these fields are unavailable, not zero, and are never invented.",
      };
    }
  }

  const intentNotes = [];
  if (action === "bridge") intentNotes.push("SafeHands never bridges. This is a pre-signature check of token, router, approvals, and calldata only.");
  if (action === "staking") intentNotes.push("SafeHands never stakes. This is a pre-signature check of the staking contract, token, approvals, and calldata only.");
  if (action === "vault_deposit" || action === "yield_deposit") intentNotes.push("This score rates deposit-interaction risk (contract, token, approvals, simulation), NOT yield quality or APY.");
  if (action === "tokenized_asset") intentNotes.push("On-chain surface, registry, and GoPlus checks only; offering documents and real-world asset backing are NOT verifiable from the hosted engine.");
  if (action === "fiat_ramp") intentNotes.push("SafeHands does not process or approve fiat on/off-ramp payments and cannot attest the operator's legitimacy; this is link and address risk only.");
  if (action === "reward_campaign") intentNotes.push("SafeHands cannot confirm a campaign or reward is legitimate; absence of adverse signals is not an endorsement.");
  if (action === "x402_payment") intentNotes.push("The x402 fetch/payment is NOT executed; static URL, recipient, token, and amount checks only.");

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
    score = composeComponent(score, rec, "Recipient", factors, 35);
    if (isDenylistedRecipient(input.toAddress)) { factors.push(`Recipient ${input.toAddress} is on the operator denylist (SAFEHANDS_RECIPIENT_DENYLIST); blocked`); score = Math.max(score, 95); }
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
      score = composeComponent(score, r, label, factors, 40);
    }
  }
  if (wallet.nonce === 0) { factors.push("Acting wallet has zero transaction history"); score += 10; }
  // Same offline calldata decode + read-only simulation as RealFi intents, so a swap or transfer
  // that carries approval / transfer / admin calldata gets the unlimited-approval and drainer
  // floor too. Escalate-only: this can only raise the verdict, never soften it.
  score = await evaluateCarriedTx(input, score, factors, parts, undefined, undefined, false, false);
  const rep = report(score, factors, { type: "intent", action, walletAddress: input.walletAddress });
  rep.components = parts;
  return rep;
}

async function cmdAnalyze(raw) {
  let input; try { input = JSON.parse(raw); } catch { return fail("VALIDATION_ERROR", "analyze expects a JSON argument."); }
  // 'data' (calldata) legitimately contains 64-hex words; it is exempt from the
  // 64-hex heuristic only; the secret-keyword check still covers the full input.
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

// Normalize a committed risk record into the query response shape. A missing or
// unparseable score becomes null (unknown), NEVER a fabricated 0 that would read
// as a permissive "allow". level/recommendation accept either the numeric enum
// index (as flushed) or an already-decoded string.
function normalizeBatchRecord(r) {
  const rec = r || {};
  const rawScore = String(rec.score ?? rec.riskScore ?? "").replace(/n$/, "");
  const scoreNum = rawScore !== "" && Number.isFinite(Number(rawScore)) ? Number(rawScore) : null;
  const exp = rec.expiresAt != null ? String(rec.expiresAt).replace(/n$/, "") : null;
  // Decode a numeric enum index (as flushed) or pass through an already-decoded
  // string. A MISSING value is null (unknown), never index 0, which would
  // fail open to the most permissive enum ("low"/"allow").
  const decodeEnum = (arr, v) => {
    if (v == null) return null;
    let s = String(v).trim();
    if (/^\d+n$/.test(s)) s = s.slice(0, -1); // BigInt-serialized numeric enum ("1n"), not a word like "warn"
    if (s === "") return null;
    if (/^\d+$/.test(s)) return arr[Number(s)] ?? null;
    return s;
  };
  return {
    target: rec.target ?? null, actionHash: rec.actionHash ?? null, riskScore: scoreNum,
    riskLevel: decodeEnum(LEVELS, rec.level),
    recommendation: decodeEnum(RECS, rec.recommendation),
    expiresAt: exp, expired: exp && Number.isFinite(Number(exp)) ? Number(exp) * 1000 < Date.now() : null,
  };
}

async function cmdQuery(subject) {
  if (!ADDRESS_RE.test(String(subject || ""))) return fail("VALIDATION_ERROR", "query expects a valid 0x EVM address argument.");
  const out = { success: true, subject, registry: { configured: false }, reputation: { configured: false }, records: [], recordsSource: null, network: "pacific-mainnet", chainId: CHAIN_ID, timestamp: new Date().toISOString() };
  if (ADDRESS_RE.test(REGISTRY_ADDR)) {
    // Sequential reads on purpose: the public Pharos RPC rate-limits parallel
    // eth_call bursts (same reason get_token_price reads sequentially). Each
    // read retries once so a single transient limit hit does not fail the query.
    const readRegistry = async (data) => {
      try { return await ethCall(REGISTRY_ADDR, data); }
      catch { return await ethCall(REGISTRY_ADDR, data); }
    };
    const root = await readRegistry(SEL.currentMerkleRoot);
    const uriHex = await readRegistry(SEL.currentDataURI);
    const agentHex = await readRegistry(SEL.isAuthorizedAgent + encAddr(subject));
    const dataURI = decString(uriHex);
    out.registry = {
      configured: true, contractAddress: REGISTRY_ADDR, currentMerkleRoot: root,
      hasCommittedRoot: /^0x[0-9a-fA-F]{64}$/.test(String(root)) && !/^0x0{64}$/.test(String(root)), currentDataURI: dataURI,
      isAuthorizedAgent: decUint(agentHex) === 1n,
      explorer: `${EXPLORER}/address/${REGISTRY_ADDR}`,
    };
    // Records are read from the committed data-availability pointer but are NOT
    // cryptographically proven against currentMerkleRoot by the hosted engine.
    out.recordsVerifiedAgainstRoot = false;
    if (dataURI && /^https:\/\//.test(dataURI) && isFetchableDataUri(dataURI)) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(dataURI, { signal: ctl.signal, redirect: "manual" }); clearTimeout(t);
        if (res.status >= 300 && res.status < 400) throw new Error("dataURI redirected; refusing to follow to an unverified host");
        const text = await readCapped(res, 2_000_000);
        const batch = JSON.parse(text);
        // The committed batch is a bare array of records (matches scripts/flushBatchToMainnet.ts
        // and the canonical src reader normalizeRiskRecords, which requires Array.isArray). A
        // { records: [...] } wrapper is tolerated too so either shape reads correctly.
        const batchRecords = Array.isArray(batch) ? batch : (Array.isArray(batch.records) ? batch.records : []);
        const recs = batchRecords.filter((r) => r && String(r.target || "").toLowerCase() === subject.toLowerCase());
        out.records = recs.map(normalizeBatchRecord);
        out.recordsSource = "dataURI";
        out.recordsNote = "Records come from the on-chain-committed data-availability pointer (currentDataURI); the hosted engine does NOT verify them against currentMerkleRoot. Treat as advisory. Use verify_risk_inclusion (full SafeHands backend) for an authoritative on-chain inclusion proof.";
      } catch { out.recordsSource = "dataURI-unreachable"; }
    } else if (dataURI && /^https:\/\//.test(dataURI)) {
      // https but the host is local/reserved/IP-literal: refused, never fetched (SSRF guard).
      out.recordsSource = "dataURI-host-not-public";
    } else if (dataURI) {
      // Any non-https scheme (http, ipfs, file, ...) is reported, never fetched.
      out.recordsSource = "dataURI-scheme-not-fetchable";
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
        : "No verified actions recorded; neutral, not necessarily unsafe.";
    } catch { out.reputation = { configured: true, contractAddress: ATTEST_ADDR, error: "reputation read failed" }; }
  }
  if (!out.registry.configured && !out.reputation.configured) {
    out.note = "SafeHands contract addresses are not configured in assets/contracts.json; on-chain record/reputation queries unavailable; analysis features are unaffected.";
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
  const feedDecimalsRaw = decHex ? Number(decUint(decHex)) : FEED_DECIMALS_DEFAULT;
  if (!Number.isInteger(feedDecimalsRaw) || feedDecimalsRaw < 0 || feedDecimalsRaw > 36) {
    return fail("PROVIDER_UNAVAILABLE", "Chainlink feed reported an implausible decimals() value; refusing to quote a price.", {
      ...base, provider: "chainlink-push", feedDecimalsRaw: String(feedDecimalsRaw),
      safeFallback: "Do not guess a price; report the feed as unavailable.",
    });
  }
  const feedDecimals = feedDecimalsRaw;
  if (answer <= 0n) {
    return fail("PROVIDER_UNAVAILABLE", "Feed answered a non-positive value; treating the feed as unavailable.", {
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
    // labeled; it must never be presented as a current price.
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
  const approvalRisk = allowance === 0n ? "none" : allowance >= UNLIMITED_FLOOR ? "unlimited" : "scoped";
  const approvalRiskHint = approvalRisk === "unlimited"
    ? "UNLIMITED approval: the spender can move the owner's entire current and future balance of this token. High risk; revoke or scope it unless the spender is fully trusted."
    : approvalRisk === "scoped"
      ? "Finite approval: exposure is capped at the approved amount. Verify the spender before increasing it."
      : "No approval: the spender cannot move this token for this owner.";
  return {
    success: true, command: "check_allowance",
    token: j.token, owner: j.owner, spender: j.spender,
    tokenSymbol: t.symbol ?? null, tokenDecimals: t.decimals ?? null,
    allowanceRaw: allowance.toString(),
    allowanceFormatted: (Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 100) ? formatUnits(allowance, t.decimals) : null,
    approvalRisk, approvalRiskHint,
    readOnly: "reads allowance(owner,spender) only; this command never grants, changes, or revokes an approval",
    chainId: CHAIN_ID, timestamp: new Date().toISOString(),
  };
}

// get_token_balance: read-only balance lookup. Native PROS via eth_getBalance;
// ERC-20 via balanceOf eth_call. Token may be a 0x address, a bundled canonical
// symbol, or "PROS"/"pharos" for native; any other name fails closed (use
// resolve_alias). A balanceOf call that returns no data reports the balance as
// UNKNOWN, never as zero: zero is a real balance, absence of data is not.
async function cmdTokenBalance(raw) {
  const j = parseJsonArg(raw);
  if (!j) return fail("VALIDATION_ERROR", "get_token_balance expects JSON: {\"address\":…, \"token\":…} (token = 0x address, bundled symbol, or \"PROS\" for native; omit for native).");
  const keyErr = rejectKeyLike(j); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const cg = chainGuard(j); if (cg) return cg;
  const address = String(j.address || j.wallet || "").toLowerCase();
  if (!ADDRESS_RE.test(address)) return fail("VALIDATION_ERROR", "'address' must be a valid 0x EVM address.");
  const tokenRaw = String(j.token == null ? "PROS" : j.token).trim();
  const norm = tokenRaw.toLowerCase();

  if (norm === "" || norm === "pros" || norm === "pharos") {
    const balHex = await rpc("eth_getBalance", [address, "latest"]);
    const bal = decUint(balHex);
    return {
      success: true, command: "get_token_balance", address, token: "native", tokenSymbol: "PROS", tokenDecimals: 18,
      balanceRaw: bal.toString(), balanceFormatted: formatUnits(bal, 18),
      readOnly: "reads eth_getBalance only; this command never moves, approves, or exposes funds",
      chainId: CHAIN_ID, timestamp: new Date().toISOString(),
    };
  }

  let tokenAddr = null; let resolvedSymbol = null;
  if (ADDRESS_RE.test(norm)) tokenAddr = norm;
  else {
    const sym = Object.keys(CANON_TOKENS).find((s) => s.toLowerCase() === norm);
    if (sym) { tokenAddr = CANON_TOKENS[sym]; resolvedSymbol = sym; }
  }
  if (!tokenAddr) {
    return fail("UNKNOWN_ALIAS", `'${tokenRaw}' is not a bundled canonical token symbol on Pharos Pacific Mainnet. Provide the token contract address, or resolve the name first with resolve_alias; this command never guesses a token address.`);
  }

  const [balHex, t] = await Promise.all([
    ethCall(tokenAddr, SEL.balanceOf + encAddr(address)).catch(() => null),
    erc20Probe(tokenAddr),
  ]);
  if (!balHex || balHex === "0x") {
    return fail("TOKEN_READ_FAILED", `balanceOf(${address}) returned no data from ${tokenAddr}; the address may not be an ERC-20 token contract on chainId ${CHAIN_ID}. The balance is UNKNOWN, not zero.`, { token: tokenAddr });
  }
  const bal = decUint(balHex);
  const cleanDecimals = Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 100 ? t.decimals : null;
  return {
    success: true, command: "get_token_balance", address, token: tokenAddr,
    tokenSymbol: resolvedSymbol ?? t.symbol ?? null, tokenDecimals: cleanDecimals,
    balanceRaw: bal.toString(),
    balanceFormatted: cleanDecimals == null ? null : formatUnits(bal, cleanDecimals),
    readOnly: "reads balanceOf(address) only; this command never moves, approves, or exposes funds",
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
  const cd = calldataSummary(j.data, j.to);
  try {
    const hex = await rpc("eth_estimateGas", [tx]);
    return {
      success: true, command: "estimate_gas",
      estimatedGas: Number(decUint(hex)), estimatedGasHex: hex,
      ...(cd ? { calldata: cd } : {}),
      broadcast: false, note: "eth_estimateGas is a node-side dry run; nothing was signed or broadcast",
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
  const cd = calldataSummary(j.data, j.to);
  try {
    const ret = await rpc("eth_call", [tx, "latest"]);
    return {
      success: true, command: "simulate_transaction", reverted: false, returnData: ret,
      ...(cd ? { calldata: cd } : {}),
      broadcast: false, note: "eth_call simulation only; nothing was signed or broadcast",
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
// command reports *_NOT_CONFIGURED; it never invents provider data.
function providerEndpoint(name) {
  const p = PROVIDERS[name] || {};
  const ep = typeof p.endpoint === "string" && /^https:\/\//.test(p.endpoint) ? p.endpoint : null;
  return { endpoint: ep, config: p };
}
function providerNotConfigured(command, provider, code) {
  return fail(code, `No ${provider} endpoint is configured in assets/supported-protocols.json.`, {
    command, provider, providerStatus: "not_configured",
    reason: "endpoint is null; only verified public keyless endpoints may be configured",
    safeFallback: "Report this data as unavailable. Do not scrape, guess, or invent results.",
  });
}
const SECRETISH_FIELDS = ["headers", "authorization", "apiKey", "api_key", "token", "cookie", "passKey", "pass_key", "bearer"];
function rejectSecretFields(j) {
  for (const f of SECRETISH_FIELDS) if (j[f] != null) return `'${f}' is not accepted; provider calls are keyless and header-free by policy`;
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
    return JSON.parse(await readCapped(res, 1_500_000));
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
      note: "Pool/route data is liquidity context only, NEVER a canonical price. Use get_token_price (Chainlink Push) for pricing.",
      chainId: CHAIN_ID, timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return fail("PROVIDER_UNAVAILABLE", sanitizeReason((e && e.message) || e), {
      command: "get_pool_info", provider: "pool-info provider", endpoint,
      safeFallback: "Report pool data as unavailable; do not invent liquidity, routes, or prices.",
    });
  }
}

// ── resolve_alias ─────────────────────────────────────────────────────────
// Registry-only alias resolution: names and symbols resolve to addresses ONLY
// from the bundled registry-derived assets (canonical tokens, canonical
// contracts, protocol names/aliases). Matching is exact after normalization;
// never fuzzy, never substring, never an external lookup. Unknown aliases fail
// closed with UNKNOWN_ALIAS. Non-ASCII input is rejected outright: homoglyph
// lookalikes (for example a Cyrillic C in "USDC") must never resolve.
function resolveAliasCore(rawQuery) {
  const original = String(rawQuery == null ? "" : rawQuery);
  if (!original.trim()) return { error: { code: "VALIDATION_ERROR", message: "resolve_alias needs a token symbol, protocol name, or 0x address to resolve." } };
  if (/[^\x20-\x7e]/.test(original)) {
    return { error: { code: "ALIAS_CHARSET_REJECTED", message: "The alias contains non-ASCII characters. Lookalike characters are a known spoofing trick, so this engine only resolves plain-ASCII aliases; retype the name or provide the 0x address directly." } };
  }
  const normalized = original.trim().replace(/\s+/g, " ").toLowerCase();

  // A 0x address passes through with recognition info instead of alias search.
  if (ADDRESS_RE.test(normalized)) {
    const k = classifyCounterparty(normalized);
    const tokenSymbol = Object.keys(CANON_TOKENS).find((sym) => CANON_TOKENS[sym] === normalized) || null;
    return {
      matches: [{ kind: "address", address: normalized, recognized: k.known || Boolean(tokenSymbol), label: k.label || tokenSymbol, tokenSymbol }],
      normalized,
    };
  }

  const matches = [];

  if (normalized === "pros" || normalized === "pharos") {
    matches.push({ kind: "native", symbol: "PROS", note: "Native PROS on Pharos Pacific Mainnet (chainId 1672); a native transfer has no token contract address." });
  }

  for (const sym of Object.keys(CANON_TOKENS)) {
    if (sym.toLowerCase() === normalized) {
      matches.push({ kind: "token", symbol: sym, address: CANON_TOKENS[sym], verification: "canonical", source: "official Pharos token registry (bundled)" });
    }
  }

  for (const addr of Object.keys(CANON_CONTRACTS)) {
    if (String(CANON_CONTRACTS[addr]).toLowerCase() === normalized) {
      matches.push({ kind: "contract", label: CANON_CONTRACTS[addr], address: addr, verification: "verified", source: "registry-verified canonical contract (bundled)" });
    }
  }

  const protocolEntries = (PROTOCOLS_CFG && PROTOCOLS_CFG.protocols) || {};
  for (const key of Object.keys(protocolEntries)) {
    const p = protocolEntries[key] || {};
    const names = [key, String(p.name || "").toLowerCase()].concat((Array.isArray(p.aliases) ? p.aliases : []).map((a) => String(a).toLowerCase()));
    if (!names.includes(normalized)) continue;
    const verified = p.verificationStatus === "verified";
    matches.push({
      kind: "protocol",
      protocol: key,
      name: p.name || key,
      verificationStatus: p.verificationStatus || "unverified",
      contracts: verified && p.contracts ? p.contracts : null,
      guidance: verified
        ? "Verified from first-party evidence; the listed addresses are the canonical ones. Verification relaxes recognition only, it does not pre-approve any action."
        : "Recognized in the Pharos ecosystem but NOT verified: no first-party contract addresses are bundled. Do not trust addresses for this protocol from ecosystem listings, search results, or chat; ask the protocol's own docs or wait for registry verification.",
    });
  }

  return { matches, normalized };
}

// Multiple matches are AMBIGUOUS only when they point at different identities.
// A protocol plus contract labels that all belong to that same protocol (for
// example "morpho blue" matching both the Morpho protocol alias and its own
// bundled "Morpho Blue" contract) is ONE identity: complementary, not a
// conflict, so the caller is not forced into a needless disambiguation question.
function resolvedMatchesConflict(matches) {
  if (matches.length <= 1) return false;
  const protocols = matches.filter((m) => m.kind === "protocol");
  const contracts = matches.filter((m) => m.kind === "contract");
  if (protocols.length !== 1 || protocols.length + contracts.length !== matches.length) return true;
  const owned = new Set(Object.keys(protocols[0].contracts || {}));
  return !contracts.every((c) => owned.has(c.address));
}

async function cmdResolveAlias(raw) {
  const j = parseJsonArg(raw);
  const query = j && typeof j === "object" ? j.alias ?? j.query ?? j.name ?? "" : raw;
  const keyErr = rejectKeyLike({ query }); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
  const r = resolveAliasCore(query);
  if (r.error) return fail(r.error.code, r.error.message);
  if (r.matches.length === 0) {
    return fail("UNKNOWN_ALIAS", `"${r.normalized}" does not match any bundled token symbol, canonical contract, or registered protocol on Pharos Pacific Mainnet. This engine never guesses: provide the exact 0x address, or treat the name as unrecognized and unverified.`, {
      normalized: r.normalized,
      rule: "Aliases resolve only from the bundled registry; an unknown alias is a signal to stop, not to search elsewhere.",
    });
  }
  return {
    success: true,
    command: "resolve_alias",
    query: String(query),
    normalized: r.normalized,
    ambiguous: resolvedMatchesConflict(r.matches),
    matches: r.matches,
    rule: "Exact-match, registry-only resolution. If ambiguous is true, ask the user which match they meant or require an explicit 0x address; never pick silently.",
    chainId: CHAIN_ID,
    timestamp: new Date().toISOString(),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────
function dispatch(cmd, arg) {
  return cmd === "health" ? cmdHealth()
    : cmd === "analyze" ? cmdAnalyze(arg ?? "")
    : cmd === "query" ? cmdQuery(arg ?? "")
    : cmd === "get_gas_price" ? cmdGasPrice()
    : cmd === "get_token_price" ? cmdTokenPrice(arg ?? "")
    : cmd === "check_allowance" ? cmdCheckAllowance(arg ?? "")
    : cmd === "get_token_balance" ? cmdTokenBalance(arg ?? "")
    : cmd === "get_transaction_status" ? cmdTxStatus(arg ?? "")
    : cmd === "estimate_gas" ? cmdEstimateGas(arg ?? "")
    : cmd === "simulate_transaction" ? cmdSimulateTransaction(arg ?? "")
    : cmd === "get_spv_proof" ? cmdSpvProof(arg ?? "")
    : cmd === "query_goldsky_subgraph" ? cmdGoldsky(arg ?? "")
    : cmd === "get_execution_history" ? cmdExecutionHistory(arg ?? "")
    : cmd === "get_pool_info" ? cmdPoolInfo(arg ?? "")
    : cmd === "resolve_alias" ? cmdResolveAlias(arg ?? "")
    : Promise.resolve(fail("USAGE", "usage: safehands-engine.js <health|analyze|query|resolve_alias|get_gas_price|get_token_price|get_token_balance|check_allowance|get_transaction_status|estimate_gas|simulate_transaction|get_spv_proof|query_goldsky_subgraph|get_execution_history|get_pool_info> ['<json-or-arg>']"));
}

// Run the CLI ONLY when executed directly (node safehands-engine.js <cmd>), not
// when imported by a test. realpath both sides so symlinked launches (npx) still
// match; default to running if the check is inconclusive, so CLI behavior is
// never accidentally suppressed.
function invokedDirectly() {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch { return true; }
}
if (invokedDirectly()) {
  const [cmd, arg] = process.argv.slice(2);
  dispatch(cmd, arg)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.success ? 0 : 1); })
    .catch((e) => {
      const msg = String(e && e.message || e);
      const code = e && e.safehandsCode ? e.safehandsCode
        : /abort/i.test(msg) ? "RPC_TIMEOUT" : /HTTP|fetch|network/i.test(msg) ? "PHAROS_RPC_UNAVAILABLE" : "ENGINE_ERROR";
      const retryable = code === "RPC_TIMEOUT" || code === "PHAROS_RPC_UNAVAILABLE";
      console.log(JSON.stringify(fail(code, msg, { retryable }), null, 2)); process.exit(1);
    });
}

// Exported for unit tests (import does not trigger the CLI above). These are the
// pure decision/normalization helpers whose behavior the audit locks.
export { composeComponent, sanitizeOnchainString, isFetchableDataUri, formatUnits, normalizeBatchRecord, scoreToRec, scoreToLevel, resolveAliasCore, slotToAddress };
