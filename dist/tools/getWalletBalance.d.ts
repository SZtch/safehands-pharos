import { z } from "zod";
export declare const getWalletBalanceSchema: z.ZodObject<{
    walletAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    walletAddress: string;
}, {
    walletAddress: string;
}>;
export type GetWalletBalanceInput = z.input<typeof getWalletBalanceSchema>;
export declare const getWalletBalanceTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        walletAddress: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        walletAddress: string;
    }, {
        walletAddress: string;
    }>;
};
export declare function handleGetWalletBalance(raw: GetWalletBalanceInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    walletAddress: `0x${string}`;
    balances: {
        PHRS: {
            balance: {
                value: string;
                unit: string;
            };
            valueUsd: {
                value: string;
                unit: string;
            };
        };
        USDC: {
            balance: {
                value: string;
                unit: string;
            };
            valueUsd: {
                value: string;
                unit: string;
            };
        };
        USDT: {
            balance: {
                value: string;
                unit: string;
            };
            valueUsd: {
                value: string;
                unit: string;
            };
        };
    };
    totalUsd: {
        value: string;
        unit: string;
    };
    phrsPrice: {
        value: string;
        unit: string;
    } | null;
    priceSourceStatus: string;
    chainId: number;
    environment: string;
    isMainnet: boolean;
    source: string;
}>>;
//# sourceMappingURL=getWalletBalance.d.ts.map