import { z } from "zod";
export declare const checkAllowanceSchema: z.ZodObject<{
    walletAddress: z.ZodString;
    token: z.ZodEnum<["USDC", "USDT"]>;
    amount: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    token: "USDC" | "USDT";
    walletAddress: string;
    amount?: string | undefined;
}, {
    token: "USDC" | "USDT";
    walletAddress: string;
    amount?: string | undefined;
}>;
export type CheckAllowanceInput = z.input<typeof checkAllowanceSchema>;
export declare const checkAllowanceTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        walletAddress: z.ZodString;
        token: z.ZodEnum<["USDC", "USDT"]>;
        amount: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        token: "USDC" | "USDT";
        walletAddress: string;
        amount?: string | undefined;
    }, {
        token: "USDC" | "USDT";
        walletAddress: string;
        amount?: string | undefined;
    }>;
};
export declare function handleCheckAllowance(raw: CheckAllowanceInput): Promise<import("../lib/toolResponse.js").ToolSuccess<{
    token: "USDC" | "USDT";
    tokenAddress: "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5" | "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
    walletAddress: string;
    spender: "0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9";
    allowance: string;
    allowanceRaw: string;
    isApproved: boolean;
    needsApproval: boolean;
    approvalNote: string;
}>>;
//# sourceMappingURL=checkAllowance.d.ts.map