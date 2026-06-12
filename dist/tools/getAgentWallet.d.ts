import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const getAgentWalletSchema: z.ZodObject<{
    agentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    agentId: string;
}, {
    agentId: string;
}>;
export type GetAgentWalletParams = z.infer<typeof getAgentWalletSchema>;
interface GetAgentWalletData {
    agentId: string;
    address: string;
    environment: string;
    chainId: number;
    isMainnet: boolean;
    createdAt: string;
    explorerUrl: string;
}
export declare function handleGetAgentWallet(params: GetAgentWalletParams): Promise<ToolResponse<GetAgentWalletData>>;
export {};
//# sourceMappingURL=getAgentWallet.d.ts.map