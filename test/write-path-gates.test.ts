// ─── Write-path gate behavioral tests (hermetic — mocked RPC, no real network) ──
// Pins the fail-closed ordering of the two write-path entry modules:
//
// requireManagedExecutionReady (src/lib/managedExecution.ts) — the shared gate
// every write/payment tool passes through:
//   1. WRITE_TOOLS_ENABLED must be "true"          → WRITE_TOOLS_DISABLED
//   1b. active network must allow execution        → EXECUTION_DISABLED_ON_NETWORK
//   2. a signer must resolve                       → NO_SIGNER_AVAILABLE / INVALID_PRIVATE_KEY /
//                                                    MANAGED_WALLET_DISABLED
//   3. managed-mainnet signers need on-chain SafeHandsRegistry authorization
//                                                  → REQUIRE_AUTHORIZATION
//
// broadcastSignedTransaction (src/lib/pharos/userSignedBroadcaster.ts) — the
// zero-custody signed-tx relay: env-gated, mainnet(1672)-only, and both the
// requested chainId AND the active network must be Pacific.
//
// viem's publicClient uses global fetch → mocked JSON-RPC for the registry
// authorization read. The broadcaster's loopback path in http.ts (the documented
// LOCAL-ONLY ALLOW_LOCAL_X402_FETCH escape hatch, hard-disabled in production)
// also resolves to global fetch, so the same mock serves eth_sendRawTransaction.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { requireManagedExecutionReady, isManagedExecutionFailure } from "../src/lib/managedExecution.js";
import { broadcastSignedTransaction } from "../src/lib/pharos/userSignedBroadcaster.js";
import { walletStore, encryptKey, getEffectiveEncryptionKey } from "../src/lib/wallet/index.js";

// Well-known throwaway test key (hardhat/anvil account #0) — never funded here.
const TEST_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const ENV_KEYS = [
  "WRITE_TOOLS_ENABLED",
  "SAFEHANDS_NETWORK",
  "WALLET_MODE",
  "PRIVATE_KEY",
  "MANAGED_WALLET_ENABLED",
  "SAFEHANDS_ENABLE_MANAGED_WALLET",
  "WALLET_STORE_PATH",
  "WALLET_ENCRYPTION_KEY",
  "AUTO_AUTHORIZE_AGENT_WALLET",
  "SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED",
  "PHAROS_RPC_URL",
  "PHAROS_RPC_URLS",
  "ALLOW_LOCAL_X402_FETCH",
] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

function resetEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

// ── Mock JSON-RPC over global fetch ────────────────────────────────────────
// Serves both the viem publicClient (registry authorization eth_call) and the
// broadcaster's loopback-bypass path (eth_sendRawTransaction).
const realFetch = globalThis.fetch;
const rpcState = {
  agentAuthorized: false,
  seenRawTx: null as string | null,
  sendRawReply: { result: undefined as string | undefined, error: undefined as { message: string } | undefined },
};

