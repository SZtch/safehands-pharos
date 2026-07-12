#!/usr/bin/env node
// ─── SafeHands MCP Server ──────────────────────────────────────────────
// Entry point — registers 33 tools and starts the MCP server.
// ────────────────────────────────────────────────────────────────────────

// Must be first import — loads .env before any module reads process.env at init time
import "./lib/envLoader.js";

import { createRequire } from "module";
import { pathToFileURL } from "url";
const require = createRequire(import.meta.url);
const PKG_VERSION: string = (require("../package.json") as { version: string }).version;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { assessRiskTool, handleAssessRisk } from "./tools/assessRisk.js";
import { simulateTransactionTool, handleSimulateTransaction } from "./tools/simulateTransaction.js";
import { getExecutionHistoryTool, handleGetExecutionHistory } from "./tools/getExecutionHistory.js";
import { getTokenPriceTool, handleGetTokenPrice } from "./tools/getTokenPrice.js";
import { getWalletBalanceTool, handleGetWalletBalance } from "./tools/getWalletBalance.js";
import { checkAllowanceTool, handleCheckAllowance } from "./tools/checkAllowance.js";
import { getTransactionStatusTool, handleGetTransactionStatus } from "./tools/getTransactionStatus.js";
import { estimateGasTool, handleEstimateGas } from "./tools/estimateGas.js";
import { publishRiskScoreTool, handlePublishRiskScore } from "./tools/publishRiskScore.js";
import { queryRiskRegistryTool, handleQueryRiskRegistry } from "./tools/queryRiskRegistry.js";
import { verifyRiskInclusionTool, handleVerifyRiskInclusion } from "./tools/verifyRiskInclusion.js";
import { getAgentReputationTool, handleGetAgentReputation } from "./tools/getAgentReputation.js";
import { getGasPriceTool, handleGetGasPrice } from "./tools/getGasPrice.js";
import { getPoolInfoTool, handleGetPoolInfo } from "./tools/getPoolInfo.js";
import { queryGoldskySchema, handleQueryGoldsky } from "./tools/queryGoldsky.js";
import { getSpvProofSchema, handleGetSpvProof } from "./tools/getSpvProof.js";
import { checkTokenSecurityTool, handleCheckTokenSecurity } from "./tools/checkTokenSecurity.js";
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
import { getAgentPolicySchema, handleGetAgentPolicy } from "./tools/getAgentPolicy.js";
import { setAgentPolicySchema, handleSetAgentPolicy } from "./tools/setAgentPolicy.js";
import { executeSwapTool, handleExecuteSwap } from "./tools/executeSwap.js";
import { sendPaymentTool, handleSendPayment } from "./tools/sendPayment.js";
import { approveTokenTool, handleApproveToken } from "./tools/approveToken.js";
import { x402PayAndFetchTool, handleX402PayAndFetch } from "./tools/x402PayAndFetch.js";
import { fail, ok } from "./lib/toolResponse.js";
import { auditLog } from "./lib/auditLog.js";
import { walletStore, encryptKey, getEffectiveEncryptionKey } from "./lib/wallet/index.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { runSkillCli } from "./cli.js";
import { runDemo } from "./demo.js";
import { runInit } from "./init.js";

