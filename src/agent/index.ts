// ─── SafeHands — Public Surface ───────────────────────────────
// The read-only SafeHands Agent (decision contract + analyzers + read-only
// handlers; no signer, no keys) PLUS the SafeHands Operator — the "Complete
// Agent" that adds the real-data Enrich step and a gated Act arm
// (Perceive → Enrich → Decide → Act → Attest → Report). The Operator never
// bypasses a gate and holds no keys; execution is delegated to the gated tools.
// ────────────────────────────────────────────────────────────────────────

export * from "./agentIntentClassifier.js";
export * from "./agentPolicyResolver.js";
export * from "./agentToolRouter.js";
export * from "./agentDecisionFormatter.js";
export * from "./agentRuntime.js";
export * from "./SafeHandsGuardianAgent.js";
export * from "./agentEnrich.js";
export * from "./guardianOperator.js";
