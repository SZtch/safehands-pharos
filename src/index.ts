#!/usr/bin/env node
// ─── SafeHands MCP Server ──────────────────────────────────────────────
// Entry point — registers 27 tools (17 legacy/core + 3 managed wallet + 7 SafeHands guardrail tools) and starts the MCP server.
// ────────────────────────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { assessRiskSchema, handleAssessRisk } from "./tools/assessRisk.js";
import { executeSwapSchema, handleExecuteSwap } from "./tools/executeSwap.js";
import { sendPaymentSchema, handleSendPayment } from "./tools/sendPayment.js";
import { simulateTransactionSchema, handleSimulateTransaction } from "./tools/simulateTransaction.js";
import { getExecutionHistorySchema, handleGetExecutionHistory } from "./tools/getExecutionHistory.js";
import { getTokenPriceSchema, handleGetTokenPrice } from "./tools/getTokenPrice.js";
import { getWalletBalanceSchema, handleGetWalletBalance } from "./tools/getWalletBalance.js";
import { checkAllowanceSchema, handleCheckAllowance } from "./tools/checkAllowance.js";
import { getTransactionStatusSchema, handleGetTransactionStatus } from "./tools/getTransactionStatus.js";
import { estimateGasSchema, handleEstimateGas } from "./tools/estimateGas.js";
import { publishRiskScoreSchema, handlePublishRiskScore } from "./tools/publishRiskScore.js";
import { queryRiskRegistrySchema, handleQueryRiskRegistry } from "./tools/queryRiskRegistry.js";
import { approveTokenSchema, handleApproveToken } from "./tools/approveToken.js";
import { getGasPriceSchema, handleGetGasPrice } from "./tools/getGasPrice.js";
import { getPoolInfoSchema, handleGetPoolInfo } from "./tools/getPoolInfo.js";
import { checkTokenSecuritySchema, handleCheckTokenSecurity } from "./tools/checkTokenSecurity.js";
import { x402PayAndFetchSchema, handleX402PayAndFetch } from "./tools/x402PayAndFetch.js";
import { createAgentWalletSchema, handleCreateAgentWallet } from "./tools/createAgentWallet.js";
import { safehandsPreflightCheckSchema, handleSafeHandsPreflightCheck } from "./tools/safehandsPreflightCheck.js";
import { safehandsSafeExecuteSchema, handleSafeHandsSafeExecute } from "./tools/safehandsSafeExecute.js";
import { safehandsWalletHealthSchema, handleSafeHandsWalletHealth } from "./tools/safehandsWalletHealth.js";
import { safehandsX402PreflightSchema, handleSafeHandsX402Preflight } from "./tools/safehandsX402Preflight.js";
import { safehandsRiskReportSchema, handleSafeHandsRiskReport } from "./tools/safehandsRiskReport.js";
import { explainRiskSchema, handleExplainRisk } from "./tools/explainRisk.js";
import { tokenRegistryStatusSchema, handleTokenRegistryStatus } from "./tools/tokenRegistryStatus.js";
import { getAgentWalletSchema, handleGetAgentWallet } from "./tools/getAgentWallet.js";
import { getAgentWalletBalanceSchema, handleGetAgentWalletBalance } from "./tools/getAgentWalletBalance.js";
import { fail, ok } from "./lib/toolResponse.js";
import { auditLog } from "./lib/auditLog.js";
import { runSkillCli } from "./cli.js";
import { runDemo } from "./demo.js";
import { runInit } from "./init.js";


// ─── Per-tool rate limiting ────────────────────────────────────────────
// Heavy tools (block-scan history) get a tighter limit.
// Write tools get a moderate limit to prevent agent loops.
// All other tools share a generous global limit.

const HEAVY_TOOLS = new Set(["get_execution_history"]);
const WRITE_TOOLS = new Set([
  "execute_swap", "send_payment", "approve_token",
  "publish_risk_score", "x402_pay_and_fetch", "safehands_safe_execute",
]);

