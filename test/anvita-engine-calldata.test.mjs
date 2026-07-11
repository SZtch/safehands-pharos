// ─── Anvita hosted engine — offline calldata decode (v2.4.0 parity port) ──
// Drives the real CLI artifact against a MOCK Pharos RPC + MOCK GoPlus, like
// anvita-engine.test.mjs. Covers the hand-ported approval/transfer/admin/batch
// decode: unlimited-approval detection, operator denylist, dangerous-admin
// recognition, MultiSend aggregation, and the escalate-only floor semantics.
// Every test pins SAFEHANDS_RECIPIENT_DENYLIST in the child env (CI exports
// job-wide env vars — see the CLAUDE.md CI-leak note).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENGINE = fileURLToPath(new URL("../anvita/safehands/scripts/safehands-engine.js", import.meta.url));
const KNOWN = JSON.parse(readFileSync(new URL("../anvita/safehands/assets/known-pharos.json", import.meta.url), "utf8"));
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
// A canonical Pharos contract (non-Permit2) straight from the shipped asset, so
// the "known spender" tier is exercised against real registry-generated data.
const CANON = Object.keys(KNOWN.canonicalContracts).find((a) => a !== PERMIT2);
const CANON_LABEL = KNOWN.canonicalContracts[CANON];

const WALLET = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const UNKNOWN_SPENDER = "0x4444444444444444444444444444444444444444";
const RECIPIENT = "0x5555555555555555555555555555555555555555";

// ── calldata builders (raw ABI words; no 0x inside packed segments) ───────
const W = (h) => String(h).replace(/^0x/, "").padStart(64, "0");
const addrW = (a) => W(a.toLowerCase().slice(2));
const MAX_UINT256 = "f".repeat(64); // 2^256-1 >= 2^255 → unlimited
const approveData = (spender, amountW) => "0x095ea7b3" + addrW(spender) + amountW;
const transferData = (to, amountW) => "0xa9059cbb" + addrW(to) + amountW;
const setApprovalForAllData = (op, approved) => "0xa22cb465" + addrW(op) + W(approved ? "1" : "0");
const transferOwnershipData = (newOwner) => "0xf2fde38b" + addrW(newOwner);
const permitData = (owner, spender, valueW) =>
  "0xd505accf" + addrW(owner) + addrW(spender) + valueW + W("ffffffff") + W("1b") + "ab".repeat(32) + "cd".repeat(32);
const permit2ApproveData = (token, spender) =>
  "0x87517c45" + addrW(token) + addrW(spender) + W("f".repeat(40)) + W("0"); // uint160 max → unlimited
const msInner = (op, to, dataHex) =>
  op + to.toLowerCase().slice(2) + W("0") + W((dataHex.length / 2).toString(16)) + dataHex;
const multiSendData = (...inners) => {
  const packed = inners.join("");
  return "0x8d80ff0a" + W("20") + W((packed.length / 2).toString(16)) + packed;
};

// ── slim mock: Pharos JSON-RPC (POST) + GoPlus (GET) on one port ──────────
const SEL_READ = {
  symbol: "0x95d89b41", name: "0x06fdde03", decimals: "0x313ce567",
  totalSupply: "0x18160ddd", reputationOf: "0xdb89c044",
};
const CODE = "0x" + "60".repeat(120);
const encUint = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
function encString(s) {
  const b = Buffer.from(s, "utf8");
  const data = b.length ? b.toString("hex").padEnd(Math.ceil(b.length / 32) * 64, "0") : "";
  return "0x" + W("20") + W(b.length.toString(16)) + data;
}
function startMock() {
  const methodsCalled = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { id, method, params } = JSON.parse(body || "{}");
        methodsCalled.push(method);
        let result = "0x";
        if (method === "eth_getBalance") result = "0x0";
        else if (method === "eth_getTransactionCount") result = "0x1";
        else if (method === "eth_getCode") result = CODE;
        else if (method === "eth_chainId") result = "0x688"; // 1672
        else if (method === "eth_blockNumber") result = "0x100";
        else if (method === "eth_estimateGas") result = "0x6f36";
        else if (method === "eth_call") {
          const data = params?.[0]?.data ?? "";
          if (data.startsWith(SEL_READ.symbol)) result = encString("GOOD");
          else if (data.startsWith(SEL_READ.name)) result = encString("Mock Token");
          else if (data.startsWith(SEL_READ.decimals)) result = encUint(18);
          else if (data.startsWith(SEL_READ.totalSupply)) result = encUint(10n ** 24n);
          else if (data.startsWith(SEL_READ.reputationOf)) result = encUint(0);
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      });
      return;
    }
    // GET → GoPlus: answers with an empty-but-valid result (reachable, no flags)
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ code: 1, result: {} }));
  });
  server.listen(0);
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), methodsCalled };
}
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
// Denylist pinned to "" by default so a CI/job-wide value can never leak in.
const envFor = (mock, extra = {}) => ({ PHAROS_RPC_URL: mock.url, GOPLUS_API_BASE: mock.url, SAFEHANDS_RECIPIENT_DENYLIST: "", ...extra });
// Canonical-vault deposit intent: the target contributes no risk floor, so the
// resulting score isolates the calldata decode under test.
const intentWithData = (data) => JSON.stringify({
  subjectType: "intent", action: "vault_deposit", walletAddress: WALLET, vault: CANON, to: TOKEN, data,
});
const baselineIntent = () => JSON.stringify({
  subjectType: "intent", action: "vault_deposit", walletAddress: WALLET, vault: CANON,
});

