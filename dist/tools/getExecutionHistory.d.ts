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
interface HistoryEntry {
    txHash: string;
    explorerUrl: string;
    type: "swap" | "transfer" | "other";
    timestamp: string;
    status: "success" | "failed" | "unknown";
    value: string;
    details: string;
    blockNumber: string;
}
export declare function handleGetExecutionHistory(input: GetExecutionHistoryInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    walletAddress: string;
    totalFetched: number;
    history: HistoryEntry[];
    note: string;
}>>;
export {};
//# sourceMappingURL=getExecutionHistory.d.ts.map