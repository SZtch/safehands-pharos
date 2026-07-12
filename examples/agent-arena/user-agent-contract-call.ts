// ─── Agent Arena: User Agent (raw contract call) ──────────────────────
// A user asks an agent: "is this raw contract call safe?" The agent forwards it
// to SafeHands, which classifies the call and returns a SafeHands decision.
// Offline/demo: no RPC, no keys, nothing is executed.
// Run: npx tsx examples/agent-arena/user-agent-contract-call.ts
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

  // D: a raw call to an unknown contract with an unrecognized selector.
  const rawCall = await agent.checkForAgent("user-agent", {
    to: "0x1111111111111111111111111111111111111111",
    data: "0xdeadbeef",
  });
  console.log(`intent=${rawCall.intent} decision=${rawCall.decision} risk=${rawCall.riskLevel}`);
  console.log(`summary="${rawCall.summary}"`);
  expect("unknown contract call classified", rawCall.intent, ["unknown_contract_call"]);
  expect("verdict", rawCall.decision, ["REQUIRE_CONFIRMATION"]);
  expect("caller obligation", rawCall.caller.obligation, ["ask_user_or_admin"]);

  // An invalid target address is blocked outright.
  const badTarget = await agent.check({ to: "0xnot-an-address", data: "0xdeadbeef" });
  expect("invalid target", badTarget.decision, ["BLOCK", "REQUIRE_CONFIRMATION"]);

  // A plain native transfer is safe; execution disabled → PREPARE_ONLY.
  const native = await agent.check({ to: "0x000000000000000000000000000000000000beef", value: "1000000000000000" });
  expect("native transfer", native.decision, ["PREPARE_ONLY"]);

  // A risk-explanation question is informational only.
  const explain = await agent.check({ text: "Why would an unlimited approval be risky?" });
  expect("risk explanation", explain.intent, ["risk_explanation"]);

  expect("read-only", String(rawCall.readOnly), ["true"]);
  expect("execution disabled", String(rawCall.executionAvailable), ["false"]);

  console.log(failures === 0 ? "\n✅ user-agent-contract-call: all expectations met" : `\n❌ ${failures} expectation(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