describe("Anvita engine — approval calldata floors (escalate-only)", () => {
  let mock;
  after(() => mock?.close());

  it("BLOCKs an unlimited approve to an UNKNOWN spender (>= 90)", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData(approveData(UNKNOWN_SPENDER, MAX_UINT256)), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "block");
    assert.ok(out.riskScore >= 90);
    assert.ok(out.riskFactors.some((f) => /UNLIMITED approve/i.test(f) && /UNKNOWN spender/i.test(f)));
    assert.strictEqual(out.components.calldata.unlimited, true);
    assert.strictEqual(out.components.calldata.spender, UNKNOWN_SPENDER);
  });

  it("warns (never allows) an unlimited approve to a KNOWN canonical spender", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData(approveData(CANON, MAX_UINT256)), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "warn");
    assert.ok(out.riskScore >= 65);
    assert.ok(out.riskFactors.some((f) => /known spender/i.test(f)));
    assert.strictEqual(out.components.calldata.counterpartyKnown, true);
    assert.strictEqual(out.components.calldata.counterpartyLabel, CANON_LABEL);
  });

  it("holds a limited approve to an unknown spender at warn (>= 45)", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData(approveData(UNKNOWN_SPENDER, W("3e8"))), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "warn");
    assert.ok(out.riskScore >= 45);
    assert.strictEqual(out.components.calldata.unlimited, false);
  });

  it("a revoke approve(spender, 0) never escalates vs the same intent without data", async () => {
    mock = startMock();
    const base = await runEngine("analyze", baselineIntent(), envFor(mock));
    const revoke = await runEngine("analyze", intentWithData(approveData(UNKNOWN_SPENDER, W("0"))), envFor(mock));
    mock.close();
    assert.strictEqual(revoke.out.components.calldata.isRevoke, true);
    assert.strictEqual(revoke.out.riskScore, base.out.riskScore);
    assert.strictEqual(revoke.out.recommendation, base.out.recommendation);
  });

  it("BLOCKs setApprovalForAll(operator, true) to an unknown operator; revocation does not escalate", async () => {
    mock = startMock();
    const grant = await runEngine("analyze", intentWithData(setApprovalForAllData(UNKNOWN_SPENDER, true)), envFor(mock));
    const revoke = await runEngine("analyze", intentWithData(setApprovalForAllData(UNKNOWN_SPENDER, false)), envFor(mock));
    const base = await runEngine("analyze", baselineIntent(), envFor(mock));
    mock.close();
    assert.strictEqual(grant.out.recommendation, "block");
    assert.ok(grant.out.riskScore >= 90);
    assert.ok(grant.out.riskFactors.some((f) => /setApprovalForAll/.test(f) && /EVERY token/i.test(f)));
    assert.strictEqual(revoke.out.components.calldata.approved, false);
    assert.strictEqual(revoke.out.riskScore, base.out.riskScore);
  });

  it("BLOCKs an unlimited ERC-2612 permit and an unlimited Permit2 approve (signature-approval notes)", async () => {
    mock = startMock();
    const permit = await runEngine("analyze", intentWithData(permitData(WALLET, UNKNOWN_SPENDER, MAX_UINT256)), envFor(mock));
    const permit2 = await runEngine("analyze", intentWithData(permit2ApproveData(TOKEN, UNKNOWN_SPENDER)), envFor(mock));
    mock.close();
    assert.strictEqual(permit.out.recommendation, "block");
    assert.ok(permit.out.components.calldata.notes.some((n) => /signature-based approval/i.test(n)));
    assert.strictEqual(permit2.out.recommendation, "block");
    assert.strictEqual(permit2.out.components.calldata.unlimited, true);
    assert.ok(permit2.out.components.calldata.notes.some((n) => /Permit2 signatures/i.test(n)));
  });
});

