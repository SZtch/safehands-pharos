// ─── SafeHands Skill Engine CLI Adapter ────────────────────────────────
// Terminal entrypoint used by Pharos Skill Engine reference files.
// It calls the same tool handlers as MCP registration and prints the
// standard SafeHands response envelope as JSON.
// ────────────────────────────────────────────────────────────────────────

import { fail, ok, type ToolResponse } from "./lib/toolResponse.js";
import { handleSafeHandsPreflightCheck } from "./tools/safehandsPreflightCheck.js";
import { handleSafeHandsX402Preflight } from "./tools/safehandsX402Preflight.js";
import { handleSafeHandsWalletHealth } from "./tools/safehandsWalletHealth.js";
import { handleTokenRegistryStatus } from "./tools/tokenRegistryStatus.js";
import { handleExplainRisk } from "./tools/explainRisk.js";
import { handleSafeHandsRiskReport } from "./tools/safehandsRiskReport.js";
import { handleSafeHandsSafeExecute } from "./tools/safehandsSafeExecute.js";
import { handleCreateAgentWallet } from "./tools/createAgentWallet.js";
import { handleGetAgentWallet } from "./tools/getAgentWallet.js";
import { handleGetAgentWalletBalance } from "./tools/getAgentWalletBalance.js";
import { handleCheckTokenSecurity } from "./tools/checkTokenSecurity.js";
import { handleAssessRisk } from "./tools/assessRisk.js";
import { handleGetWalletBalance } from "./tools/getWalletBalance.js";
import { handleSimulateTransaction } from "./tools/simulateTransaction.js";
import { handleEstimateGas } from "./tools/estimateGas.js";
import { handleGetTokenPrice } from "./tools/getTokenPrice.js";
import { handleGetTransactionStatus } from "./tools/getTransactionStatus.js";
import { handleQueryRiskRegistry } from "./tools/queryRiskRegistry.js";
import { handlePublishRiskScore } from "./tools/publishRiskScore.js";
import { handleExecuteSwap } from "./tools/executeSwap.js";
import { handleSendPayment } from "./tools/sendPayment.js";
import { handleApproveToken } from "./tools/approveToken.js";
import { handleX402PayAndFetch } from "./tools/x402PayAndFetch.js";
import { handleGetGasPrice } from "./tools/getGasPrice.js";
import { handleGetPoolInfo } from "./tools/getPoolInfo.js";
import { handleGetExecutionHistory } from "./tools/getExecutionHistory.js";
import { handleCheckAllowance } from "./tools/checkAllowance.js";
import { handleGetAgentPolicy } from "./tools/getAgentPolicy.js";
import { handleSetAgentPolicy } from "./tools/setAgentPolicy.js";

export type SkillCliToolName =
  | "safehands_preflight_check"
  | "safehands_x402_preflight"
  | "safehands_wallet_health"
  | "token_registry_status"
  | "explain_risk"
  | "safehands_risk_report"
  | "safehands_safe_execute"
  | "create_agent_wallet"
  | "get_agent_wallet"
  | "get_agent_wallet_balance"
  | "check_token_security"
  | "assess_risk"
  | "get_wallet_balance"
  | "simulate_transaction"
  | "estimate_gas"
  | "get_token_price"
  | "get_transaction_status"
  | "query_risk_registry"
  | "publish_risk_score"
  | "execute_swap"
  | "send_payment"
  | "approve_token"
  | "x402_pay_and_fetch"
  | "get_gas_price"
  | "get_pool_info"
  | "get_execution_history"
  | "check_allowance"
  | "get_agent_policy"
  | "set_agent_policy";

type SkillCliHandler = (input: any) => Promise<unknown>;

