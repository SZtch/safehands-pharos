// ─── Risk engine behavioral tests (hermetic — mocked JSON-RPC, no network) ──
// assessRisk() drives liquidity/slippage/counterparty/balance/market scoring
// behind the public verdict. These tests pin the load-bearing behaviors:
//   • swap counterparty trust is registry-driven, NOT a hardcoded
//     "DODO protocol (known) → 5";
//   • when the DODO route API is NOT a configured provider for the
//     active chain, a swap surfaces swapProviderNotConfigured + degraded and never
//     scores "proceed" (exercised here by pinning the supported set to testnet-only
//     so mainnet 1672 hits the fail-closed branch);
//   • the transfer counterparty guards (zero-address hard block, self-send).
//
// publicClient (viem) uses global fetch, so we install a JSON-RPC responder.
// getDodoRoute throws DodoNotConfiguredError synchronously on chain 1672, so the
// swap-quote path needs no network at all. Market-condition reads intentionally
// return null blocks → viem throws → the scorer's try/catch degrades that
// (non-critical) dimension to a fixed value, keeping results deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { toHex, parseEther } from "viem";
import { assessRisk } from "../src/lib/riskEngine.js";

// DODO now serves chain 1672 by default. To exercise the fail-closed
// "provider not configured for THIS chain" path hermetically (no real DODO
// fetch), pin the supported set to testnet-only so the mainnet (1672) test env
// hits the not-configured branch deterministically. dodoApiSupportedChainIds()
// reads this at call time. Restored in after().
const savedDodoChains = process.env.DODO_API_SUPPORTED_CHAIN_IDS;
process.env.DODO_API_SUPPORTED_CHAIN_IDS = "688689";

const realFetch = globalThis.fetch;

const state = {
  balances: new Map<string, bigint>(),
  defaultBalance: parseEther("1000"),
  /** JSON-RPC methods the mock should fail, for degraded-evidence tests. */
  failMethods: new Set<string>(),
};

function rpcResult(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return "0x688"; // 1672
    case "eth_getBalance": {
      const addr = String(params[0] ?? "").toLowerCase();
      return toHex(state.balances.has(addr) ? (state.balances.get(addr) as bigint) : state.defaultBalance);
    }
    case "eth_getCode":
      return "0x"; // EOA
    case "eth_gasPrice":
      return "0x3b9aca00"; // 1 gwei
    case "eth_blockNumber":
      return "0x10";
    case "eth_call":
      return "0x"; // ERC-20 reads decode-fail → caught by the balance scorer
    case "eth_getBlockByNumber":
      return null; // → BlockNotFound → market scorer degrades deterministically
    default:
      return null;
  }
}

before(() => {
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const handle = (r: any) =>
      state.failMethods.has(r.method)
        ? { jsonrpc: "2.0", id: r.id, error: { code: -32000, message: `mock RPC failure for ${r.method}` } }
        : { jsonrpc: "2.0", id: r.id, result: rpcResult(r.method, r.params || []) };
    const payload = Array.isArray(body) ? body.map(handle) : handle(body);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  if (savedDodoChains === undefined) delete process.env.DODO_API_SUPPORTED_CHAIN_IDS;
  else process.env.DODO_API_SUPPORTED_CHAIN_IDS = savedDodoChains;
});

beforeEach(() => {
  state.balances.clear();
  state.defaultBalance = parseEther("1000");
});

const WALLET = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";

describe("assessRisk · swap on Pacific Mainnet (DODO route API not configured for 1672)", () => {
  it("surfaces swapProviderNotConfigured + degraded and never scores 'proceed'", async () => {
    const res = await assessRisk({ action: "swap", tokenIn: "PROS", tokenOut: "USDC", amount: "1", walletAddress: WALLET });
    assert.strictEqual(res.swapProviderNotConfigured, true);
    assert.strictEqual(res.degraded, true);
    assert.notStrictEqual(res.recommendation, "proceed");
    assert.ok(
      res.reasons.some((r) => /SWAP_LIQUIDITY_NOT_CONFIGURED/.test(r)),
      "a reason must name the structured not-configured state"
    );
    assert.ok(
      res.degradedReasons.some((r) => /permanent configuration state/i.test(r)),
      "degraded reason must distinguish permanent config from a transient outage"
    );
  });

  it("counterparty trust is registry-driven, NOT the old hardcoded 'DODO (known) → 5'", async () => {
    const res = await assessRisk({ action: "swap", tokenIn: "PROS", tokenOut: "USDC", amount: "1", walletAddress: WALLET });
    assert.notStrictEqual(res.breakdown.counterpartyRisk, 5);
    assert.ok(
      !res.reasons.some((r) => /DODO protocol \(known\)/.test(r)),
      "the fabricated 'DODO protocol (known)' trust reason must be gone"
    );
    assert.ok(
      res.reasons.some((r) => /could not be determined|not in the SafeHands ecosystem registry/i.test(r)),
      "counterparty must be reported as unverified/undetermined, not trusted"
    );
  });
});

