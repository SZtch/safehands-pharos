import { z } from "zod";
export declare const checkTokenSecuritySchema: z.ZodObject<{
    tokenAddress: z.ZodString;
    chainId: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    tokenAddress: string;
    chainId: number;
}, {
    tokenAddress: string;
    chainId?: number | undefined;
}>;
export type CheckTokenSecurityInput = z.input<typeof checkTokenSecuritySchema>;
export declare const checkTokenSecurityTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        tokenAddress: z.ZodString;
        chainId: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        tokenAddress: string;
        chainId: number;
    }, {
        tokenAddress: string;
        chainId?: number | undefined;
    }>;
};
export declare function handleCheckTokenSecurity(raw: CheckTokenSecurityInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    chainId: number;
    environment: string;
    isMainnet: boolean;
    tokenAddress: `0x${string}`;
    securityProfile: {
        safetyScore: number;
        isHoneypot: boolean;
        buyTaxPercent: number;
        sellTaxPercent: number;
        isMintable: boolean;
        transferPausable: boolean;
        isProxy: boolean;
        ownerAddress: any;
        creatorAddress: any;
    };
    flags: string[];
    source: string;
    sourceStatus: string;
}>>;
//# sourceMappingURL=checkTokenSecurity.d.ts.map