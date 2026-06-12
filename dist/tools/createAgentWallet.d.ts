import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const createAgentWalletSchema: z.ZodObject<{
    agentId: z.ZodString;
    overwrite: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    agentId: string;
    overwrite: boolean;
}, {
    agentId: string;
    overwrite?: boolean | undefined;
}>;
export type CreateAgentWalletParams = z.infer<typeof createAgentWalletSchema>;
interface CreateAgentWalletData {
    agentId: string;
    address: string;
    environment: string;
    chainId: number;
    isMainnet: boolean;
    isTestnet: boolean;
    createdAt: string;
    warning: string;
    instructions: string;
}
export declare function handleCreateAgentWallet(params: CreateAgentWalletParams): Promise<ToolResponse<CreateAgentWalletData>>;
export {};
//# sourceMappingURL=createAgentWallet.d.ts.map