process.on("unhandledRejection", (reason) => {
  console.error("SafeHands MCP unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("SafeHands MCP uncaught exception:", error);
  process.exit(1);
});


// ─── Per-tool rate limiting ────────────────────────────────────────────
// Heavy tools (block-scan history) get a tighter limit.
// Write tools get a moderate limit to prevent agent loops.
// All other tools share a generous global limit.

const HEAVY_TOOLS = new Set(["get_execution_history"]);
const WRITE_TOOLS = new Set([
  "publish_risk_score", "safehands_safe_execute",
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

const isDemoMode = process.argv.includes("--demo");

if (isDemoMode) {
  await runDemo();
  // Set exit code and let the event loop drain naturally.
  // Avoids Windows libuv UV_HANDLE_CLOSING assertion that occurs with process.exit() while
  // async handles (express close, viem HTTP keep-alive) are still winding down.
  process.exitCode = 0;
}

// ─── CLI Help ──────────────────────────────────────────────────────────

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`
🛡️  SafeHands-Pharos: Transaction Safety Firewall for AI Agents
   v${PKG_VERSION} | Pharos Pacific Mainnet | Chain ID 1672

USAGE
  npx github:SZtch/safehands-pharos
      Start SafeHands as an MCP server over stdio.

  npx github:SZtch/safehands-pharos --help
      Show this help.

  npx github:SZtch/safehands-pharos init
      Launch the interactive setup wizard to configure your .env file safely.

  npx github:SZtch/safehands-pharos --demo
      Run the deterministic non-destructive hackathon demo.

  npx github:SZtch/safehands-pharos skill <tool_name> --input-json '<json>'
      Run a Pharos Skill Engine-compatible SafeHands CLI tool.

POSITIONING
  SafeHands is an open-source reusable Pharos Skill that gives AI agents
  a safety gateway before on-chain actions. Mainnet-first for Pharos Pacific
  read/check/analyze; execution/signing/managed-wallet/on-chain publishing
  remain gated and disabled by default.

  User intent
  → SafeHands preflight
  → ALLOW / BLOCK / REQUIRE_CONFIRMATION / PREPARE_ONLY
  → Execute only if safe
  → SafeHands risk report

EXECUTION MODES
  Preflight / read-only    No wallet, no key, no authorization required
  User-signed              SafeHands validates; user signs externally
  Managed execution        SafeHandsRegistry authorization + funding required
  Env wallet (advanced)    Local mainnet key, not default UX
  Operator / demo          Auto-authorize via owner key, mainnet only

SAFEHANDS TOOLS (33)
  Safety preflight:   safehands_preflight_check, safehands_x402_preflight,
                      safehands_risk_report, safehands_wallet_health,
                      explain_risk, token_registry_status, query_risk_registry,
                      verify_risk_inclusion, get_agent_reputation
  Execution (gated):  safehands_safe_execute, execute_swap, send_payment,
                      approve_token, publish_risk_score, x402_pay_and_fetch
  Risk + analysis:    assess_risk, check_token_security, simulate_transaction,
                      estimate_gas
  Market + chain:     get_token_price, get_pool_info, get_gas_price,
                      get_wallet_balance, check_allowance,
                      get_transaction_status, get_execution_history,
                      query_goldsky_subgraph, get_spv_proof
  Agent policy:       get_agent_policy, set_agent_policy
  Managed wallet:     create_agent_wallet, get_agent_wallet,
                      get_agent_wallet_balance

PHAROS PACIFIC MAINNET (default: read/check/analyze)
  Network: Pharos Pacific Mainnet
  Chain ID: 1672
  Native token: PROS
  RPC: https://rpc.pharos.xyz
  Explorer: https://www.pharosscan.xyz

PHAROS ATLANTIC TESTNET (deprecated for execution)
  Environment: atlantic-testnet
  Chain ID: 688689
  RPC: https://atlantic.dplabs-internal.com
  Explorer: https://atlantic.pharosscan.xyz/

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
  Mainnet write/payment actions are gated and disabled by default.
  SSRF-sensitive x402 URLs are blocked by default.

EXAMPLES
  npx github:SZtch/safehands-pharos skill safehands_preflight_check --input-json '{"actionType":"send_payment","chainId":1672,"isMainnet":true,"amount":"0.001","recipient":"0x0000000000000000000000000000000000000001"}'

  npx github:SZtch/safehands-pharos skill token_registry_status --input-json '{"tokenAddress":"0xc879c018db60520f4355c26ed1a6d572cdac1815"}'

DOCS
  README.md
`);
  process.exit(0);
}

if (!isDemoMode) {

// ─── Auto-Wallet Creation ─────────────────────────────────────────────
// If WALLET_MODE=managed-mainnet and no default wallet exists yet,
// auto-create one so the user just needs to fund it.

const DEFAULT_AGENT_ID = "default";

const walletMode = process.env.WALLET_MODE || "none";
if (walletMode === "managed-mainnet" && process.env.MANAGED_WALLET_ENABLED === "true") {
  const existing = await walletStore.get(DEFAULT_AGENT_ID);
  if (!existing) {
    try {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      const encrypted = encryptKey(privateKey, getEffectiveEncryptionKey());
      await walletStore.set(DEFAULT_AGENT_ID, {
        agentId: DEFAULT_AGENT_ID,
        address: account.address,
        encryptedKey: encrypted,
        environment: "pacific-mainnet",
        chainId: 1672,
        isMainnet: true,
        createdAt: new Date().toISOString(),
      });
      console.error(`🛡️  SafeHands - auto-created managed agent wallet: ${account.address}`);
      console.error(`   Fund it with PROS for gas. Use a DEDICATED low-value wallet; managed execution stays OFF until you opt in.`);
      console.error("");
    } catch {
      console.error("⚠️  SafeHands: failed to auto-create wallet. Use create_agent_wallet manually.");
      console.error("");
    }
  } else {
    console.error(`🛡️  SafeHands - agent wallet ready: ${existing.address}`);
    console.error("");
  }
}

// ─── Startup Validation ────────────────────────────────────────────────

const hasExplicitSignerMode = walletMode === "managed-mainnet" || walletMode === "env";

if (process.env.WRITE_TOOLS_ENABLED !== "true") {
  console.error("⚠️  SafeHands: write tools are disabled. Read-only tools remain available.");
  console.error("   To enable writes, set WRITE_TOOLS_ENABLED=true in your .env or MCP config.");
  console.error("");
} else if (!hasExplicitSignerMode) {
  console.error("⚠️  SafeHands: write tools enabled but no signer mode detected.");
  console.error("   Set WALLET_MODE=managed-mainnet or WALLET_MODE=env.");
  console.error("");
}

// ─── Server Setup ──────────────────────────────────────────────────────

const server = new McpServer({
  name: "safehands",
  version: PKG_VERSION,
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
  "Guarded execution wrapper: preflight first, then execute only allowed and explicitly confirmed mainnet actions.",
  safehandsSafeExecuteSchema.shape,
  async (params) => mcpText(await invokeTool(handleSafeHandsSafeExecute, params, "safehands_safe_execute"))
);

// ─── Execution Tools (Gated) ───────────────────────────────────────────

server.tool(
  executeSwapTool.name,
  executeSwapTool.description,
  executeSwapTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleExecuteSwap, params, "execute_swap"))
);

server.tool(
  sendPaymentTool.name,
  sendPaymentTool.description,
  sendPaymentTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleSendPayment, params, "send_payment"))
);

