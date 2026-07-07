// ─── Agent Arena — Payment Agent (x402) ────────────────────────────────
// A Payment Agent asks SafeHands whether an x402 paid request is safe BEFORE
// paying. SafeHands checks URL (SSRF), amount vs policy/limit, token, and payTo.
// Live Execution: Reads live from Pharos Pacific Mainnet RPC and DODO API.
// Run: npx tsx examples/agent-arena/payment-agent-x402.ts
// ────────────────────────────────────────────────────────────────────────

import { createGuardianAgent } from "../../src/agent/index.js";

// Force Mainnet environment for Hackathon Phase 2 Demo
process.env.SAFEHANDS_NETWORK = "pacific-mainnet";


let failures = 0;
function expect(name: string, actual: string, allowed: string[]) {
  const ok = allowed.includes(actual);
  console.log(`${ok ? "✔" : "✘"} ${name}: got ${actual}, expected ${allowed.join(" | ")}`);
  if (!ok) failures++;
}

async function main() {
  const agent = createGuardianAgent();

  // Fixture 1 — safe URL, small amount within limits. Safe, but execution is
  // disabled by default → PREPARE_ONLY (caller must prepare/hand off, not pay).
  const safe = await agent.checkForAgent("payment-agent", {
    url: "https://api.example.com/paid-resource",
    paymentAmountUsdc: "0.001",
    payTo: "0x000000000000000000000000000000000000beef",
  });
  expect("safe small payment", safe.decision, ["PREPARE_ONLY"]);
  expect("  caller obligation", safe.caller.obligation, ["prepare_handoff_no_execute"]);

  // Fixture 2 — unsafe URL (localhost SSRF) → BLOCK.
  const unsafe = await agent.checkForAgent("payment-agent", {
    url: "http://localhost:8545/paid",
    paymentAmountUsdc: "0.001",
  });
  expect("localhost SSRF", unsafe.decision, ["BLOCK"]);
  expect("  caller obligation", unsafe.caller.obligation, ["stop"]);

  // Fixture 3 — amount over a tighter agent policy but under the hard cap →
  // policy escalates to REQUIRE_CONFIRMATION.
  const strict = createGuardianAgent({ owner: "agent", policy: { maxX402PaymentUsdc: "0.005" } });
  const overPolicy = await strict.checkForAgent("payment-agent", {
    url: "https://api.example.com/paid-resource",
    paymentAmountUsdc: "0.008",
  });
  expect("over agent policy", overPolicy.decision, ["REQUIRE_CONFIRMATION"]);
  expect("  caller obligation", overPolicy.caller.obligation, ["ask_user_or_admin"]);

  // Fixture 4 — amount over the hard payment cap → BLOCK.
  const overCap = await agent.check({ url: "https://api.example.com/paid", paymentAmountUsdc: "999999" });
  expect("over hard cap", overCap.decision, ["BLOCK"]);

  // SafeHands never executes a payment.
  expect("read-only", String(safe.readOnly), ["true"]);
  expect("execution disabled", String(safe.executionAvailable), ["false"]);

  console.log(failures === 0 ? "\n✅ payment-agent-x402: all expectations met" : `\n❌ ${failures} expectation(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
