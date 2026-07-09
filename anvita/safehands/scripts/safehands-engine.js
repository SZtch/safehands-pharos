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
  try { return JSON.parse(readFileSync(path.join(HERE, "..", "assets", "safehands", rel), "utf8")); }
  catch { return null; }
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

const CMAP = CONTRACTS.contracts || CONTRACTS; // supports both {contracts:{...}} and flat shapes
const REGISTRY_ADDR = process.env.SAFEHANDS_REGISTRY_ADDRESS
  || (CMAP.SafeHandsRegistry && CMAP.SafeHandsRegistry.address) || "";
const ATTEST_ADDR = process.env.SAFEHANDS_ATTESTATION_ADDRESS
  || (CMAP.SafeHandsAttestation && CMAP.SafeHandsAttestation.address) || "";

// ── precomputed keccak-256 selectors (verified against standard vectors) ─
const SEL = {
  name: "0x06fdde03", symbol: "0x95d89b41", decimals: "0x313ce567", totalSupply: "0x18160ddd",
  currentMerkleRoot: "0x9ea97190", currentDataURI: "0x59e99f26",
  isAuthorizedAgent: "0x6bf722ab", isAuthorizedOperator: "0x82d52c1e",
  reputationOf: "0xdb89c044",
};

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
function rejectKeyLike(obj) {
  const s = JSON.stringify(obj || {});
  if (/private[_-]?key|mnemonic|seed[_-]?phrase/i.test(s)) return "input contains key-like material — this engine never handles secrets";
  if (/0x[0-9a-fA-F]{64}/.test(s)) return "input contains a 64-hex value; if that is a private key, never share it (tx-hash analysis is not supported fully-hosted)";
  return null;
}
async function rpc(method, params = [], timeoutMs = 15000) {
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
        signal: ctl.signal, headers: { accept: "application/json", "user-agent": "SafeHands/2.3.0" },
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

async function analyzeIntent(input) {
  const action = String(input.action || "");
  if (!["transfer", "swap"].includes(action)) return fail("VALIDATION_ERROR", "intent 'action' must be 'transfer' or 'swap'.");
  if (!ADDRESS_RE.test(String(input.walletAddress || ""))) return fail("VALIDATION_ERROR", "intent analysis requires a valid 'walletAddress' (the acting wallet).");
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
  const keyErr = rejectKeyLike(input); if (keyErr) return fail("KEY_MATERIAL_REJECTED", keyErr);
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
    out.note = "SafeHands contract addresses are not configured in assets/safehands/contracts.json — on-chain record/reputation queries unavailable; analysis features are unaffected.";
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────
const [cmd, arg] = process.argv.slice(2);
const run = cmd === "health" ? cmdHealth()
  : cmd === "analyze" ? cmdAnalyze(arg ?? "")
  : cmd === "query" ? cmdQuery(arg ?? "")
  : Promise.resolve(fail("USAGE", "usage: safehands-engine.js <health|analyze|query> ['<json-or-address>']"));
run.then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.success ? 0 : 1); })
   .catch((e) => {
     const msg = String(e && e.message || e);
     const code = /abort/i.test(msg) ? "RPC_TIMEOUT" : /HTTP|fetch|network/i.test(msg) ? "PHAROS_RPC_UNAVAILABLE" : "ENGINE_ERROR";
     console.log(JSON.stringify(fail(code, msg, { retryable: code !== "ENGINE_ERROR" }), null, 2)); process.exit(1);
   });
