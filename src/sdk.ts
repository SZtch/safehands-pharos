// ─── SafeHands SDK — programmatic entrypoint ───────────────────────────────
// Side-effect-free barrel for embedding SafeHands' deterministic policy/risk
// engine in your own code. Importing this module NEVER starts the MCP server and
// NEVER reads a wallet/key — that behaviour lives only in the `safehands` CLI bin
// (dist/index.js). package.json `main`/`types`/`exports` point HERE so that
//   import { evaluateActionPolicy } from "safehands-pharos"
// resolves to real, callable exports (previously it resolved to the MCP bootstrap,
// which has no named exports and would have started a stdio server on import).
// ───────────────────────────────────────────────────────────────────────────

// Deterministic action-policy engine — ALLOW / BLOCK / REQUIRE_CONFIRMATION /
// REQUIRE_FUNDING / REQUIRE_TOKEN_REVIEW before any agent action.
export {
  evaluateActionPolicy,
  explainPolicyResult,
  isUnlimitedApprovalAmount,
  parseTokenAmountToUnits,
} from "./lib/policy/actionPolicyEngine.js";
export type {
  ActionPolicyInput,
  ActionPolicyResult,
  PolicyDecision,
  PolicyRiskLevel,
  PolicyCheck,
  SafeHandsActionType,
} from "./lib/policy/actionPolicyEngine.js";

// Write-execution gate — halts a direct write tool on ANY non-ALLOW decision.
export { enforceWriteDecision } from "./lib/policy/writeExecutionGate.js";
export type { EnforceWriteDecisionOptions } from "./lib/policy/writeExecutionGate.js";

// 5-dimension risk engine (liquidity / slippage / counterparty / balance / market).
export { assessRisk } from "./lib/riskEngine.js";
export type {
  RiskAssessment,
  RiskInput,
  RiskBreakdown,
  RiskLevel,
  RiskRecommendation,
} from "./lib/riskEngine.js";

// Token-security (GoPlus) fail-closed gate used on the execute path.
export { evaluateTokenSecurityGate } from "./tools/checkTokenSecurity.js";
export type { TokenSecurityGateResult, TokenSecurityVerdict } from "./tools/checkTokenSecurity.js";

// Structured tool-response envelope shared by every SafeHands surface.
export { ok, fail, errorMessage } from "./lib/toolResponse.js";
export type { ToolResponse, ToolSuccess, ToolFailure, ToolError } from "./lib/toolResponse.js";

// Honest capability flags + network / safety-gate posture (read-only by default).
export {
  getCapabilityFlags,
  getActiveNetworkConfig,
  getGates,
  isReadOnlyMode,
  isExecutionAvailable,
  writeToolsEnabled,
} from "./lib/config.js";
export type { CapabilityFlags, SafetyGates, ActiveNetworkConfig } from "./lib/config.js";

// Network identity constants (Pharos Pacific Mainnet, chain 1672).
export { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET } from "./lib/constants.js";
