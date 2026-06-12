import { z } from "zod";
export declare const getTokenPriceSchema: z.ZodObject<{
    token: z.ZodEnum<["PHRS", "USDC", "USDT"]>;
}, "strip", z.ZodTypeAny, {
    token: "PHRS" | "USDC" | "USDT";
}, {
    token: "PHRS" | "USDC" | "USDT";
}>;
export type GetTokenPriceInput = z.input<typeof getTokenPriceSchema>;
export declare const getTokenPriceTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        token: z.ZodEnum<["PHRS", "USDC", "USDT"]>;
    }, "strip", z.ZodTypeAny, {
        token: "PHRS" | "USDC" | "USDT";
    }, {
        token: "PHRS" | "USDC" | "USDT";
    }>;
};
export declare function handleGetTokenPrice(raw: GetTokenPriceInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    token: string;
    tokenRegistry: {
        readonly symbol: "USDC";
        readonly address: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
        readonly decimals: 6;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "Pharos Skill Engine USDC — the USDC listed in the official pharos-skill-engine-0.1.0 assets/tokens.json for atlantic-testnet";
        readonly docsSource: "pharos-skill-engine-0.1.0/assets/tokens.json";
        readonly verificationStatus: "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE";
    };
    priceUsd: {
        value: string;
        unit: string;
    };
    priceInPHRS: {
        value: string | null;
        unit: string;
    };
    source: string;
    sourceStatus: "ok" | "unavailable" | "no_route_available" | "auth_required";
    routeAvailable: boolean;
    publicMode: boolean;
    confidence: string;
    chainId: number;
    environment: string;
    isMainnet: boolean;
}> | import("../lib/toolResponse.js").ToolSuccess<{
    token: string;
    tokenRegistry: {
        readonly symbol: "USDT";
        readonly address: "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5";
        readonly decimals: 6;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "canonical Pharos Atlantic Testnet USDT (Tether USD)";
        readonly docsSource: "https://docs.pharos.xyz/getting-started/token-registry";
        readonly verificationStatus: "DOCS_VERIFIED";
    };
    priceUsd: {
        value: string;
        unit: string;
    };
    priceInPHRS: {
        value: string | null;
        unit: string;
    };
    source: string;
    sourceStatus: string;
    routeAvailable: boolean;
    publicMode: boolean;
    confidence: string;
    chainId: number;
    environment: string;
    isMainnet: boolean;
}> | import("../lib/toolResponse.js").ToolSuccess<{
    token: string;
    tokenRegistry: {
        readonly symbol: "PHRS";
        readonly address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        readonly decimals: 18;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "native PHRS sentinel address for DODO route API";
        readonly docsSource: "https://docs.pharos.xyz/";
    };
    priceUsd: {
        value: string;
        unit: string;
    };
    priceInPHRS: {
        value: string;
        unit: string;
    };
    source: string;
    sourceStatus: "ok" | "unavailable" | "no_route_available" | "auth_required";
    routeAvailable: boolean;
    publicMode: boolean;
    confidence: string;
    chainId: number;
    environment: string;
    isMainnet: boolean;
}>>;
//# sourceMappingURL=getTokenPrice.d.ts.map