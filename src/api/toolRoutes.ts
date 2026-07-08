// ─── SafeHands Tool Gateway API ────────────────────────────────────────
// Optional HTTP bridge for the same 33 tools exposed through MCP/Anvita.
// This does not replace MCP; it lets a hosted deployment expose every tool at
// POST /tools/:toolName when the operator intentionally enables the API.
// Write tools remain protected by the same env gates used by MCP handlers.
// ────────────────────────────────────────────────────────────────────────

import { fail, ok, productionSafeMessage, type ToolResponse } from "../lib/toolResponse.js";

import { handleAssessRisk } from "../tools/assessRisk.js";
import { handleSimulateTransaction } from "../tools/simulateTransaction.js";
import { handleGetExecutionHistory } from "../tools/getExecutionHistory.js";
import { handleGetTokenPrice } from "../tools/getTokenPrice.js";
import { handleGetWalletBalance } from "../tools/getWalletBalance.js";
import { handleCheckAllowance } from "../tools/checkAllowance.js";
import { handleGetTransactionStatus } from "../tools/getTransactionStatus.js";
import { handleEstimateGas } from "../tools/estimateGas.js";
import { handlePublishRiskScore } from "../tools/publishRiskScore.js";
import { handleQueryRiskRegistry } from "../tools/queryRiskRegistry.js";
import { handleVerifyRiskInclusion } from "../tools/verifyRiskInclusion.js";
import { handleGetAgentReputation } from "../tools/getAgentReputation.js";
import { handleGetGasPrice } from "../tools/getGasPrice.js";
import { handleGetPoolInfo } from "../tools/getPoolInfo.js";
import { handleQueryGoldsky } from "../tools/queryGoldsky.js";
import { handleGetSpvProof } from "../tools/getSpvProof.js";
import { handleCheckTokenSecurity } from "../tools/checkTokenSecurity.js";
import { handleCreateAgentWallet } from "../tools/createAgentWallet.js";
import { handleSafeHandsPreflightCheck } from "../tools/safehandsPreflightCheck.js";
import { handleSafeHandsSafeExecute } from "../tools/safehandsSafeExecute.js";
import { handleSafeHandsWalletHealth } from "../tools/safehandsWalletHealth.js";
import { handleSafeHandsX402Preflight } from "../tools/safehandsX402Preflight.js";
import { handleSafeHandsRiskReport } from "../tools/safehandsRiskReport.js";
import { handleExplainRisk } from "../tools/explainRisk.js";
import { handleTokenRegistryStatus } from "../tools/tokenRegistryStatus.js";
import { handleGetAgentWallet } from "../tools/getAgentWallet.js";
import { handleGetAgentWalletBalance } from "../tools/getAgentWalletBalance.js";
import { handleGetAgentPolicy } from "../tools/getAgentPolicy.js";
import { handleSetAgentPolicy } from "../tools/setAgentPolicy.js";
import { handleExecuteSwap } from "../tools/executeSwap.js";
import { handleSendPayment } from "../tools/sendPayment.js";
import { handleApproveToken } from "../tools/approveToken.js";
import { handleX402PayAndFetch } from "../tools/x402PayAndFetch.js";
import { auditLog } from "../lib/auditLog.js";

type ToolHandler = (params: any) => Promise<unknown> | unknown;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  safehands_preflight_check: handleSafeHandsPreflightCheck,
  safehands_safe_execute: handleSafeHandsSafeExecute,
  execute_swap: handleExecuteSwap,
  send_payment: handleSendPayment,
  approve_token: handleApproveToken,
  x402_pay_and_fetch: handleX402PayAndFetch,
  safehands_wallet_health: handleSafeHandsWalletHealth,
  safehands_x402_preflight: handleSafeHandsX402Preflight,
  safehands_risk_report: handleSafeHandsRiskReport,
  explain_risk: handleExplainRisk,
  token_registry_status: handleTokenRegistryStatus,
  assess_risk: handleAssessRisk,
  simulate_transaction: handleSimulateTransaction,
  get_execution_history: handleGetExecutionHistory,
  get_token_price: handleGetTokenPrice,
  get_wallet_balance: handleGetWalletBalance,
  check_allowance: handleCheckAllowance,
  get_transaction_status: handleGetTransactionStatus,
  estimate_gas: handleEstimateGas,
  publish_risk_score: handlePublishRiskScore,
  query_risk_registry: handleQueryRiskRegistry,
  verify_risk_inclusion: handleVerifyRiskInclusion,
  get_agent_reputation: handleGetAgentReputation,
  get_gas_price: handleGetGasPrice,
  get_pool_info: handleGetPoolInfo,
  query_goldsky_subgraph: handleQueryGoldsky,
  get_spv_proof: handleGetSpvProof,
  check_token_security: handleCheckTokenSecurity,
  get_agent_policy: handleGetAgentPolicy,
  set_agent_policy: handleSetAgentPolicy,
  create_agent_wallet: handleCreateAgentWallet,
  get_agent_wallet: handleGetAgentWallet,
  get_agent_wallet_balance: handleGetAgentWalletBalance,
};

const WRITE_TOOLS = new Set([
  "safehands_safe_execute",
  "execute_swap",
  "send_payment",
  "approve_token",
  "x402_pay_and_fetch",
  "publish_risk_score",
  "set_agent_policy",
  "create_agent_wallet",
]);

/** True for state-changing tools (execution / disk-writing). Used by the HTTP
 * layer to require authentication before a write tool can run over an open origin. */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

function isToolResponse(value: unknown): value is ToolResponse<unknown> {
  return !!value && typeof value === "object" && "success" in value && "timestamp" in value && "error" in value;
}

export function listHostedTools() {
  const names = Object.keys(TOOL_HANDLERS).sort();
  return {
    count: names.length,
    tools: names.map((name) => ({
      name,
      write: WRITE_TOOLS.has(name),
      enabled: !WRITE_TOOLS.has(name) || process.env.WRITE_TOOLS_ENABLED === "true",
    })),
  };
}

export async function invokeHostedTool(toolName: string, params: unknown): Promise<ToolResponse<unknown>> {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return fail("UNKNOWN_TOOL", `Unknown SafeHands tool '${toolName}'.`, false, "tool_gateway");
  }

  if (WRITE_TOOLS.has(toolName) && process.env.WRITE_TOOLS_ENABLED !== "true") {
    return fail(
      "WRITE_TOOLS_DISABLED",
      `${toolName} is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted full-enabled deployments.`,
      false,
      "tool_gateway",
    );
  }

  const start = Date.now();
  try {
    const result = await handler(params ?? {});
    auditLog({
      ts: new Date().toISOString(),
      tool: `http:${toolName}`,
      success: isToolResponse(result) ? result.success : true,
      errorCode: isToolResponse(result) && !result.success ? result.error.code : undefined,
      durationMs: Date.now() - start,
    });
    return isToolResponse(result) ? result : ok(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditLog({
      ts: new Date().toISOString(),
      tool: `http:${toolName}`,
      success: false,
      errorCode: "TOOL_EXECUTION_FAILED",
      durationMs: Date.now() - start,
    });
    return fail("TOOL_EXECUTION_FAILED", productionSafeMessage(message, "Tool execution failed."), false, toolName);
  }
}