const RATE_LIMITS: Record<string, number> = {
  heavy: parseInt(process.env.MCP_RATE_LIMIT_HEAVY || "5", 10),
  write: parseInt(process.env.MCP_RATE_LIMIT_WRITE || "15", 10),
  default: parseInt(process.env.MCP_RATE_LIMIT_DEFAULT || "120", 10),
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkMcpRateLimit(tool: string): string | null {
  const limit = HEAVY_TOOLS.has(tool) ? RATE_LIMITS.heavy
    : WRITE_TOOLS.has(tool) ? RATE_LIMITS.write
    : RATE_LIMITS.default;
  const now = Date.now();
  let bucket = rateBuckets.get(tool);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + 60_000 };
  }
  bucket.count++;
  rateBuckets.set(tool, bucket);
  if (bucket.count > limit) {
    return `Rate limit exceeded for ${tool} (${limit}/min). Slow down and retry after ${Math.ceil((bucket.resetAt - now) / 1000)}s.`;
  }
  return null;
}

function isStructuredResponse(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    "success" in value &&
    "timestamp" in value &&
    "error" in value
  );
}

async function invokeTool(handler: (params: any) => Promise<unknown>, params: unknown, source: string) {
  const rateLimitMsg = checkMcpRateLimit(source);
  if (rateLimitMsg) {
    auditLog({ ts: new Date().toISOString(), tool: source, success: false, errorCode: "RATE_LIMITED" });
    return fail("RATE_LIMITED", rateLimitMsg, true, source);
  }

  const start = Date.now();
  try {
    const result = await handler(params);
    if (isStructuredResponse(result)) {
      const r = result as { success: boolean; error?: { code?: string } | null };
      auditLog({ ts: new Date().toISOString(), tool: source, success: r.success, errorCode: r.success ? undefined : r.error?.code, durationMs: Date.now() - start });
      return result;
    }
    if (result && typeof result === "object") {
      if ("error" in result && !("success" in result)) {
        const msg = String((result as { error?: unknown }).error);
        auditLog({ ts: new Date().toISOString(), tool: source, success: false, errorCode: "TOOL_RETURNED_ERROR", durationMs: Date.now() - start });
        return fail("TOOL_RETURNED_ERROR", msg, false, source);
      }
      // Defense-in-depth: non-ToolResponse shapes with success:false must not surface as ok()
      if ("success" in result && (result as { success: unknown }).success === false) {
        const msg = "error" in result ? String((result as { error?: unknown }).error) : "Tool returned failure without ToolResponse shape";
        auditLog({ ts: new Date().toISOString(), tool: source, success: false, errorCode: "TOOL_RETURNED_ERROR", durationMs: Date.now() - start });
        return fail("TOOL_RETURNED_ERROR", msg, false, source);
      }
    }
    auditLog({ ts: new Date().toISOString(), tool: source, success: true, durationMs: Date.now() - start });
    return ok(result);
  } catch (err) {
    auditLog({ ts: new Date().toISOString(), tool: source, success: false, errorCode: "TOOL_EXECUTION_FAILED", durationMs: Date.now() - start });
    return fail(
      "TOOL_EXECUTION_FAILED",
      err instanceof Error ? err.message : String(err),
      false,
      source
    );
  }
}

function mcpText(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}


// ─── Pharos Skill Engine CLI Adapter ──────────────────────────────────

if (process.argv[2] === "skill") {
  try {
    const exitCode = await runSkillCli(process.argv.slice(3));
    process.exit(exitCode);
  } catch (error) {
    process.stdout.write(JSON.stringify(fail("CLI_FATAL_ERROR", error instanceof Error ? error.message : String(error), false, "safehands_cli"), null, 2) + "\n");
    process.exit(1);
  }
}

// ─── Interactive Setup Wizard ─────────────────────────────────────────

if (process.argv[2] === "init") {
  await runInit();
  process.exit(0);
}


// ─── Deterministic Demo CLI ───────────────────────────────────────────

if (process.argv.includes("--demo")) {
  await runDemo();
  // Brief delay allows libuv handles (express sockets) to close cleanly on Windows
  setTimeout(() => process.exit(0), 100);
  // Wait indefinitely so the script doesn't continue down to start the MCP server
  await new Promise(() => {});
}

