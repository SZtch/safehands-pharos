import { z } from "zod";
import { type RiskAssessment } from "../lib/riskEngine.js";
export declare const assessRiskSchema: z.ZodObject<{
    action: z.ZodEnum<["swap", "transfer"]>;
    tokenIn: z.ZodOptional<z.ZodString>;
    tokenOut: z.ZodOptional<z.ZodString>;
    amount: z.ZodString;
    toAddress: z.ZodOptional<z.ZodString>;
    walletAddress: z.ZodString;
    agentId: z.ZodOptional<z.ZodString>;
    autoPublish: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    privateKey: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: string;
    walletAddress: string;
    action: "transfer" | "swap";
    autoPublish: boolean;
    tokenIn?: string | undefined;
    tokenOut?: string | undefined;
    privateKey?: string | undefined;
    agentId?: string | undefined;
    toAddress?: string | undefined;
}, {
    amount: string;
    walletAddress: string;
    action: "transfer" | "swap";
    tokenIn?: string | undefined;
    tokenOut?: string | undefined;
    privateKey?: string | undefined;
    agentId?: string | undefined;
    toAddress?: string | undefined;
    autoPublish?: boolean | undefined;
}>;
export type AssessRiskInput = z.input<typeof assessRiskSchema>;
export interface AssessRiskResult extends RiskAssessment {
    registryPublish?: {
        published: boolean;
        txHash?: string;
        explorerUrl?: string;
        error?: string;
        signerMode?: string;
    };
}
export declare const assessRiskTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        action: z.ZodEnum<["swap", "transfer"]>;
        tokenIn: z.ZodOptional<z.ZodString>;
        tokenOut: z.ZodOptional<z.ZodString>;
        amount: z.ZodString;
        toAddress: z.ZodOptional<z.ZodString>;
        walletAddress: z.ZodString;
        agentId: z.ZodOptional<z.ZodString>;
        autoPublish: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        privateKey: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        amount: string;
        walletAddress: string;
        action: "transfer" | "swap";
        autoPublish: boolean;
        tokenIn?: string | undefined;
        tokenOut?: string | undefined;
        privateKey?: string | undefined;
        agentId?: string | undefined;
        toAddress?: string | undefined;
    }, {
        amount: string;
        walletAddress: string;
        action: "transfer" | "swap";
        tokenIn?: string | undefined;
        tokenOut?: string | undefined;
        privateKey?: string | undefined;
        agentId?: string | undefined;
        toAddress?: string | undefined;
        autoPublish?: boolean | undefined;
    }>;
};
export declare function handleAssessRisk(raw: AssessRiskInput): Promise<AssessRiskResult>;
//# sourceMappingURL=assessRisk.d.ts.map