import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const getAgentWalletBalanceSchema: z.ZodObject<{
    agentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    agentId: string;
}, {
    agentId: string;
}>;
export type GetAgentWalletBalanceParams = z.infer<typeof getAgentWalletBalanceSchema>;
export declare function handleGetAgentWalletBalance(params: GetAgentWalletBalanceParams): Promise<ToolResponse<unknown>>;
//# sourceMappingURL=getAgentWalletBalance.d.ts.map