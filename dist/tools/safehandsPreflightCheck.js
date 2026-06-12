// ─── Tool: safehands_preflight_check ───────────────────────────────────
// Branded SafeHands transaction safety firewall preflight.
// ───────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { ok } from "../lib/toolResponse.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, X402_PAYMENT_TOKEN_ADDRESS } from "../lib/constants.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { classifyTokenRegistryStatus } from "./tokenRegistryStatus.js";
export const safehandsPreflightCheckSchema = z.object({
    actionType: z.enum(["send_payment", "approve_token", "execute_swap", "x402_pay_and_fetch", "publish_risk_score", "custom_contract_call"]),
    chainId: z.number().optional().default(CHAIN_ID),
    environment: z.string().optional().default(PHAROS_ENVIRONMENT),
    isMainnet: z.boolean().optional().default(IS_MAINNET),
    amount: z.string().optional(),
    amountUnit: z.enum(["PHRS", "USDC", "USD", "TOKEN"]).optional(),
    token: z.string().optional(),
    tokenAddress: z.string().optional(),
    tokenIn: z.string().optional(),
    tokenOut: z.string().optional(),
    recipient: z.string().optional(),
    spender: z.string().optional(),
    approvalAmount: z.string().optional(),
    approvalToken: z.string().optional(),
    approvalUnlimited: z.boolean().optional(),
    url: z.string().optional(),
    paymentAmountUsdc: z.string().optional(),
    paymentTokenAddress: z.string().optional().default(X402_PAYMENT_TOKEN_ADDRESS),
    signerAvailable: z.boolean().optional(),
    tokenSecurityStatus: z.enum(["ok", "unavailable", "unknown"]).optional(),
    recipientVerified: z.boolean().optional(),
    spenderVerified: z.boolean().optional(),
    requiresSigner: z.boolean().optional(),
});
export async function handleSafeHandsPreflightCheck(raw) {
    const input = safehandsPreflightCheckSchema.parse(raw);
    const tokenForRegistry = input.tokenAddress || input.token || input.tokenOut || input.tokenIn;
    const registry = tokenForRegistry ? classifyTokenRegistryStatus(tokenForRegistry) : null;
    const policy = evaluateActionPolicy({
        ...input,
        tokenRegistryStatus: registry?.status,
    });
    return ok({
        ...policy,
        tokenRegistry: registry,
        source: "safehands_preflight_check",
    });
}
//# sourceMappingURL=safehandsPreflightCheck.js.map