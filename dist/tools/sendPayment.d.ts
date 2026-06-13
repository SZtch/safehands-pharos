import { z } from "zod";
export declare const sendPaymentSchema: z.ZodObject<{
    toAddress: z.ZodString;
    amount: z.ZodString;
    memo: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: string;
    toAddress: string;
    agentId?: string | undefined;
    memo?: string | undefined;
}, {
    amount: string;
    toAddress: string;
    agentId?: string | undefined;
    memo?: string | undefined;
}>;
export type SendPaymentInput = z.input<typeof sendPaymentSchema>;
export declare const sendPaymentTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        toAddress: z.ZodString;
        amount: z.ZodString;
        memo: z.ZodOptional<z.ZodString>;
        agentId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        amount: string;
        toAddress: string;
        agentId?: string | undefined;
        memo?: string | undefined;
    }, {
        amount: string;
        toAddress: string;
        agentId?: string | undefined;
        memo?: string | undefined;
    }>;
};
export declare function handleSendPayment(raw: SendPaymentInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    txHash: `0x${string}`;
    explorerUrl: string;
    amountSent: string;
    signerMode: import("../lib/signer/index.js").SignerMode;
    walletAddress: `0x${string}`;
    gasUsed: string;
    validation: {
        addressValid: boolean;
        balanceSufficient: boolean;
        warnings: string[];
    };
    policy: import("../lib/policy/actionPolicyEngine.js").ActionPolicyResult;
    riskAssessment: {
        riskScore: number;
        wasBlocked: boolean;
    };
    source: string;
}>>;
//# sourceMappingURL=sendPayment.d.ts.map