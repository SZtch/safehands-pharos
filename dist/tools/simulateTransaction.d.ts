import { z } from "zod";
export declare const simulateTransactionSchema: z.ZodObject<{
    action: z.ZodEnum<["swap", "transfer"]>;
    tokenIn: z.ZodOptional<z.ZodString>;
    tokenOut: z.ZodOptional<z.ZodString>;
    amount: z.ZodString;
    toAddress: z.ZodOptional<z.ZodString>;
    walletAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    amount: string;
    walletAddress: string;
    action: "transfer" | "swap";
    tokenIn?: string | undefined;
    tokenOut?: string | undefined;
    toAddress?: string | undefined;
}, {
    amount: string;
    walletAddress: string;
    action: "transfer" | "swap";
    tokenIn?: string | undefined;
    tokenOut?: string | undefined;
    toAddress?: string | undefined;
}>;
export type SimulateTransactionInput = z.infer<typeof simulateTransactionSchema>;
export declare const simulateTransactionTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        action: z.ZodEnum<["swap", "transfer"]>;
        tokenIn: z.ZodOptional<z.ZodString>;
        tokenOut: z.ZodOptional<z.ZodString>;
        amount: z.ZodString;
        toAddress: z.ZodOptional<z.ZodString>;
        walletAddress: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amount: string;
        walletAddress: string;
        action: "transfer" | "swap";
        tokenIn?: string | undefined;
        tokenOut?: string | undefined;
        toAddress?: string | undefined;
    }, {
        amount: string;
        walletAddress: string;
        action: "transfer" | "swap";
        tokenIn?: string | undefined;
        tokenOut?: string | undefined;
        toAddress?: string | undefined;
    }>;
};
export declare function handleSimulateTransaction(input: SimulateTransactionInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    wouldSucceed: boolean;
    expectedOutput: string;
    gasEstimate: string;
    balanceChanges: {
        token: string;
        delta: string;
    }[];
    warnings: string[];
}>>;
//# sourceMappingURL=simulateTransaction.d.ts.map