// ─── CLI Help ──────────────────────────────────────────────────────────

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`
🛡️  SafeHands-Pharos — Transaction Safety Firewall for AI Agents
   v1.4.0 | Pharos Atlantic Testnet | Chain ID 688689

USAGE
  npx safehands-pharos
      Start SafeHands as an MCP server over stdio.

  npx safehands-pharos --help
      Show this help.

  npx safehands-pharos init
      Launch the interactive setup wizard to configure your .env file safely.

  npx safehands-pharos --demo
      Run the deterministic non-destructive hackathon demo.

  npx safehands-pharos skill <tool_name> --input-json '<json>'
      Run a Pharos Skill Engine-compatible SafeHands CLI tool.

POSITIONING
  SafeHands is a guardrail layer, not a generic Web3 toolbox.
  It checks whether an AI agent action is safe before execution.

  User intent
  → SafeHands preflight
  → ALLOW / WARN / BLOCK / REQUIRE_CONFIRMATION
  → Pharos Skill Engine or MCP execution only if safe
  → SafeHands risk report

SAFEHANDS BRANDED TOOLS
  safehands_preflight_check   Policy preflight for payments, approvals, swaps, x402, and custom calls
  safehands_safe_execute      Guarded wrapper that preflights before execution
  safehands_wallet_health     Wallet/signer/gas/x402 readiness report
  safehands_x402_preflight    URL, payment, token, and signer safety check before x402 payment
  safehands_risk_report       Human-readable judge/demo risk report
  explain_risk                Explain ALLOW/WARN/BLOCK decisions in plain English
  token_registry_status       Classify canonical, test, custom, unknown, or invalid token address

OTHER MCP TOOLS
  Core safety: assess_risk, check_token_security, simulate_transaction, estimate_gas
  Execution: execute_swap, send_payment, approve_token
  Market: get_token_price, get_pool_info, get_gas_price
  Wallet/history: get_wallet_balance, check_allowance, get_transaction_status, get_execution_history
  Risk registry: publish_risk_score, query_risk_registry
  x402: x402_pay_and_fetch
  Managed testnet wallet: create_agent_wallet, get_agent_wallet, get_agent_wallet_balance

PHAROS ATLANTIC TESTNET
  Environment: atlantic-testnet
  Chain ID: 688689
  RPC: https://atlantic.dplabs-internal.com
  Explorer: https://atlantic.pharosscan.xyz/
  RiskRegistry: 0x61962a6c812ee9f57b207e1ea47c19ae70bb7141

x402 BEHAVIOR
  Free endpoints, such as /supported and /health, do not require a private key.
  Paid endpoints are fetched normally first. Only after HTTP 402 does SafeHands run x402 preflight and request a signer.
  Signed payment payloads and payment headers are not logged or returned.

DEFAULT SAFETY
  WALLET_MODE=none
  WRITE_TOOLS_ENABLED=false
  ALLOW_UNLIMITED_APPROVAL=false
  ALLOW_LOCAL_X402_FETCH=false

  No wallet is created on install, import, or startup.
  Write tools are disabled by default.
  Unlimited approvals are blocked by default.
  Mainnet actions are blocked.
  SSRF-sensitive x402 URLs are blocked by default.

EXAMPLES
  npx safehands-pharos skill safehands_preflight_check --input-json '{"actionType":"send_payment","chainId":688689,"isMainnet":false,"amount":"0.001","recipient":"0x0000000000000000000000000000000000000001"}'

  npx safehands-pharos skill token_registry_status --input-json '{"tokenAddress":"0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8"}'

DOCS
  README.md
  skill/SKILL.md
`);
  process.exit(0);
}

// ─── Startup Validation ────────────────────────────────────────────────

const walletMode = process.env.WALLET_MODE || "none";
const hasManagedWalletMode = walletMode === "managed-testnet";
const hasExplicitSignerMode = walletMode === "managed-testnet" || walletMode === "env";

