// ─── SafeHands live-RPC smoke (NON-hermetic) ───────────────────────────────
// These hit LIVE Pharos Pacific mainnet RPC (read-only; never broadcasts). They
// are intentionally separated from the deterministic suite so a public-RPC
// outage cannot red the merge-gating unit tests. Run via `npm run test:live`.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { getActiveNetwork } from "../src/lib/networks.js";
import { queryRegistryForTarget } from "../src/lib/safeHandsRegistry.js";
import { createGuardianAgent } from "../src/agent/SafeHandsGuardianAgent.js";

describe("SafeHands Live Mainnet Smoke (read-only)", () => {
  const TEST_WALLET = "0x000000000000000000000000000000000000dEaD";

  before(() => {
    assert.strictEqual(getActiveNetwork().name, "pacific-mainnet", "Tests must run against pacific-mainnet");
  });

  it("should query the SafeHandsRegistry on mainnet without reverting", async () => {
    const result = await queryRegistryForTarget(TEST_WALLET);
    // State is unknown; just assert the RPC call succeeded and returned the shape.
    assert.ok(typeof result.authorized === "boolean");
    assert.ok(result.error === undefined || result.error.includes("not configured"));
  });

  it("should run a SafeHands Agent preflight enrichment gracefully", async () => {
    const agent = createGuardianAgent();
    const result = await agent.check({
      to: TEST_WALLET,
      value: "1000000000000000", // 0.001 PROS in wei — a transfer intent
    });

    assert.strictEqual(result.readOnly, true);
    assert.ok(result.evidence);
    const ev = result.evidence as any;
    assert.ok(ev.enrichment || result.reasons.some((r) => r.includes("security signal: on-chain contract intelligence")));
  });
});
