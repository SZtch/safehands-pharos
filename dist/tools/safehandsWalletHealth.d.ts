import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const safehandsWalletHealthSchema: z.ZodObject<{
    agentId: z.ZodOptional<z.ZodString>;
    walletAddress: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    agentId?: string | undefined;
    walletAddress?: string | undefined;
}, {
    agentId?: string | undefined;
    walletAddress?: string | undefined;
}>;
export type SafeHandsWalletHealthInput = z.input<typeof safehandsWalletHealthSchema>;
export declare function handleSafeHandsWalletHealth(raw: SafeHandsWalletHealthInput): Promise<ToolResponse<unknown>>;
//# sourceMappingURL=safehandsWalletHealth.d.ts.map