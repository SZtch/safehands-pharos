import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const tokenRegistryStatusSchema: z.ZodObject<{
    token: z.ZodOptional<z.ZodString>;
    tokenAddress: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    token?: string | undefined;
    tokenAddress?: string | undefined;
}, {
    token?: string | undefined;
    tokenAddress?: string | undefined;
}>;
export type TokenRegistryStatusInput = z.input<typeof tokenRegistryStatusSchema>;
export type TokenRegistryStatusValue = "CANONICAL_TESTNET_TOKEN" | "SKILL_ENGINE_CANONICAL_TOKEN" | "ALTERNATE_SOURCE_TOKEN" | "CUSTOM_NON_REGISTRY" | "UNKNOWN" | "INVALID_ADDRESS";
export declare function classifyTokenRegistryStatus(token: string): {
    input: string;
    normalizedAddress: any;
    symbol: any;
    status: TokenRegistryStatusValue;
    verificationStatus: any;
    docsSource: any;
    chainId: number;
    environment: string;
    isMainnet: boolean;
};
export declare function handleTokenRegistryStatus(raw: TokenRegistryStatusInput): Promise<ToolResponse<unknown>>;
//# sourceMappingURL=tokenRegistryStatus.d.ts.map