describe("Anvita engine — recipient denylist (operator-supplied, empty by default)", () => {
  let mock;
  after(() => mock?.close());

  it("BLOCKs a transfer intent to a denylisted recipient (>= 95)", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze",
      JSON.stringify({ subjectType: "intent", action: "transfer", walletAddress: WALLET, toAddress: RECIPIENT }),
      envFor(mock, { SAFEHANDS_RECIPIENT_DENYLIST: RECIPIENT }));
    mock.close();
    assert.strictEqual(out.recommendation, "block");
    assert.ok(out.riskScore >= 95);
    assert.ok(out.riskFactors.some((f) => /denylist/i.test(f)));
  });

  it("with the env explicitly empty, a calldata token transfer still holds at warn (>= 35), never allow", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData(transferData(RECIPIENT, W("3e8"))),
      envFor(mock, { SAFEHANDS_RECIPIENT_DENYLIST: "" }));
    mock.close();
    assert.strictEqual(out.recommendation, "warn");
    assert.ok(out.riskScore >= 35);
    assert.ok(out.riskFactors.some((f) => /moves tokens/i.test(f)));
    assert.strictEqual(out.components.calldata.recipientDenylisted, false);
  });

  it("BLOCKs a calldata transfer whose recipient is denylisted", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData(transferData(RECIPIENT, W("3e8"))),
      envFor(mock, { SAFEHANDS_RECIPIENT_DENYLIST: RECIPIENT }));
    mock.close();
    assert.strictEqual(out.recommendation, "block");
    assert.ok(out.riskScore >= 95);
    assert.strictEqual(out.components.calldata.recipientDenylisted, true);
  });

  it("denylist parsing filters garbage entries and normalizes case/whitespace", async () => {
    mock = startMock();
    const deny = "0x5555aaaa5555aaaa5555aaaa5555aaaa5555aaaa";
    const messy = `garbage,,not-an-address, 0x5555AAAA5555AAAA5555AAAA5555AAAA5555AAAA ,0xzz`;
    const hit = await runEngine("analyze",
      JSON.stringify({ subjectType: "intent", action: "transfer", walletAddress: WALLET, toAddress: deny }),
      envFor(mock, { SAFEHANDS_RECIPIENT_DENYLIST: messy }));
    const miss = await runEngine("analyze",
      JSON.stringify({ subjectType: "intent", action: "transfer", walletAddress: WALLET, toAddress: UNKNOWN_SPENDER }),
      envFor(mock, { SAFEHANDS_RECIPIENT_DENYLIST: messy }));
    mock.close();
    assert.strictEqual(hit.out.recommendation, "block");
    assert.ok(!miss.out.riskFactors.some((f) => /denylist/i.test(f)));
  });
});