if (process.env.WRITE_TOOLS_ENABLED !== "true") {
  console.error("⚠️  SafeHands — write tools are disabled by default.");
  console.error("   Preflight, risk report, token registry, read-only, and x402 free endpoint checks remain available.");
  console.error("   To execute trusted testnet actions, set WRITE_TOOLS_ENABLED=true and configure a signer via WALLET_MODE=managed-testnet or WALLET_MODE=env.");
  console.error("");
} else if (!hasExplicitSignerMode) {
  console.error("⚠️  SafeHands — write tools enabled but no signer mode detected.");
  console.error("   Use WALLET_MODE=managed-testnet with create_agent_wallet, or WALLET_MODE=env for testnet developer mode.");
  console.error("");
}

// ─── Server Setup ──────────────────────────────────────────────────────

const server = new McpServer({
  name: "safehands",
  version: "1.4.0",
});

// ─── Tool Registration ─────────────────────────────────────────────────

server.tool(
  "safehands_preflight_check",
  "Run a SafeHands policy preflight before an AI agent sends payment, approves tokens, swaps, publishes risk data, or pays x402.",
  safehandsPreflightCheckSchema.shape,
  async (params) => mcpText(await invokeTool(handleSafeHandsPreflightCheck, params, "safehands_preflight_check"))
);

server.tool(
  "safehands_safe_execute",
  "Guarded execution wrapper: preflight first, then execute only allowed and explicitly confirmed testnet actions.",
  safehandsSafeExecuteSchema.shape,
  async (params) => mcpText(await invokeTool(handleSafeHandsSafeExecute, params, "safehands_safe_execute"))
);

server.tool(
  "safehands_wallet_health",
  "Check whether an AI agent wallet is funded, signer-ready, and safe to use on Pharos Atlantic Testnet.",
  safehandsWalletHealthSchema.shape,
  async (params) => mcpText(await invokeTool(handleSafeHandsWalletHealth, params, "safehands_wallet_health"))
);

server.tool(
  "safehands_x402_preflight",
  "Check an x402 paid resource for URL safety, payment amount, token, signer, and testnet policy before signing.",
  safehandsX402PreflightSchema.shape,
  async (params) => mcpText(await invokeTool(handleSafeHandsX402Preflight, params, "safehands_x402_preflight"))
);

server.tool(
  "safehands_risk_report",
  "Generate an audit-friendly human-readable SafeHands risk report for an AI agent action.",
  safehandsRiskReportSchema.shape,
  async (params) => mcpText(await invokeTool(handleSafeHandsRiskReport, params, "safehands_risk_report"))
);

server.tool(
  "explain_risk",
  "Explain a SafeHands risk/policy decision in human-readable language.",
  explainRiskSchema.shape,
  async (params) => mcpText(await invokeTool(handleExplainRisk, params, "explain_risk"))
);

server.tool(
  "token_registry_status",
  "Classify exact token input as canonical testnet token, test liquidity token, custom, unknown, or invalid.",
  tokenRegistryStatusSchema.shape,
  async (params) => mcpText(await invokeTool(handleTokenRegistryStatus, params, "token_registry_status"))
);

server.tool(
  "assess_risk",
  "Evaluate the risk of a planned on-chain action (swap or transfer). Returns 0-100 risk score with 5-dimension breakdown.",
  assessRiskSchema.shape,
  async (params) => mcpText(await invokeTool(handleAssessRisk, params, "assess_risk"))
);

server.tool(
  "execute_swap",
  "Swap tokens via FaroSwap with built-in risk gate. Runs risk assessment first, blocks if score > 80.",
  executeSwapSchema.shape,
  async (params) => mcpText(await invokeTool(handleExecuteSwap, params, "execute_swap"))
);

server.tool(
  "send_payment",
  "Send native PHRS with pre-flight validation. Checks address, balance, and warns on high exposure.",
  sendPaymentSchema.shape,
  async (params) => mcpText(await invokeTool(handleSendPayment, params, "send_payment"))
);

server.tool(
  "simulate_transaction",
  "Dry run a swap or transfer via eth_call — no gas spent. Returns expected output and revert reasons.",
  simulateTransactionSchema.shape,
  async (params) => mcpText(await invokeTool(handleSimulateTransaction, params, "simulate_transaction"))
);

server.tool(
  "get_execution_history",
  "Pull on-chain transaction history for a wallet. Filters by swap, transfer, or all.",
  getExecutionHistorySchema.shape,
  async (params) => mcpText(await invokeTool(handleGetExecutionHistory, params, "get_execution_history"))
);

