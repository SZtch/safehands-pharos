import { z } from "zod";
export declare const executeSwapSchema: z.ZodObject<{
    tokenIn: z.ZodString;
    tokenOut: z.ZodString;
    amountIn: z.ZodString;
    slippageTolerance: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    agentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageTolerance: number;
    agentId?: string | undefined;
}, {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    agentId?: string | undefined;
    slippageTolerance?: number | undefined;
}>;
export type ExecuteSwapInput = z.input<typeof executeSwapSchema>;
export declare const executeSwapTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        tokenIn: z.ZodString;
        tokenOut: z.ZodString;
        amountIn: z.ZodString;
        slippageTolerance: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        agentId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        slippageTolerance: number;
        agentId?: string | undefined;
    }, {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        agentId?: string | undefined;
        slippageTolerance?: number | undefined;
    }>;
};
export declare function handleExecuteSwap(raw: ExecuteSwapInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    txSuccess: boolean;
    txHash: `0x${string}`;
    explorerUrl: string;
    amountOut: string;
    signerMode: import("../lib/signer/index.js").SignerMode;
    walletAddress: `0x${string}`;
    gasUsed: string;
    policy: import("../lib/policy/actionPolicyEngine.js").ActionPolicyResult;
    riskAssessment: {
        riskScore: number;
        wasBlocked: boolean;
    };
    source: string;
}>>;
//# sourceMappingURL=executeSwap.d.ts.map