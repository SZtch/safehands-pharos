// ─── Write-tool risk-gate wiring tests (hermetic — mocked RPC, no network) ────
// The policy engine is the SOLE ALLOW/BLOCK decider on write paths; the tools
// feed it the advisory risk assessment as evidence (riskEvidenceFromAssessment)
// and gate through enforceWriteDecision({ requireRiskEvidence: true }).
//
// These tests exercise handleSendPayment / handleExecuteSwap END-TO-END to pin
// that wiring: if a tool stops passing `risk:` into evaluateActionPolicy, the
// degraded scenarios below return POLICY_EVIDENCE_MISSING instead of
// CONFIRMATION_REQUIRED and this suite fails loudly (no silent weakening).
//
// Hermetic setup (see test/write-path-gates.test.ts for the pattern):
// viem's clients use global fetch → a mocked JSON-RPC endpoint below. The
// degraded swap path needs no route mock at all — DODO_API_SUPPORTED_CHAIN_IDS
// excludes the active chain, so getDodoRoute throws DodoNotConfiguredError
// before any fetch (the permanent SWAP_LIQUIDITY_NOT_CONFIGURED state). The
// degraded transfer path kills the WALLET's eth_getBalance after the tool's own
// first read, so only the risk engine's balance dimension degrades.
// CI exports write-gate env vars job-wide — every var this suite depends on is
// snapshotted, pinned, and restored here (never assume a clean environment).
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { handleSendPayment } from "../src/tools/sendPayment.js";
import { handleExecuteSwap } from "../src/tools/executeSwap.js";

// Well-known throwaway test key (hardhat/anvil account #0) — never funded here.
const TEST_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RECIPIENT = "0x2222222222222222222222222222222222222222";

const ENV_KEYS = [
  "WRITE_TOOLS_ENABLED",
  "SAFE_EXECUTE_ENABLED",
  "SAFEHANDS_NETWORK",
  "WALLET_MODE",
  "PRIVATE_KEY",
  "MANAGED_WALLET_ENABLED",
  "SAFEHANDS_ENABLE_MANAGED_WALLET",
  "AUTO_AUTHORIZE_AGENT_WALLET",
  "ALLOW_LOCAL_X402_FETCH",
  "DODO_API_SUPPORTED_CHAIN_IDS",
  "SAFEHANDS_RECIPIENT_DENYLIST",
  "PROS_USD_PRICE",
  "MAX_DAILY_SPEND_USD",
  "MAX_TX_AMOUNT_PROS",
  "PHAROS_RPC_URL",
  "PHAROS_RPC_URLS",
] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

function baseEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.WRITE_TOOLS_ENABLED = "true";
  process.env.WALLET_MODE = "env";
  process.env.PRIVATE_KEY = TEST_PK;
}

// ── Mock JSON-RPC over global fetch ──────────────────────────────────────────
const realFetch = globalThis.fetch;
const ONE_ETHER_HEX = "0xde0b6b3a7640000"; // 1e18
const ZERO_HASH = `0x${"0".repeat(64)}`;
const mockState = {
  /** After the tool's own first read, the WALLET's balance RPC dies → the risk
   *  engine's balance dimension (and only it) degrades. */
  failWalletBalanceAfterFirstRead: false,
  walletBalanceReads: 0,
};

function blockFor(numberHex: string, timestamp: number) {
  return {
    hash: ZERO_HASH,
    parentHash: ZERO_HASH,
    number: numberHex,
    timestamp: `0x${timestamp.toString(16)}`,
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x5208",
    baseFeePerGas: "0x3b9aca00",
    miner: "0x0000000000000000000000000000000000000000",
    extraData: "0x",
    logsBloom: `0x${"0".repeat(512)}`,
    mixHash: ZERO_HASH,
    receiptsRoot: ZERO_HASH,
    sha3Uncles: ZERO_HASH,
    size: "0x220",
    stateRoot: ZERO_HASH,
    transactions: [],
    transactionsRoot: ZERO_HASH,
    uncles: [],
  };
}

