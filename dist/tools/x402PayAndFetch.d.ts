import { z } from "zod";
export declare const x402PayAndFetchSchema: z.ZodObject<{
    url: z.ZodString;
    method: z.ZodDefault<z.ZodOptional<z.ZodEnum<["GET", "POST", "PUT", "DELETE"]>>>;
    body: z.ZodOptional<z.ZodString>;
    rpcUrl: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
    maxPaymentUsdc: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    url: string;
    method: "GET" | "POST" | "PUT" | "DELETE";
    maxPaymentUsdc: string;
    body?: string | undefined;
    agentId?: string | undefined;
    rpcUrl?: string | undefined;
}, {
    url: string;
    body?: string | undefined;
    method?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
    agentId?: string | undefined;
    rpcUrl?: string | undefined;
    maxPaymentUsdc?: string | undefined;
}>;
export type X402PayAndFetchInput = z.input<typeof x402PayAndFetchSchema>;
export declare const x402PayAndFetchTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        url: z.ZodString;
        method: z.ZodDefault<z.ZodOptional<z.ZodEnum<["GET", "POST", "PUT", "DELETE"]>>>;
        body: z.ZodOptional<z.ZodString>;
        rpcUrl: z.ZodOptional<z.ZodString>;
        agentId: z.ZodOptional<z.ZodString>;
        maxPaymentUsdc: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        method: "GET" | "POST" | "PUT" | "DELETE";
        maxPaymentUsdc: string;
        body?: string | undefined;
        agentId?: string | undefined;
        rpcUrl?: string | undefined;
    }, {
        url: string;
        body?: string | undefined;
        method?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
        agentId?: string | undefined;
        rpcUrl?: string | undefined;
        maxPaymentUsdc?: string | undefined;
    }>;
};
export declare function handleX402PayAndFetch(raw: X402PayAndFetchInput): Promise<import("../lib/toolResponse.js").ToolFailure | import("../lib/toolResponse.js").ToolSuccess<{
    status: number;
    statusText: string;
    data: unknown;
    paymentExecuted: boolean;
    paymentDetails: null;
    chainId: number;
    environment: string;
    isMainnet: boolean;
    policy: import("../lib/policy/actionPolicyEngine.js").ActionPolicyResult;
    source: string;
}> | import("../lib/toolResponse.js").ToolSuccess<{
    status: number;
    statusText: string;
    data: unknown;
    paymentExecuted: boolean;
    paymentDetails: {
        headerRedacted: boolean;
        note: string;
    } | null;
    signerMode: import("../lib/signer/index.js").SignerMode;
    walletAddress: `0x${string}`;
    paymentToken: `0x${string}`;
    maxPaymentUsdc: string;
    chainId: number;
    environment: string;
    isMainnet: boolean;
    policy: import("../lib/policy/actionPolicyEngine.js").ActionPolicyResult;
    testnetPayment: boolean;
    source: string;
}>>;
//# sourceMappingURL=x402PayAndFetch.d.ts.map