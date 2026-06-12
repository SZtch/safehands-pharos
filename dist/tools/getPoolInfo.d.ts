import { z } from "zod";
export declare const getPoolInfoSchema: z.ZodObject<{
    tokenA: z.ZodEnum<["PHRS", "USDC", "USDT"]>;
    tokenB: z.ZodEnum<["PHRS", "USDC", "USDT"]>;
}, "strip", z.ZodTypeAny, {
    tokenA: "PHRS" | "USDC" | "USDT";
    tokenB: "PHRS" | "USDC" | "USDT";
}, {
    tokenA: "PHRS" | "USDC" | "USDT";
    tokenB: "PHRS" | "USDC" | "USDT";
}>;
export type GetPoolInfoInput = z.input<typeof getPoolInfoSchema>;
export declare const getPoolInfoTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        tokenA: z.ZodEnum<["PHRS", "USDC", "USDT"]>;
        tokenB: z.ZodEnum<["PHRS", "USDC", "USDT"]>;
    }, "strip", z.ZodTypeAny, {
        tokenA: "PHRS" | "USDC" | "USDT";
        tokenB: "PHRS" | "USDC" | "USDT";
    }, {
        tokenA: "PHRS" | "USDC" | "USDT";
        tokenB: "PHRS" | "USDC" | "USDT";
    }>;
};
export declare function handleGetPoolInfo(raw: GetPoolInfoInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    pair: string;
    available: boolean;
    message: string;
    source: string;
    sourceStatus: string;
    publicMode: boolean;
    chainId: number;
    environment: string;
    isMainnet: boolean;
}> | import("../lib/toolResponse.js").ToolSuccess<{
    pair: string;
    available: boolean;
    priceRatio: {
        value: string;
        unit: "PHRS" | "USDC" | "USDT";
        per: string;
    } | null;
    priceImpact: {
        value: string;
        unit: string;
    };
    pricePerFromToken: {
        value: string;
        unit: "PHRS" | "USDC" | "USDT";
    } | null;
    pricePerToToken: {
        value: string;
        unit: "PHRS" | "USDC" | "USDT";
    } | null;
    fee: {
        value: string;
        unit: string;
    } | null;
    liquidity: {
        baseLiquidity: string;
        quoteLiquidity: string;
        poolType: string;
    } | null;
    poolListStatus: string;
    source: string;
    sourceStatus: string;
    publicMode: boolean;
    routeAvailable: boolean;
    confidence: string;
    chainId: number;
    environment: string;
    isMainnet: boolean;
}>>;
//# sourceMappingURL=getPoolInfo.d.ts.map