before(() => {
  globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const handle = (r: { id: number; method: string; params?: unknown[] }) => {
      switch (r.method) {
        case "eth_chainId":
          return { jsonrpc: "2.0", id: r.id, result: "0x688" }; // 1672
        case "eth_getBalance": {
          const addr = String(r.params?.[0] ?? "").toLowerCase();
          if (addr === TEST_ADDRESS.toLowerCase()) {
            mockState.walletBalanceReads += 1;
            if (mockState.failWalletBalanceAfterFirstRead && mockState.walletBalanceReads > 1) {
              return { jsonrpc: "2.0", id: r.id, error: { code: -32000, message: "balance backend unavailable (test)" } };
            }
          }
          return { jsonrpc: "2.0", id: r.id, result: ONE_ETHER_HEX };
        }
        case "eth_getCode":
          return { jsonrpc: "2.0", id: r.id, result: "0x" }; // recipient is an EOA
        case "eth_call":
          // balanceOf() → a comfortably large uint256
          return { jsonrpc: "2.0", id: r.id, result: `0x${"0".repeat(48)}${"f".repeat(16)}` };
        case "eth_gasPrice":
          return { jsonrpc: "2.0", id: r.id, result: "0x3b9aca00" }; // 1 gwei
        case "eth_getBlockByNumber": {
          const tag = r.params?.[0];
          // latest = block 100 @ t=1050; block 90 @ t=1000 → 5s/block (healthy)
          if (tag === "latest") return { jsonrpc: "2.0", id: r.id, result: blockFor("0x64", 1050) };
          return { jsonrpc: "2.0", id: r.id, result: blockFor(String(tag), 1000) };
        }
        default:
          return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: `method ${r.method} not mocked` } };
      }
    };
    const payload = Array.isArray(body) ? body.map(handle) : handle(body);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  mockState.failWalletBalanceAfterFirstRead = false;
  mockState.walletBalanceReads = 0;
});

function errCode(res: unknown): string | undefined {
  return (res as { error?: { code?: string } }).error?.code;
}
function errMessage(res: unknown): string {
  return String((res as { error?: { message?: string } }).error?.message ?? "");
}

describe("execute_swap · risk evidence flows through the single policy call", () => {
  it("degraded risk (SWAP_LIQUIDITY_NOT_CONFIGURED) without confirm → CONFIRMATION_REQUIRED", async () => {
    baseEnv();
    process.env.DODO_API_SUPPORTED_CHAIN_IDS = "688689"; // active chain 1672 NOT supported
    const res = await handleExecuteSwap({ tokenIn: "USDC", tokenOut: "PROS", amountIn: "0.001" });
    assert.strictEqual(errCode(res), "CONFIRMATION_REQUIRED");
    assert.ok(errMessage(res).includes("degraded"), `degradation must be named in the message, got: ${errMessage(res)}`);
  });

  it("degraded risk WITH confirm=true passes the gate (fails later on the tool's own quote fetch)", async () => {
    baseEnv();
    process.env.DODO_API_SUPPORTED_CHAIN_IDS = "688689";
    const res = await handleExecuteSwap({ tokenIn: "USDC", tokenOut: "PROS", amountIn: "0.001", confirm: true });
    // The policy gate opened (confirmable degraded state); the failure is the
    // route provider itself, downstream of the decision point.
    assert.strictEqual(errCode(res), "SWAP_LIQUIDITY_NOT_CONFIGURED");
  });
});

describe("send_payment · risk evidence flows through the single policy call", () => {
  it("degraded risk (balance dimension unreadable) without confirm → CONFIRMATION_REQUIRED", async () => {
    baseEnv();
    mockState.failWalletBalanceAfterFirstRead = true;
    const res = await handleSendPayment({ toAddress: RECIPIENT, amount: "0.001" });
    assert.strictEqual(errCode(res), "CONFIRMATION_REQUIRED");
    assert.ok(errMessage(res).includes("degraded"), `degradation must be named in the message, got: ${errMessage(res)}`);
  });

  it("a policy BLOCK stays non-confirmable end-to-end (denylisted recipient, confirm=true)", async () => {
    baseEnv();
    process.env.SAFEHANDS_RECIPIENT_DENYLIST = RECIPIENT;
    const res = await handleSendPayment({ toAddress: RECIPIENT, amount: "0.001", confirm: true });
    assert.strictEqual(errCode(res), "POLICY_BLOCKED");
  });
});
