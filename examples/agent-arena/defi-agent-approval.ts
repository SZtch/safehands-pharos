// ─── Agent Arena — DeFi Agent (ERC-20 approval) ────────────────────────
// A DeFi Agent wants to grant an UNLIMITED USDC approval to an unknown spender.
// SafeHands decodes the approve() calldata and BLOCKs the unlimited grant.
// Live Execution: Reads live from Pharos Pacific Mainnet RPC and DODO API.
// Run: npx tsx examples/agent-arena/defi-agent-approval.ts
// ────────────────────────────────────────────────────────────────────────

import { encodeFunctionData } from "viem";
import { createGuardianAgent } from "../../src/agent/index.js";

// Force Mainnet environment for Hackathon Phase 2 Demo
process.env.SAFEHANDS_NETWORK = "pacific-mainnet";


const APPROVE_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
const approveData = (spender: `0x${string}`, amount: bigint) => encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, amount] });

const USDC = "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
const UNKNOWN_SPENDER = "0x0000000000000000000000000000000000000abc";
const MAX_UINT256 = 2n ** 256n - 1n;

let failures = 0;
function expect(name: string, actual: string, allowed: string[]) {
  const ok = allowed.includes(actual);
  console.log(`${ok ? "✔" : "✘"} ${name}: got ${actual}, expected ${allowed.join(" | ")}`);
  if (!ok) failures++;
}

async function main() {
  const agent = createGuardianAgent();

  // Scenario B — unlimited approval to an unknown spender → BLOCK.
  const unlimited = await agent.checkForAgent("defi-agent", {
    to: USDC,
    token: USDC,
    data: approveData(UNKNOWN_SPENDER, MAX_UINT256),
  });
  console.log(`intent=${unlimited.intent} summary="${unlimited.summary}"`);
  expect("unlimited→unknown", unlimited.decision, ["BLOCK"]);
  expect("  caller obligation", unlimited.caller.obligation, ["stop"]);

  // Contrast — a small, finite approval is safe; execution disabled → PREPARE_ONLY.
  const limited = await agent.check({ to: USDC, token: USDC, data: approveData(UNKNOWN_SPENDER, 1000n) });
  expect("limited→unknown", limited.decision, ["REQUIRE_CONFIRMATION"]); // unknown spender still needs confirmation

  expect("read-only", String(unlimited.readOnly), ["true"]);
  expect("execution disabled", String(unlimited.executionAvailable), ["false"]);

  console.log(failures === 0 ? "\n✅ defi-agent-approval: all expectations met" : `\n❌ ${failures} expectation(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