describe("Anvita engine — admin, malformed, unknown, batch calldata", () => {
  let mock;
  after(() => mock?.close());

  it("flags transferOwnership as a dangerous admin call (warn, dangerous:true)", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData(transferOwnershipData(UNKNOWN_SPENDER)), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "warn");
    assert.ok(out.riskScore >= 61);
    assert.strictEqual(out.components.calldata.dangerous, true);
    assert.ok(out.riskFactors.some((f) => /Dangerous\/admin call/i.test(f)));
  });

  it("holds malformed calldata for a known selector at warn (>= 45), never allow", async () => {
    mock = startMock();
    const truncated = "0x095ea7b3" + addrW(UNKNOWN_SPENDER); // approve with the amount word missing
    const { out } = await runEngine("analyze", intentWithData(truncated), envFor(mock));
    mock.close();
    assert.notStrictEqual(out.recommendation, "allow");
    assert.ok(out.riskScore >= 45);
    assert.ok(out.riskFactors.some((f) => /malformed/i.test(f)));
  });

  it("holds an unrecognized selector at warn (>= 31), never allow", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData("0xdeadbeef" + W("1")), envFor(mock));
    mock.close();
    assert.strictEqual(out.recommendation, "warn");
    assert.ok(out.riskScore >= 31);
    assert.ok(out.riskFactors.some((f) => /not a recognized method/i.test(f)));
  });

  it("MultiSend: an inner unlimited-approve-to-unknown blocks the whole batch; delegatecall floors >= 45", async () => {
    mock = startMock();
    const badBatch = multiSendData(
      msInner("00", TOKEN, approveData(UNKNOWN_SPENDER, MAX_UINT256).slice(2)),
    );
    const delegateBatch = multiSendData(msInner("01", TOKEN, ""));
    const bad = await runEngine("analyze", intentWithData(badBatch), envFor(mock));
    const delegate = await runEngine("analyze", intentWithData(delegateBatch), envFor(mock));
    mock.close();
    assert.strictEqual(bad.out.recommendation, "block");
    assert.ok(bad.out.riskScore >= 90);
    assert.ok(bad.out.riskFactors.some((f) => /MultiSend inner #0/.test(f) && /UNLIMITED approve/i.test(f)));
    assert.ok(delegate.out.riskScore >= 45);
    assert.ok(delegate.out.riskFactors.some((f) => /delegatecall/i.test(f)));
  });
});

describe("Anvita engine — additive surfaces & invariants", () => {
  let mock;
  after(() => mock?.close());

  it("simulate_transaction gains an additive calldata label block; pre-existing fields unchanged", async () => {
    mock = startMock();
    const { out } = await runEngine("simulate_transaction",
      JSON.stringify({ to: TOKEN, data: approveData(UNKNOWN_SPENDER, MAX_UINT256) }), envFor(mock));
    const est = await runEngine("estimate_gas",
      JSON.stringify({ to: TOKEN, data: approveData(UNKNOWN_SPENDER, MAX_UINT256) }), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.reverted, false);
    assert.strictEqual(out.broadcast, false);
    assert.ok(out.returnData.startsWith("0x"));
    assert.match(out.note, /nothing was signed or broadcast/);
    assert.strictEqual(out.calldata.method, "approve");
    assert.strictEqual(out.calldata.unlimited, true);
    assert.strictEqual(out.calldata.spender, UNKNOWN_SPENDER);
    assert.ok(!("riskScore" in out), "simulate must stay label-only, no scoring");
    assert.strictEqual(est.out.calldata.method, "approve");
    assert.strictEqual(est.out.estimatedGas, 28470);
  });

  it("long calldata full of 64-hex words does NOT trigger KEY_MATERIAL_REJECTED (data exemption holds)", async () => {
    mock = startMock();
    const { out } = await runEngine("analyze", intentWithData(permitData(WALLET, UNKNOWN_SPENDER, MAX_UINT256)), envFor(mock));
    mock.close();
    assert.strictEqual(out.success, true);
    assert.ok(!out.error);
  });

  it("the calldata battery issues only read-only JSON-RPC methods", async () => {
    const WRITE_RE = /send|sign|personal_|unlock|sendraw|submitwork|importraw/i;
    const READ_ONLY_ALLOWED = new Set([
      "eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_getTransactionCount",
      "eth_getCode", "eth_call", "eth_gasPrice", "eth_estimateGas",
      "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getProof",
    ]);
    mock = startMock();
    const env = envFor(mock, { SAFEHANDS_RECIPIENT_DENYLIST: RECIPIENT });
    await runEngine("analyze", intentWithData(approveData(UNKNOWN_SPENDER, MAX_UINT256)), env);
    await runEngine("analyze", intentWithData(multiSendData(msInner("00", TOKEN, transferData(RECIPIENT, W("3e8")).slice(2)))), env);
    await runEngine("analyze", JSON.stringify({ subjectType: "intent", action: "transfer", walletAddress: WALLET, toAddress: RECIPIENT }), env);
    await runEngine("simulate_transaction", JSON.stringify({ to: TOKEN, data: transferOwnershipData(UNKNOWN_SPENDER) }), env);
    const methods = mock.methodsCalled;
    mock.close();
    assert.ok(methods.length > 0);
    for (const m of methods) {
      assert.ok(!WRITE_RE.test(m), `write-shaped RPC method leaked: ${m}`);
      assert.ok(READ_ONLY_ALLOWED.has(m), `unexpected RPC method (not in read-only allowlist): ${m}`);
    }
  });
});
