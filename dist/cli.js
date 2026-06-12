// ─── SafeHands Skill Engine CLI Adapter ────────────────────────────────
// Terminal entrypoint used by Pharos Skill Engine reference files.
// It calls the same tool handlers as MCP registration and prints the
// standard SafeHands response envelope as JSON.
// ────────────────────────────────────────────────────────────────────────
import { fail, ok } from "./lib/toolResponse.js";
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
const SKILL_CLI_TOOLS = {
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
};
function isStructuredResponse(value) {
    return !!value && typeof value === "object" && "success" in value && "data" in value && "error" in value && "timestamp" in value;
}
function printJson(response) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}
function usage() {
    const tools = Object.keys(SKILL_CLI_TOOLS).sort().join(", ");
    return [
        "Usage: npx safehands-pharos skill <tool_name> --input-json '<json>'",
        "",
        `Supported Skill Engine tools: ${tools}`,
        "",
        "Example:",
        "  npx safehands-pharos skill safehands_preflight_check --input-json '{\"actionType\":\"approve_token\",\"chainId\":688689,\"amount\":\"1\"}'",
    ].join("\n");
}
function readInputJsonArg(argv) {
    const positional = argv.indexOf("--input-json");
    if (positional >= 0)
        return argv[positional + 1] ?? null;
    const prefixed = argv.find((arg) => arg.startsWith("--input-json="));
    return prefixed ? prefixed.slice("--input-json=".length) : null;
}
export function getSkillCliToolNames() {
    return Object.keys(SKILL_CLI_TOOLS).sort();
}
export async function invokeSkillCliTool(toolName, input) {
    const handler = SKILL_CLI_TOOLS[toolName];
    if (!handler) {
        return fail("UNKNOWN_SKILL_TOOL", `Unknown SafeHands Skill Engine tool: ${toolName}. Supported tools: ${getSkillCliToolNames().join(", ")}`, false, "safehands_cli");
    }
    try {
        const result = await handler(input);
        if (isStructuredResponse(result))
            return result;
        return ok(result);
    }
    catch (err) {
        return fail("TOOL_EXECUTION_FAILED", err instanceof Error ? err.message : String(err), false, toolName);
    }
}
export async function runSkillCli(argv) {
    const [toolName] = argv;
    if (!toolName || toolName === "--help" || toolName === "-h") {
        printJson(fail("CLI_USAGE_ERROR", usage(), false, "safehands_cli"));
        return 2;
    }
    if (!SKILL_CLI_TOOLS[toolName]) {
        printJson(await invokeSkillCliTool(toolName, {}));
        return 2;
    }
    const rawJson = readInputJsonArg(argv.slice(1));
    if (rawJson === null) {
        printJson(fail("MISSING_INPUT_JSON", "Missing required --input-json '<json>' argument.", false, "safehands_cli"));
        return 2;
    }
    let input;
    try {
        input = JSON.parse(rawJson);
    }
    catch (err) {
        printJson(fail("INVALID_INPUT_JSON", err instanceof Error ? err.message : String(err), false, "safehands_cli"));
        return 2;
    }
    printJson(await invokeSkillCliTool(toolName, input));
    return 0;
}
//# sourceMappingURL=cli.js.map