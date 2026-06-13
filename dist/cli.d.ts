import { type ToolResponse } from "./lib/toolResponse.js";
export type SkillCliToolName = "safehands_preflight_check" | "safehands_x402_preflight" | "safehands_wallet_health" | "token_registry_status" | "explain_risk" | "safehands_risk_report" | "safehands_safe_execute" | "create_agent_wallet" | "get_agent_wallet" | "get_agent_wallet_balance" | "check_token_security" | "assess_risk" | "get_wallet_balance" | "simulate_transaction" | "estimate_gas" | "get_token_price" | "get_transaction_status" | "query_risk_registry";
export declare function getSkillCliToolNames(): string[];
export declare function invokeSkillCliTool(toolName: string, input: unknown): Promise<ToolResponse<unknown>>;
export declare function runSkillCli(argv: string[]): Promise<number>;
//# sourceMappingURL=cli.d.ts.map