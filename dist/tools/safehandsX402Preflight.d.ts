import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const safehandsX402PreflightSchema: z.ZodObject<{
    url: z.ZodString;
    method: z.ZodDefault<z.ZodOptional<z.ZodEnum<["GET", "POST", "PUT", "DELETE"]>>>;
    paymentAmountUsdc: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    paymentTokenAddress: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    agentId: z.ZodOptional<z.ZodString>;
    probeEndpoint: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    url: string;
    paymentAmountUsdc: string;
    paymentTokenAddress: string;
    method: "GET" | "POST" | "PUT" | "DELETE";
    probeEndpoint: boolean;
    agentId?: string | undefined;
}, {
    url: string;
    paymentAmountUsdc?: string | undefined;
    paymentTokenAddress?: string | undefined;
    method?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
    agentId?: string | undefined;
    probeEndpoint?: boolean | undefined;
}>;
export type SafeHandsX402PreflightInput = z.input<typeof safehandsX402PreflightSchema>;
export declare function handleSafeHandsX402Preflight(raw: SafeHandsX402PreflightInput): Promise<ToolResponse<unknown>>;
//# sourceMappingURL=safehandsX402Preflight.d.ts.map