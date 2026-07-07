// ─── Agent Arena — SafeHands Agent Demo ───────────────────────
// Runs all Agent Arena scenarios against one Live SafeHands Agent and prints
// each verdict plus the caller's obligation.
// Live Execution: Reads live from Pharos Pacific Mainnet RPC and DODO API.
// Run: npx tsx examples/agent-arena/guardian-agent-demo.ts
// ────────────────────────────────────────────────────────────────────────

import { encodeFunctionData } from "viem";
import { createGuardianAgent, runScenario, OBLIGATION_CONTRACT } from "../../src/agent/index.js";

// Force Mainnet environment for Hackathon Phase 2 Demo
process.env.SAFEHANDS_NETWORK = "pacific-mainnet";


const APPROVE_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
const approveData = (spender: `0x${string}`, amount: bigint) => encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, amount] });

const USDC = "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
const UNKNOWN_SPENDER = "0x0000000000000000000000000000000000000abc";
const MAX_UINT256 = 2n ** 256n - 1n;

async function main() {
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  SafeHands Agent — Agent Arena Demo (LIVE MAINNET)");
  console.log("  [Pharos Pacific Mainnet | Real RPC | Real DODO API]");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("\nAgent-to-Agent obligation contract:");
  for (const [decision, spec] of Object.entries(OBLIGATION_CONTRACT)) {
    console.log(`  ${decision.padEnd(20)} → ${spec.obligation}`);
  }

  const agent = createGuardianAgent();

  await runScenario(agent, "Payment Agent · x402 (safe, small)", {
    url: "https://api.example.com/paid-resource",
    paymentAmountUsdc: "0.001",
  });
  await runScenario(agent, "Payment Agent · x402 (localhost SSRF)", {
    url: "http://localhost:8545/paid",
    paymentAmountUsdc: "0.001",
  });
  await runScenario(agent, "DeFi Agent · unlimited USDC approval to unknown spender", {
    to: USDC,
    token: USDC,
    data: approveData(UNKNOWN_SPENDER, MAX_UINT256),
  });
  await runScenario(agent, "Treasury Agent · Safe execTransaction", {
    to: "0x0000000000000000000000000000000000005afe",
    data: "0x6a761202" + "00".repeat(4),
  });
  await runScenario(agent, "User Agent · raw unknown contract call", {
    to: "0x1111111111111111111111111111111111111111",
    data: "0xdeadbeef",
  });
  await runScenario(agent, "User Agent · plain native transfer", {
    to: "0x000000000000000000000000000000000000beef",
    value: "1000000000000000",
  });
  await runScenario(agent, "User Agent · risk explanation question", {
    text: "Why is an unlimited approval risky?",
  });

  console.log("\n✅ SafeHands Agent demo complete — Enriched using live Mainnet data.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