before(() => {
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const handle = (r: any) => {
      if (r.method === "eth_sendRawTransaction") {
        rpcState.seenRawTx = r.params?.[0] ?? null;
        return { jsonrpc: "2.0", id: r.id, result: rpcState.sendRawReply.result, error: rpcState.sendRawReply.error };
      }
      let result: unknown = null;
      if (r.method === "eth_chainId") result = "0x688"; // 1672
      else if (r.method === "eth_call") {
        result = rpcState.agentAuthorized ? `0x${"0".repeat(63)}1` : `0x${"0".repeat(64)}`;
      }
      return { jsonrpc: "2.0", id: r.id, result };
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

function expectFailure(r: Awaited<ReturnType<typeof requireManagedExecutionReady>>, code: string): void {
  assert.ok(isManagedExecutionFailure(r), `expected a ToolFailure, got a ready signer`);
  assert.strictEqual(r.error.code, code);
}

describe("requireManagedExecutionReady · gate ordering (fail-closed)", () => {
  it("gate 1: writes are OFF by default → WRITE_TOOLS_DISABLED", async () => {
    resetEnv();
    expectFailure(await requireManagedExecutionReady("test_tool"), "WRITE_TOOLS_DISABLED");
  });

  it("gate 1 is checked before anything else (even with a signer configured)", async () => {
    resetEnv();
    process.env.WALLET_MODE = "env";
    process.env.PRIVATE_KEY = TEST_PK;
    expectFailure(await requireManagedExecutionReady("test_tool"), "WRITE_TOOLS_DISABLED");
  });

  it("gate 1b: a non-execution network refuses writes → EXECUTION_DISABLED_ON_NETWORK", async () => {
    resetEnv();
    process.env.WRITE_TOOLS_ENABLED = "true";
    process.env.SAFEHANDS_NETWORK = "atlantic-testnet";
    process.env.WALLET_MODE = "env";
    process.env.PRIVATE_KEY = TEST_PK;
    expectFailure(await requireManagedExecutionReady("test_tool"), "EXECUTION_DISABLED_ON_NETWORK");
  });

  it("gate 2: writes enabled but no signer source → NO_SIGNER_AVAILABLE", async () => {
    resetEnv();
    process.env.WRITE_TOOLS_ENABLED = "true";
    expectFailure(await requireManagedExecutionReady("test_tool"), "NO_SIGNER_AVAILABLE");
  });

  it("gate 2: WALLET_MODE=env with a malformed key → INVALID_PRIVATE_KEY", async () => {
    resetEnv();
    process.env.WRITE_TOOLS_ENABLED = "true";
    process.env.WALLET_MODE = "env";
    process.env.PRIVATE_KEY = "not-a-key";
    expectFailure(await requireManagedExecutionReady("test_tool"), "INVALID_PRIVATE_KEY");
  });

  it("gate 2: managed-mainnet without MANAGED_WALLET_ENABLED → MANAGED_WALLET_DISABLED", async () => {
    resetEnv();
    process.env.WRITE_TOOLS_ENABLED = "true";
    process.env.WALLET_MODE = "managed-mainnet";
    expectFailure(await requireManagedExecutionReady("test_tool", "agent-1"), "MANAGED_WALLET_DISABLED");
  });

  it("env-mode signer passes WITHOUT registry authorization (self-custody path)", async () => {
    resetEnv();
    process.env.WRITE_TOOLS_ENABLED = "true";
    process.env.WALLET_MODE = "env";
    process.env.PRIVATE_KEY = TEST_PK;
    const r = await requireManagedExecutionReady("test_tool");
    assert.ok(!isManagedExecutionFailure(r), `expected ready, got ${isManagedExecutionFailure(r) ? r.error.code : ""}`);
    assert.strictEqual(r.signer.mode, "env");
    assert.strictEqual(r.signer.address.toLowerCase(), TEST_ADDRESS.toLowerCase());
  });

  describe("gate 3: managed-mainnet signers need SafeHandsRegistry authorization", () => {
    before(async () => {
      // Seed the in-memory wallet store with an encrypted managed wallet.
      await walletStore.set("agent-1", {
        agentId: "agent-1",
        address: TEST_ADDRESS,
        encryptedKey: encryptKey(TEST_PK, getEffectiveEncryptionKey()),
        environment: "pacific-mainnet",
        chainId: 1672,
        isMainnet: true,
        createdAt: new Date().toISOString(),
      });
    });

    it("unauthorized managed wallet is refused → REQUIRE_AUTHORIZATION", async () => {
      resetEnv();
      process.env.WRITE_TOOLS_ENABLED = "true";
      process.env.WALLET_MODE = "managed-mainnet";
      process.env.MANAGED_WALLET_ENABLED = "true";
      rpcState.agentAuthorized = false;
      expectFailure(await requireManagedExecutionReady("test_tool", "agent-1"), "REQUIRE_AUTHORIZATION");
    });

    it("registry-authorized managed wallet is cleared for execution", async () => {
      resetEnv();
      process.env.WRITE_TOOLS_ENABLED = "true";
      process.env.WALLET_MODE = "managed-mainnet";
      process.env.MANAGED_WALLET_ENABLED = "true";
      rpcState.agentAuthorized = true;
      const r = await requireManagedExecutionReady("test_tool", "agent-1");
      assert.ok(!isManagedExecutionFailure(r), `expected ready, got ${isManagedExecutionFailure(r) ? r.error.code : ""}`);
      assert.strictEqual(r.signer.mode, "managed-mainnet");
      assert.strictEqual(r.signer.address.toLowerCase(), TEST_ADDRESS.toLowerCase());
    });
  });
});

describe("broadcastSignedTransaction · zero-custody relay gates", () => {
  it("is OFF by default", async () => {
    resetEnv();
    await assert.rejects(broadcastSignedTransaction("0x02f8", 1672), /Broadcasting is disabled/);
  });

  it("refuses any chainId other than Pacific Mainnet 1672", async () => {
    resetEnv();
    process.env.SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED = "true";
    await assert.rejects(broadcastSignedTransaction("0x02f8", 688689), /only supported on Pharos Pacific Mainnet/);
  });

  it("refuses when the ACTIVE network is not Pacific, even for a 1672 request", async () => {
    resetEnv();
    process.env.SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED = "true";
    process.env.SAFEHANDS_NETWORK = "atlantic-testnet";
    await assert.rejects(broadcastSignedTransaction("0x02f8", 1672), /Active network is not Pharos Pacific Mainnet/);
  });

  describe("relay behavior against the mock RPC", () => {
    function enableLocalRelay(): void {
      resetEnv();
      process.env.SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED = "true";
      process.env.PHAROS_RPC_URL = "http://127.0.0.1:8545";
      process.env.ALLOW_LOCAL_X402_FETCH = "true"; // documented LOCAL-ONLY escape hatch (off in production)
      rpcState.seenRawTx = null;
    }

    it("relays the raw signed tx verbatim and returns the tx hash", async () => {
      enableLocalRelay();
      rpcState.sendRawReply = { result: `0x${"ab".repeat(32)}`, error: undefined };
      const hash = await broadcastSignedTransaction("0x02f8deadbeef", 1672);
      assert.strictEqual(hash, `0x${"ab".repeat(32)}`);
      assert.strictEqual(rpcState.seenRawTx, "0x02f8deadbeef");
    });

    it("surfaces an RPC error as a loud failure (never a silent success)", async () => {
      enableLocalRelay();
      rpcState.sendRawReply = { result: undefined, error: { message: "nonce too low" } };
      await assert.rejects(broadcastSignedTransaction("0x02f8", 1672), /nonce too low/);
    });

    it("treats an empty RPC result as a failure", async () => {
      enableLocalRelay();
      rpcState.sendRawReply = { result: undefined, error: undefined };
      await assert.rejects(broadcastSignedTransaction("0x02f8", 1672), /returned no result/);
    });
  });
});
