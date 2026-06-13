import { z } from "zod";
export declare const queryRiskRegistrySchema: z.ZodObject<{
    walletAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    walletAddress: string;
}, {
    walletAddress: string;
}>;
export type QueryRiskRegistryInput = z.input<typeof queryRiskRegistrySchema>;
export declare const queryRiskRegistryTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        walletAddress: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        walletAddress: string;
    }, {
        walletAddress: string;
    }>;
};
export declare function handleQueryRiskRegistry(raw: QueryRiskRegistryInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    walletAddress: string;
    found: boolean;
    record: null;
    registryContract: `0x${string}`;
    message: string;
}> | import("../lib/toolResponse.js").ToolSuccess<{
    walletAddress: string;
    found: boolean;
    record: {
        score: number;
        riskLevel: string;
        recommendation: string;
        timestamp: string;
        assessedBy: `0x${string}`;
    };
    registryContract: `0x${string}`;
}>>;
//# sourceMappingURL=queryRiskRegistry.d.ts.map