server.tool(
  "get_token_price",
  "Fetch real-time price of PHRS, USDC, or USDT on Pharos using DODO liquidity quotes.",
  getTokenPriceSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetTokenPrice, params, "get_token_price"))
);

server.tool(
  "get_wallet_balance",
  "Return PHRS, USDC, USDT balances for a wallet with total USD estimate.",
  getWalletBalanceSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetWalletBalance, params, "get_wallet_balance"))
);

server.tool(
  "check_allowance",
  "Check ERC-20 token allowance for DODO swap approval. Returns whether approval is needed.",
  checkAllowanceSchema.shape,
  async (params) => mcpText(await invokeTool(handleCheckAllowance, params, "check_allowance"))
);

server.tool(
  "get_transaction_status",
  "Check on-chain transaction status by hash. Returns status, block, gas, and explorer link.",
  getTransactionStatusSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetTransactionStatus, params, "get_transaction_status"))
);

server.tool(
  "estimate_gas",
  "Estimate gas cost for a swap or transfer before executing. Returns cost in PHRS and USD.",
  estimateGasSchema.shape,
  async (params) => mcpText(await invokeTool(handleEstimateGas, params, "estimate_gas"))
);

server.tool(
  "publish_risk_score",
  "Run risk assessment and publish result to the on-chain RiskRegistry. Other agents can query it.",
  publishRiskScoreSchema.shape,
  async (params) => mcpText(await invokeTool(handlePublishRiskScore, params, "publish_risk_score"))
);

server.tool(
  "query_risk_registry",
  "Query the on-chain RiskRegistry for a wallet's published risk score. Read-only, no private key needed.",
  queryRiskRegistrySchema.shape,
  async (params) => mcpText(await invokeTool(handleQueryRiskRegistry, params, "query_risk_registry"))
);

server.tool(
  "approve_token",
  "Approve ERC-20 token spending for FaroSwap (DODO) router. Required before swapping non-native tokens.",
  approveTokenSchema.shape,
  async (params) => mcpText(await invokeTool(handleApproveToken, params, "approve_token"))
);

server.tool(
  "get_gas_price",
  "Get current gas price on Pharos with trend classification and cost estimates.",
  getGasPriceSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetGasPrice, params, "get_gas_price"))
);

server.tool(
  "get_pool_info",
  "Fetch DODO liquidity pool info for a token pair on Pharos. Returns price ratio, impact, and fees.",
  getPoolInfoSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetPoolInfo, params, "get_pool_info"))
);
server.tool(
  "check_token_security",
  "Check token contract security (honeypot, mintable, ownership privileges, tax) via GoPlus Security API.",
  checkTokenSecuritySchema.shape,
  async (params) => mcpText(await invokeTool(handleCheckTokenSecurity, params, "check_token_security"))
);

server.tool(
  "x402_pay_and_fetch",
  "Fetch resources from an HTTP x402 payment-gated server. Automatically handles HTTP 402 payment challenge.",
  x402PayAndFetchSchema.shape,
  async (params) => mcpText(await invokeTool(handleX402PayAndFetch, params, "x402_pay_and_fetch"))
);

// ─── Managed Wallet Tools ──────────────────────────────────────────────

server.tool(
  "create_agent_wallet",
  "Create a new managed testnet agent wallet. Private key is encrypted and never returned. Fund the wallet with testnet PHRS before using write tools.",
  createAgentWalletSchema.shape,
  async (params) => mcpText(await invokeTool(handleCreateAgentWallet, params, "create_agent_wallet"))
);
server.tool(
  "get_agent_wallet",
  "Get public info (address, environment, chainId) for a managed agent wallet. Never returns private key.",
  getAgentWalletSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetAgentWallet, params, "get_agent_wallet"))
);
server.tool(
  "get_agent_wallet_balance",
  "Get PHRS, USDC, and USDT balances for a managed agent wallet on Pharos testnet.",
  getAgentWalletBalanceSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetAgentWalletBalance, params, "get_agent_wallet_balance"))
);

// ─── Start Server ──────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SafeHands-Pharos MCP Server v1.4.0 running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