server.tool(
  approveTokenTool.name,
  approveTokenTool.description,
  approveTokenTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleApproveToken, params, "approve_token"))
);

server.tool(
  x402PayAndFetchTool.name,
  x402PayAndFetchTool.description,
  x402PayAndFetchTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleX402PayAndFetch, params, "x402_pay_and_fetch"))
);

server.tool(
  "safehands_wallet_health",
  "Check whether an AI agent wallet is funded, signer-ready, and safe to use on Pharos Mainnet.",
  safehandsWalletHealthSchema.shape,
  async (params) => mcpText(await invokeTool(handleSafeHandsWalletHealth, params, "safehands_wallet_health"))
);

server.tool(
  "safehands_x402_preflight",
  "Check an x402 paid resource for URL safety, payment amount, token, signer, and mainnet policy before signing.",
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
  "Classify exact token input as canonical mainnet token, custom, unknown, or invalid.",
  tokenRegistryStatusSchema.shape,
  async (params) => mcpText(await invokeTool(handleTokenRegistryStatus, params, "token_registry_status"))
);

server.tool(
  assessRiskTool.name,
  assessRiskTool.description,
  assessRiskTool.inputSchema.shape,
  async (params) => {
    const result = await handleAssessRisk(params as any);
    return mcpText(result);
  }
);

server.tool(
  simulateTransactionTool.name,
  simulateTransactionTool.description,
  simulateTransactionTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleSimulateTransaction, params, "simulate_transaction"))
);

server.tool(
  getExecutionHistoryTool.name,
  getExecutionHistoryTool.description,
  getExecutionHistoryTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetExecutionHistory, params, "get_execution_history"))
);