const SKILL_CLI_TOOLS: Record<SkillCliToolName, SkillCliHandler> = {
  safehands_preflight_check: handleSafeHandsPreflightCheck,
  safehands_x402_preflight: handleSafeHandsX402Preflight,
  safehands_wallet_health: handleSafeHandsWalletHealth,
  token_registry_status: handleTokenRegistryStatus,
  explain_risk: handleExplainRisk,
  safehands_risk_report: handleSafeHandsRiskReport,
  safehands_safe_execute: handleSafeHandsSafeExecute,
  create_agent_wallet: handleCreateAgentWallet,
  get_agent_wallet: handleGetAgentWallet,
  get_agent_wallet_balance: handleGetAgentWalletBalance,
  check_token_security: handleCheckTokenSecurity,
  assess_risk: handleAssessRisk,
  get_wallet_balance: handleGetWalletBalance,
  simulate_transaction: handleSimulateTransaction,
  estimate_gas: handleEstimateGas,
  get_token_price: handleGetTokenPrice,
  get_transaction_status: handleGetTransactionStatus,
  query_risk_registry: handleQueryRiskRegistry,
  publish_risk_score: handlePublishRiskScore,
  execute_swap: handleExecuteSwap,
  send_payment: handleSendPayment,
  approve_token: handleApproveToken,
  x402_pay_and_fetch: handleX402PayAndFetch,
  get_gas_price: handleGetGasPrice,
  get_pool_info: handleGetPoolInfo,
  get_execution_history: handleGetExecutionHistory,
  check_allowance: handleCheckAllowance,
  get_agent_policy: handleGetAgentPolicy,
  set_agent_policy: handleSetAgentPolicy,
};

function isStructuredResponse(value: unknown): value is ToolResponse<unknown> {
  return !!value && typeof value === "object" && "success" in value && "data" in value && "error" in value && "timestamp" in value;
}

function printJson(response: ToolResponse<unknown>) {
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

function usage(): string {
  const tools = Object.keys(SKILL_CLI_TOOLS).sort().join(", ");
  return [
    "Usage: npx safehands-pharos skill <tool_name> [<json> | --input-json '<json>' | -i '<json>']",
    "",
    `Supported Skill Engine tools: ${tools}`,
    "",
    "Examples:",
    "  npx safehands-pharos skill assess_risk '{\"action\":\"swap\",\"amount\":\"0.01\"}'",
    "  npx safehands-pharos skill get_wallet_balance '{\"walletAddress\":\"0xABC...\"}'",
    "  npx safehands-pharos skill safehands_preflight_check -i '{\"actionType\":\"approve_token\",\"chainId\":688689,\"amount\":\"1\"}'",
  ].join("\n");
}

function readInputJsonArg(argv: string[]): string | null {
  // --input-json <json>
  const flag = argv.indexOf("--input-json");
  if (flag >= 0) return argv[flag + 1] ?? null;
  // --input-json=<json>
  const inline = argv.find((a) => a.startsWith("--input-json="));
  if (inline) return inline.slice("--input-json=".length);
  // -i <json>
  const short = argv.indexOf("-i");
  if (short >= 0) return argv[short + 1] ?? null;
  // positional: first arg that looks like JSON or is not a flag
  const positional = argv.find((a) => !a.startsWith("-"));
  return positional ?? null;
}

export function getSkillCliToolNames(): string[] {
  return Object.keys(SKILL_CLI_TOOLS).sort();
}

export async function invokeSkillCliTool(toolName: string, input: unknown): Promise<ToolResponse<unknown>> {
  const handler = SKILL_CLI_TOOLS[toolName as SkillCliToolName];
  if (!handler) {
    return fail(
      "UNKNOWN_SKILL_TOOL",
      `Unknown SafeHands Skill Engine tool: ${toolName}. Supported tools: ${getSkillCliToolNames().join(", ")}`,
      false,
      "safehands_cli"
    );
  }

  try {
    const result = await handler(input);
    if (isStructuredResponse(result)) return result;
    return ok(result);
  } catch (err) {
    return fail(
      "TOOL_EXECUTION_FAILED",
      err instanceof Error ? err.message : String(err),
      false,
      toolName
    );
  }
}

export async function runSkillCli(argv: string[]): Promise<number> {
  const [toolName] = argv;
  if (!toolName || toolName === "--help" || toolName === "-h") {
    printJson(fail("CLI_USAGE_ERROR", usage(), false, "safehands_cli"));
    return 2;
  }

  if (!SKILL_CLI_TOOLS[toolName as SkillCliToolName]) {
    printJson(await invokeSkillCliTool(toolName, {}));
    return 2;
  }

  const rawJson = readInputJsonArg(argv.slice(1));
  if (rawJson === null) {
    printJson(fail("MISSING_INPUT_JSON", "Missing required --input-json '<json>' argument.", false, "safehands_cli"));
    return 2;
  }

  let input: unknown;
  try {
    input = JSON.parse(rawJson);
  } catch (err) {
    printJson(fail("INVALID_INPUT_JSON", err instanceof Error ? err.message : String(err), false, "safehands_cli"));
    return 2;
  }

  printJson(await invokeSkillCliTool(toolName, input));
  return 0;
}
