import { z } from "zod";
export declare const approveTokenSchema: z.ZodObject<{
    token: z.ZodEnum<["USDC", "USDT"]>;
    amount: z.ZodString;
    agentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: string;
    token: "USDC" | "USDT";
    agentId?: string | undefined;
}, {
    amount: string;
    token: "USDC" | "USDT";
    agentId?: string | undefined;
}>;
export type ApproveTokenInput = z.input<typeof approveTokenSchema>;
export declare const approveTokenTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        token: z.ZodEnum<["USDC", "USDT"]>;
        amount: z.ZodString;
        agentId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        amount: string;
        token: "USDC" | "USDT";
        agentId?: string | undefined;
    }, {
        amount: string;
        token: "USDC" | "USDT";
        agentId?: string | undefined;
    }>;
};
export declare function handleApproveToken(raw: ApproveTokenInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    txHash: `0x${string}`;
    explorerUrl: string;
    token: "USDC" | "USDT";
    tokenAddress: "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5" | "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
    approvedAmount: string;
    spender: "0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9";
    signerMode: import("../lib/signer/index.js").SignerMode;
    walletAddress: `0x${string}`;
    gasUsed: string;
    policy: import("../lib/policy/actionPolicyEngine.js").ActionPolicyResult;
    source: string;
}>>;
//# sourceMappingURL=approveToken.d.ts.map