describe("assessRisk · transfer counterparty guards", () => {
  it("zero address hard-blocks (tokens would be burned)", async () => {
    const res = await assessRisk({
      action: "transfer",
      amount: "1",
      toAddress: "0x0000000000000000000000000000000000000000",
      walletAddress: WALLET,
    });
    assert.strictEqual(res.recommendation, "block");
    assert.strictEqual(res.breakdown.counterpartyRisk, 95);
    assert.strictEqual(res.swapProviderNotConfigured, undefined, "non-swap results omit the swap-config flag");
  });

  it("self-send is flagged as likely-unintended (moderate), not trusted", async () => {
    const res = await assessRisk({ action: "transfer", amount: "1", toAddress: WALLET, walletAddress: WALLET });
    assert.strictEqual(res.breakdown.counterpartyRisk, 50);
    assert.ok(res.reasons.some((r) => /own address/i.test(r)));
  });

  it("invalid recipient address hard-blocks", async () => {
    const res = await assessRisk({ action: "transfer", amount: "1", toAddress: "0xnot-an-address", walletAddress: WALLET });
    assert.strictEqual(res.recommendation, "block");
    assert.strictEqual(res.breakdown.counterpartyRisk, 100);
  });

  it("an unexaminable recipient degrades instead of reading as clean", async () => {
    // eth_getCode is the only recipient probe that can fail here (the wallet
    // balance check uses eth_getBalance, which stays healthy), so this isolates
    // the counterparty dimension. Before this was fixed the RPC error was
    // swallowed and the recipient scored 10 / "looks valid": an outage produced
    // a clean verdict, which invariant #1 forbids.
    state.failMethods.add("eth_getCode");
    try {
      const res = await assessRisk({ action: "transfer", amount: "1", toAddress: RECIPIENT, walletAddress: WALLET });
      assert.strictEqual(res.degraded, true, "a failed recipient probe must mark the assessment degraded");
      assert.notStrictEqual(res.breakdown.counterpartyRisk, 10, "unexamined recipient must not score as clean");
      assert.ok(
        res.degradedReasons.some((r) => /recipient could not be examined/i.test(r)),
        `degraded reasons must name the recipient probe, got: ${JSON.stringify(res.degradedReasons)}`
      );
      assert.ok(!res.reasons.some((r) => /looks valid/i.test(r)), "must not claim the recipient looks valid");
      assert.notStrictEqual(res.recommendation, "proceed", "degraded evidence can never recommend proceed");
    } finally {
      state.failMethods.delete("eth_getCode");
    }
  });
});

describe("assessRisk · balance sufficiency (native PROS)", () => {
  it("insufficient native balance scores the balance dimension at maximum", async () => {
    state.balances.set(WALLET.toLowerCase(), parseEther("0.001")); // less than amount + gas
    const res = await assessRisk({ action: "transfer", amount: "1", toAddress: "0x2222222222222222222222222222222222222222", walletAddress: WALLET });
    assert.strictEqual(res.breakdown.balanceRisk, 100);
    assert.ok(res.reasons.some((r) => /Insufficient PROS balance/.test(r)));
  });

  it("ample native balance keeps the balance dimension low", async () => {
    const res = await assessRisk({ action: "transfer", amount: "1", toAddress: "0x2222222222222222222222222222222222222222", walletAddress: WALLET });
    assert.ok(res.breakdown.balanceRisk <= 30, `expected low balance risk, got ${res.breakdown.balanceRisk}`);
  });
});
