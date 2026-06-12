import { z } from "zod";
export declare const publishRiskScoreSchema: z.ZodObject<{
    action: z.ZodEnum<["swap", "transfer"]>;
    tokenIn: z.ZodOptional<z.ZodString>;
    tokenOut: z.ZodOptional<z.ZodString>;
    amount: z.ZodString;
    toAddress: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: string;
    action: "transfer" | "swap";
    tokenIn?: string | undefined;
    tokenOut?: string | undefined;
    agentId?: string | undefined;
    toAddress?: string | undefined;
}, {
    amount: string;
    action: "transfer" | "swap";
    tokenIn?: string | undefined;
    tokenOut?: string | undefined;
    agentId?: string | undefined;
    toAddress?: string | undefined;
}>;
export type PublishRiskScoreInput = z.input<typeof publishRiskScoreSchema>;
export declare const publishRiskScoreTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        action: z.ZodEnum<["swap", "transfer"]>;
        tokenIn: z.ZodOptional<z.ZodString>;
        tokenOut: z.ZodOptional<z.ZodString>;
        amount: z.ZodString;
        toAddress: z.ZodOptional<z.ZodString>;
        agentId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        amount: string;
        action: "transfer" | "swap";
        tokenIn?: string | undefined;
        tokenOut?: string | undefined;
        agentId?: string | undefined;
        toAddress?: string | undefined;
    }, {
        amount: string;
        action: "transfer" | "swap";
        tokenIn?: string | undefined;
        tokenOut?: string | undefined;
        agentId?: string | undefined;
        toAddress?: string | undefined;
    }>;
};
export declare function handlePublishRiskScore(raw: PublishRiskScoreInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    assessment: import("../lib/riskEngine.js").RiskAssessment;
    policy: import("../lib/policy/actionPolicyEngine.js").ActionPolicyResult;
    signerMode: import("../lib/signer/index.js").SignerMode;
    onChain: {
        txHash: `0x${string}`;
        explorerUrl: string;
        contractAddress: `0x${string}`;
        gasUsed: string;
        blockNumber: string;
    };
    source: string;
}>>;
//# sourceMappingURL=publishRiskScore.d.ts.map