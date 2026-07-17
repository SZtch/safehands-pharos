// ─── SafeHands starter: gate your agent's actions before it signs ──────────
//
// This is the smallest realistic integration. Your agent decides WHAT it wants
// to do; SafeHands decides whether that action is safe; your agent signs only
// when the verdict says so. SafeHands never holds keys and never signs: it
// verifies, your wallet executes.
//
//   npm install safehands-pharos
//   npx tsx safe-agent.ts
//
// Everything here is deterministic and offline (no RPC, no keys). Full field
// reference: the ActionPolicyInput type, and docs/DECISION_CONTRACT.md.
// ───────────────────────────────────────────────────────────────────────────

import { evaluateActionPolicy, explainPolicyResult } from "safehands-pharos";
import type { ActionPolicyInput } from "safehands-pharos";

// The one function you actually add to your agent. Call it right before you
// would sign. It returns true only on a clean ALLOW; anything else (BLOCK, or a
// confirmation/funding/review requirement) means do not sign automatically.
function safeToSign(action: ActionPolicyInput): boolean {
  const verdict = evaluateActionPolicy(action);
  console.log(`\n• ${describe(action)}`);
  console.log(`  verdict: ${verdict.decision} (risk ${verdict.riskLevel})`);
  if (verdict.reasons.length) console.log(`  why: ${verdict.reasons.join("; ")}`);
  if (verdict.requiredActions.length) console.log(`  to proceed: ${verdict.requiredActions.join("; ")}`);
  return verdict.safeToExecute;
}

function describe(a: ActionPolicyInput): string {
  if (a.actionType === "approve_token") return `approve ${a.approvalUnlimited ? "UNLIMITED" : a.approvalAmount} ${a.approvalToken} to ${a.spender}`;
  if (a.actionType === "execute_swap") return `swap ${a.amount} ${a.tokenIn} -> ${a.tokenOut}`;
  if (a.actionType === "send_payment") return `pay ${a.amount} ${a.amountUnit} to ${a.recipient}`;
  return a.actionType;
}

// Stand-in for your real signer. Reached ONLY when SafeHands allows the action.
function signAndBroadcast(action: ActionPolicyInput): void {
  console.log(`  -> signing and broadcasting (${describe(action)})`);
}

// ── your agent's loop ──────────────────────────────────────────────────────
// A few things the agent wants to do this turn. In a real agent these come from
// the model's plan; here they are fixed so the contrast is visible.
const plannedActions: ActionPolicyInput[] = [
  { actionType: "execute_swap", chainId: 1672, tokenIn: "USDC", tokenOut: "WPROS", amount: "10", amountUnit: "USDC" },
  { actionType: "approve_token", chainId: 1672, approvalToken: "USDC", spender: "0x000000000000000000000000000000000000dEaD", approvalUnlimited: true },
  { actionType: "send_payment", chainId: 1672, amount: "5", amountUnit: "USDC", recipient: "0x1111111111111111111111111111111111111111" },
];

console.log("SafeHands starter: consulting the firewall before every signature.\n");
console.log("SafeHands advises; this agent enforces by only signing on a clean ALLOW.");

for (const action of plannedActions) {
  if (safeToSign(action)) {
    signAndBroadcast(action);
  } else {
    console.log("  -> held back: not signing this one.");
  }
}

console.log("\nDone. Notice the agent signed only what SafeHands cleared.");
console.log("The full report for any single action is in explainPolicyResult():");
console.log(explainPolicyResult(evaluateActionPolicy(plannedActions[1])).split("\n")[0]);
