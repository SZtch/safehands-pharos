import { z } from "zod";
export declare const getGasPriceSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export type GetGasPriceInput = z.input<typeof getGasPriceSchema>;
export declare const getGasPriceTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
};
export declare function handleGetGasPrice(_raw: GetGasPriceInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    gasPrice: {
        value: string;
        unit: string;
    };
    gasPriceWei: string;
    trend: "low" | "high" | "normal";
    recommendation: string;
    estimates: {
        nativeTransfer: {
            gas: {
                value: string;
                unit: string;
            };
            costPHRS: {
                value: string;
                unit: string;
            };
        };
        tokenSwap: {
            gas: {
                value: string;
                unit: string;
            };
            costPHRS: {
                value: string;
                unit: string;
            };
        };
    };
    chainId: number;
    environment: string;
    isMainnet: boolean;
    source: string;
}>>;
//# sourceMappingURL=getGasPrice.d.ts.map