import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const explainRiskSchema: z.ZodObject<{
    decision: z.ZodEnum<["ALLOW", "WARN", "BLOCK", "REQUIRE_CONFIRMATION", "REQUIRE_FUNDING", "REQUIRE_TOKEN_REVIEW"]>;
    riskLevel: z.ZodEnum<["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]>;
    reasons: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    requiredActions: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    environment: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    chainId: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    isMainnet: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
    environment: string;
    chainId: number;
    isMainnet: boolean;
    decision: "ALLOW" | "WARN" | "BLOCK" | "REQUIRE_CONFIRMATION" | "REQUIRE_FUNDING" | "REQUIRE_TOKEN_REVIEW";
    reasons: string[];
    requiredActions: string[];
}, {
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
    decision: "ALLOW" | "WARN" | "BLOCK" | "REQUIRE_CONFIRMATION" | "REQUIRE_FUNDING" | "REQUIRE_TOKEN_REVIEW";
    environment?: string | undefined;
    chainId?: number | undefined;
    isMainnet?: boolean | undefined;
    reasons?: string[] | undefined;
    requiredActions?: string[] | undefined;
}>;
export type ExplainRiskInput = z.input<typeof explainRiskSchema>;
export declare function handleExplainRisk(raw: ExplainRiskInput): Promise<ToolResponse<unknown>>;
//# sourceMappingURL=explainRisk.d.ts.map