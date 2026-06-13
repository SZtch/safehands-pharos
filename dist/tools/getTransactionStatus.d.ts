import { z } from "zod";
export declare const getTransactionStatusSchema: z.ZodObject<{
    txHash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    txHash: string;
}, {
    txHash: string;
}>;
export type GetTransactionStatusInput = z.input<typeof getTransactionStatusSchema>;
export declare const getTransactionStatusTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        txHash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        txHash: string;
    }, {
        txHash: string;
    }>;
};
export declare function handleGetTransactionStatus(raw: GetTransactionStatusInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    txStatus: string;
    txHash: string;
    blockNumber: string;
    blockHash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}` | null;
    gasUsed: string;
    effectiveGasPrice: string;
    value: string;
    explorerUrl: string;
}> | import("../lib/toolResponse.js").ToolSuccess<{
    txHash: string;
    txStatus: "pending";
    blockNumber: null;
    blockHash: null;
    from: `0x${string}`;
    to: `0x${string}` | null;
    gasUsed: null;
    effectiveGasPrice: null;
    value: string;
    explorerUrl: string;
}>>;
//# sourceMappingURL=getTransactionStatus.d.ts.map