server.tool(
  getTokenPriceTool.name,
  getTokenPriceTool.description,
  getTokenPriceTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetTokenPrice, params, "get_token_price"))
);

server.tool(
  getWalletBalanceTool.name,
  getWalletBalanceTool.description,
  getWalletBalanceTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetWalletBalance, params, "get_wallet_balance"))
);

server.tool(
  checkAllowanceTool.name,
  checkAllowanceTool.description,
  checkAllowanceTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleCheckAllowance, params, "check_allowance"))
);

server.tool(
  getTransactionStatusTool.name,
  getTransactionStatusTool.description,
  getTransactionStatusTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetTransactionStatus, params, "get_transaction_status"))
);

server.tool(
  estimateGasTool.name,
  estimateGasTool.description,
  estimateGasTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleEstimateGas, params, "estimate_gas"))
);

server.tool(
  publishRiskScoreTool.name,
  publishRiskScoreTool.description,
  publishRiskScoreTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handlePublishRiskScore, params, "publish_risk_score"))
);

server.tool(
  queryRiskRegistryTool.name,
  queryRiskRegistryTool.description,
  queryRiskRegistryTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleQueryRiskRegistry, params, "query_risk_registry"))
);

server.tool(
  verifyRiskInclusionTool.name,
  verifyRiskInclusionTool.description,
  verifyRiskInclusionTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleVerifyRiskInclusion, params, "verify_risk_inclusion"))
);

server.tool(
  getAgentReputationTool.name,
  getAgentReputationTool.description,
  getAgentReputationTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetAgentReputation, params, "get_agent_reputation"))
);

server.tool(
  getGasPriceTool.name,
  getGasPriceTool.description,
  getGasPriceTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetGasPrice, params, "get_gas_price"))
);

server.tool(
  getPoolInfoTool.name,
  getPoolInfoTool.description,
  getPoolInfoTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetPoolInfo, params, "get_pool_info"))
);

server.tool(
  "query_goldsky_subgraph",
  "Execute a GraphQL query against the configured Pharos Goldsky Subgraph endpoint to fetch historical indexing data.",
  queryGoldskySchema.shape,
  async (params) => mcpText(await invokeTool(handleQueryGoldsky, params, "query_goldsky_subgraph"))
);

server.tool(
  "get_spv_proof",
  "Cryptographically verify account and storage data at a specific block height using Pharos SPV (Simplified Payment Verification).",
  getSpvProofSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetSpvProof, params, "get_spv_proof"))
);

server.tool(
  checkTokenSecurityTool.name,
  checkTokenSecurityTool.description,
  checkTokenSecurityTool.inputSchema.shape,
  async (params) => mcpText(await invokeTool(handleCheckTokenSecurity, params, "check_token_security"))
);

// ─── Agent Policy Tools ───────────────────────────────────────────────

server.tool(
  "get_agent_policy",
  "Get the active safety policy for an agent. Returns limits, flags, and profile name. Read-only.",
  getAgentPolicySchema.shape,
  async (params) => mcpText(await invokeTool(handleGetAgentPolicy, params, "get_agent_policy"))
);
server.tool(
  "set_agent_policy",
  "Set or update safety policy for an agent. Choose a profile (conservative/balanced/advanced) or set custom limits. Saved to local policy file.",
  setAgentPolicySchema.shape,
  async (params) => mcpText(await invokeTool(handleSetAgentPolicy, params, "set_agent_policy"))
);

// ─── Managed Wallet Tools ──────────────────────────────────────────────

server.tool(
  "create_agent_wallet",
  "Create a new managed mainnet agent wallet. Private key is encrypted and never returned. Fund the wallet with PROS before using write tools.",
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
  "Get PROS, USDC, and USDT balances for a managed agent wallet on Pharos Mainnet.",
  getAgentWalletBalanceSchema.shape,
  async (params) => mcpText(await invokeTool(handleGetAgentWalletBalance, params, "get_agent_wallet_balance"))
);

// ─── Start Server ──────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  transport.onclose = () => process.exit(0);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  console.error(`SafeHands-Pharos MCP Server v${PKG_VERSION} running on stdio`);
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

} // end: !isDemoMode
