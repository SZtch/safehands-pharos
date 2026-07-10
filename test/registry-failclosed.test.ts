// ─── SafeHandsRegistry reads fail CLOSED on RPC outage ────────────────────
// Audit gap: nothing pinned that a mid-decision registry/RPC outage cannot
// yield a false-positive authorization or a phantom risk root. This test points
// the RPC at an unreachable local port BEFORE importing the client (env is read
// at module load), then asserts every read path degrades to the safe answer:
// authorized:false + structured error, never a throw and never a false "yes".
//
// Runs in its own file so the poisoned PHAROS_RPC_URL cannot leak into other
// suites (the node:test runner isolates each file in its own process).
import { describe, it } from "node:test";
import assert from "node:assert";

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
