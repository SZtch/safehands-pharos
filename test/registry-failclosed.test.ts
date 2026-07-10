// ─── SafeHandsRegistry reads fail CLOSED on RPC outage ────────────────────
// Audit gap: nothing pinned that a mid-decision registry/RPC outage cannot
// yield a false-positive authorization or a phantom risk root. This test points
// the RPC at an unreachable local port BEFORE importing the client (env is read
// at module load), then asserts every read path degrades to the safe answer:
// authorized:false + structured error, never a throw and never a false "yes".
//
// Runs in its own file so the poisoned PHAROS_RPC_URL cannot leak into other
// suites (the node:test runner isolates each file in its own process).
import { describe, it, after } from "node:test";
import assert from "node:assert";

// Snapshot + restore the env keys this file poisons. Module-load-time readers
// in THIS process are unaffected (by design — that is what the poisoning is
// for), but restoration keeps dynamic env readers safe if a runner ever stops
// isolating test files into separate processes.
const POISONED_ENV_KEYS = ["PHAROS_RPC_URL", "PHAROS_RPC_URLS", "SAFEHANDS_REGISTRY_ADDRESS", "SAFEHANDS_RISK_REGISTRY_ADDRESS"] as const;
const savedEnv = Object.fromEntries(POISONED_ENV_KEYS.map((k) => [k, process.env[k]]));
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

process.env.PHAROS_RPC_URL = "http://127.0.0.1:9"; // unreachable (discard port)
delete process.env.PHAROS_RPC_URLS;
delete process.env.SAFEHANDS_REGISTRY_ADDRESS;
delete process.env.SAFEHANDS_RISK_REGISTRY_ADDRESS;

const { isAgentAuthorized, queryRegistryForTarget } = await import("../src/lib/safeHandsRegistry.js");

const WALLET = "0x8ba1f109551bD432803012645Ac136ddd64DBA72" as const;

describe("SafeHandsRegistry · RPC outage fails closed", () => {
  it("isAgentAuthorized returns false (never true, never throws) when the RPC is down", async () => {
    assert.strictEqual(await isAgentAuthorized(WALLET), false);
  });

  it("queryRegistryForTarget degrades to authorized:false with a structured error", async () => {
    const result = await queryRegistryForTarget(WALLET);
    assert.strictEqual(result.authorized, false);
    assert.strictEqual(result.hasRiskRecord, false);
    assert.strictEqual(result.currentMerkleRoot, null);
    // The baked Pacific default address is still reported (identity), but no
    // on-chain claim is fabricated for it.
    assert.ok(result.address.length > 0);
  });
});
