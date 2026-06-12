import { z } from "zod";
import { type ToolResponse } from "../lib/toolResponse.js";
export declare const safehandsSafeExecuteSchema: z.ZodObject<{
    path: z.ZodEnum<["safe_execute_send_payment", "safe_execute_approve_token", "safe_execute_swap", "safe_x402_pay_and_fetch"]>;
    execute: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    confirmExecution: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    action: z.ZodRecord<z.ZodString, z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    path: "safe_execute_send_payment" | "safe_execute_approve_token" | "safe_execute_swap" | "safe_x402_pay_and_fetch";
    execute: boolean;
    confirmExecution: boolean;
    action: Record<string, any>;
}, {
    path: "safe_execute_send_payment" | "safe_execute_approve_token" | "safe_execute_swap" | "safe_x402_pay_and_fetch";
    action: Record<string, any>;
    execute?: boolean | undefined;
    confirmExecution?: boolean | undefined;
}>;
export type SafeHandsSafeExecuteInput = z.input<typeof safehandsSafeExecuteSchema>;
export declare function handleSafeHandsSafeExecute(raw: SafeHandsSafeExecuteInput): Promise<ToolResponse<unknown>>;
//# sourceMappingURL=safehandsSafeExecute.d.ts.map