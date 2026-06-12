import { z } from "zod";
export declare const getExecutionHistorySchema: z.ZodObject<{
    walletAddress: z.ZodString;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    filter: z.ZodDefault<z.ZodOptional<z.ZodEnum<["swap", "transfer", "all"]>>>;
}, "strip", z.ZodTypeAny, {
    filter: "transfer" | "all" | "swap";
    walletAddress: string;
    limit: number;
}, {
    walletAddress: string;
    filter?: "transfer" | "all" | "swap" | undefined;
    limit?: number | undefined;
}>;
export type GetExecutionHistoryInput = z.infer<typeof getExecutionHistorySchema>;
export declare const getExecutionHistoryTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        walletAddress: z.ZodString;
        limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        filter: z.ZodDefault<z.ZodOptional<z.ZodEnum<["swap", "transfer", "all"]>>>;
    }, "strip", z.ZodTypeAny, {
        filter: "transfer" | "all" | "swap";
        walletAddress: string;
        limit: number;
    }, {
        walletAddress: string;
        filter?: "transfer" | "all" | "swap" | undefined;
        limit?: number | undefined;
    }>;
};
export declare function handleGetExecutionHistory(input: GetExecutionHistoryInput): Promise<{
    walletAddress: string;
    totalFetched: number;
    history: never[];
    error: string;
} | {
    walletAddress: string;
    totalFetched: number;
    history: {
        txHash: string;
        explorerUrl: string;
        type: "swap" | "transfer" | "other";
        timestamp: string;
        status: "success" | "failed";
        value: string;
        details: string;
    }[];
    error?: undefined;
}>;
//# sourceMappingURL=getExecutionHistory.d.ts.map