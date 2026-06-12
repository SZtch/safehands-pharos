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
export declare function handleGetTransactionStatus(raw: GetTransactionStatusInput): Promise<{
    txHash: string;
    status: string;
    blockNumber: string;
    blockHash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}` | null;
    gasUsed: string;
    effectiveGasPrice: string;
    value: string;
    explorerUrl: string;
    error?: undefined;
} | {
    txHash: string;
    status: "pending";
    blockNumber: null;
    blockHash: null;
    from: `0x${string}`;
    to: `0x${string}` | null;
    gasUsed: null;
    effectiveGasPrice: null;
    value: string;
    explorerUrl: string;
    error?: undefined;
} | {
    txHash: string;
    status: "not_found";
    blockNumber: null;
    blockHash: null;
    from: null;
    to: null;
    gasUsed: null;
    effectiveGasPrice: null;
    value: null;
    explorerUrl: string;
    error: string;
}>;
//# sourceMappingURL=getTransactionStatus.d.ts.map