// ─── Agent Arena: Treasury Agent (Safe / MultiSend) ───────────────────
// A Treasury Agent asks SafeHands to vet a Safe/MultiSend transaction before a
// multisig signs. Deep Safe/MultiSend decode is EXPERIMENTAL; SafeHands returns
// a clear, conservative verdict and marks the decode experimental.
// Offline/demo: no RPC, no keys, nothing is signed or executed.
// Run: npx tsx examples/agent-arena/treasury-agent-safe.ts
// ────────────────────────────────────────────────────────────────────────

import { encodePacked } from "viem";
import { createGuardianAgent } from "../../src/agent/index.js";

// Force Mainnet environment for Hackathon Phase 2 Demo
process.env.SAFEHANDS_NETWORK = "pacific-mainnet";


const MULTISEND_SELECTOR = "0x8d80ff0a";
const SAFE_EXEC_SELECTOR = "0x6a761202";

let failures = 0;
function expect(name: string, actual: string, allowed: string[]) {
  const ok = allowed.includes(actual);
  console.log(`${ok ? "✔" : "✘"} ${name}: got ${actual}, expected ${allowed.join(" | ")}`);
  if (!ok) failures++;
}

async function main() {
  const agent = createGuardianAgent();

  // A Safe execTransaction wrapper: recognized as a Safe tx; deep decode is
  // experimental, so SafeHands returns a conservative verdict + experimental flag.
  const safeExec = await agent.checkForAgent("treasury-agent", { to: "0x0000000000000000000000000000000000005afe", data: SAFE_EXEC_SELECTOR + "00".repeat(4) });
  console.log(`intent=${safeExec.intent} decision=${safeExec.decision} experimental=${safeExec.experimental}`);
  console.log(`summary="${safeExec.summary}"`);
  expect("safe tx classified", safeExec.intent, ["safe_transaction"]);
  expect("conservative verdict", safeExec.decision, ["REQUIRE_CONFIRMATION", "BLOCK", "PREPARE_ONLY"]);
  expect("decode is experimental", String(safeExec.experimental), ["true"]);

  // A packed MultiSend batch (operation+to+value+dataLen+data) is decoded
  // (experimental) and the worst inner action drives the verdict.
  const inner = encodePacked(
    ["uint8", "address", "uint256", "uint256"],
    [0, "0x0000000000000000000000000000000000001234", 0n, 0n],
  );
  const batch = (MULTISEND_SELECTOR + "00".repeat(0) + inner.slice(2)) as string;
  const multi = await agent.check({ data: batch });
  console.log(`multiSend intent=${multi.intent} decision=${multi.decision} experimental=${multi.experimental}`);
  expect("multiSend classified", multi.intent, ["safe_transaction"]);
  expect("multiSend has a verdict", multi.decision, ["ALLOW", "REQUIRE_CONFIRMATION", "BLOCK", "PREPARE_ONLY"]);

  expect("read-only", String(safeExec.readOnly), ["true"]);
  expect("execution disabled", String(safeExec.executionAvailable), ["false"]);

  console.log(failures === 0 ? "\n✅ treasury-agent-safe: all expectations met" : `\n❌ ${failures} expectation(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
