import { z } from "zod";
export declare const estimateGasSchema: z.ZodObject<{
    action: z.ZodEnum<["swap", "transfer"]>;
    tokenIn: z.ZodOptional<z.ZodString>;
    tokenOut: z.ZodOptional<z.ZodString>;
    amount: z.ZodString;
    walletAddress: z.ZodString;
    toAddress: z.ZodOptional<z.ZodString>;
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
export type EstimateGasInput = z.input<typeof estimateGasSchema>;
export declare const estimateGasTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        action: z.ZodEnum<["swap", "transfer"]>;
        tokenIn: z.ZodOptional<z.ZodString>;
        tokenOut: z.ZodOptional<z.ZodString>;
        amount: z.ZodString;
        walletAddress: z.ZodString;
        toAddress: z.ZodOptional<z.ZodString>;
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
export declare function handleEstimateGas(raw: EstimateGasInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    action: "transfer" | "swap";
    gasEstimate: {
        value: string;
        unit: string;
    };
    gasPrice: {
        value: string;
        unit: string;
    };
    gasCostPHRS: {
        value: string;
        unit: string;
    };
    gasCostUsd: {
        value: string;
        unit: string;
    } | null;
    walletBalance: {
        value: string;
        unit: string;
    };
    isSufficient: boolean;
    priceSourceStatus: string;
    chainId: number;
    environment: string;
    isMainnet: boolean;
    source: string;
}>>;
//# sourceMappingURL=estimateGas.d.ts.map