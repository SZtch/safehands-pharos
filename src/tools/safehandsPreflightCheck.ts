// ─── Tool: safehands_preflight_check ───────────────────────────────────
// Branded SafeHands transaction safety firewall preflight.
// ───────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { fail, ok, type ToolResponse } from "../lib/toolResponse.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, X402_PAYMENT_TOKEN_ADDRESS } from "../lib/constants.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { mapEngineDecision } from "../lib/guardian/decision.js";
import { isExecutionAvailable } from "../lib/config.js";
import { classifyTokenRegistryStatus } from "./tokenRegistryStatus.js";
import { validatePositiveAmount, validateNonZeroAddress, validateAddress, validateTokenIdentifier, collectErrors } from "../lib/validation.js";
import { assertSafeFetchUrl } from "../lib/http.js";

const WRITE_ACTION_TYPES = new Set([
  "send_payment", "approve_token", "execute_swap",
  "x402_pay_and_fetch", "publish_risk_score", "custom_contract_call",
]);

export const safehandsPreflightCheckSchema = z.object({
  actionType: z.enum(["send_payment", "approve_token", "execute_swap", "x402_pay_and_fetch", "publish_risk_score", "custom_contract_call"]),
  agentId: z.string().optional().describe("Agent identifier; selects the per-agent safety policy used for this preflight"),
  chainId: z.number().optional().default(CHAIN_ID),
  environment: z.string().optional().default(PHAROS_ENVIRONMENT),
  isMainnet: z.boolean().optional(),
  amount: z.string().optional(),
  amountUnit: z.enum(["PROS", "USDC", "USD", "TOKEN"]).optional(),
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
  walletAddress: z.string().optional(),
  score: z.number().optional(),
  targetContract: z.string().optional(),
  data: z.string().optional(),
}).strict();

export type SafeHandsPreflightCheckInput = z.input<typeof safehandsPreflightCheckSchema>;

function validateActionFields(input: z.infer<typeof safehandsPreflightCheckSchema>): string[] {
  const errors: (string | null)[] = [];

  switch (input.actionType) {
    case "send_payment":
      errors.push(validatePositiveAmount(input.amount, "amount"));
      errors.push(validateNonZeroAddress(input.recipient, "recipient"));
      break;

    case "approve_token":
      if (!input.approvalAmount && !input.amount) {
        errors.push("approvalAmount (or amount) is required for approve_token.");
      }
      if (!input.spender) {
        errors.push("spender is required for approve_token.");
      } else {
        errors.push(validateAddress(input.spender, "spender"));
      }
      if (!input.approvalToken && !input.tokenAddress && !input.token) {
        errors.push("approvalToken (or tokenAddress/token) is required for approve_token.");
      } else {
        const tokenValue = input.approvalToken || input.tokenAddress || input.token;
        errors.push(validateTokenIdentifier(tokenValue, "approvalToken"));
      }
      break;

    case "execute_swap":
      errors.push(validatePositiveAmount(input.amount, "amount"));
      if (!input.tokenIn) {
        errors.push("tokenIn is required for execute_swap.");
      } else {
        errors.push(validateTokenIdentifier(input.tokenIn, "tokenIn"));
      }
      if (!input.tokenOut) {
        errors.push("tokenOut is required for execute_swap.");
      } else {
        errors.push(validateTokenIdentifier(input.tokenOut, "tokenOut"));
      }
      break;

    case "x402_pay_and_fetch":
      if (!input.url) {
        errors.push("url is required for x402_pay_and_fetch.");
      }
      if (input.paymentAmountUsdc) {
        errors.push(validatePositiveAmount(input.paymentAmountUsdc, "paymentAmountUsdc"));
      }
      break;

    case "publish_risk_score":
      if (!input.walletAddress) {
        errors.push("walletAddress is required for publish_risk_score.");
      } else {
        errors.push(validateNonZeroAddress(input.walletAddress, "walletAddress"));
      }
      if (input.score === undefined || input.score === null) {
        errors.push("score is required for publish_risk_score.");
      } else if (!Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
        errors.push("score must be between 0 and 100.");
      }
      break;

    case "custom_contract_call":
      if (!input.targetContract) {
        errors.push("targetContract is required for custom_contract_call.");
      } else {
        errors.push(validateAddress(input.targetContract, "targetContract"));
      }
      if (!input.data) {
        errors.push("data is required for custom_contract_call.");
      }
      break;
  }

  return collectErrors(errors);
}

export async function handleSafeHandsPreflightCheck(raw: SafeHandsPreflightCheckInput): Promise<ToolResponse<unknown>> {
  let input: z.infer<typeof safehandsPreflightCheckSchema>;
  try {
    input = safehandsPreflightCheckSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `Preflight input validation failed: ${msg}`, false, "safehands_preflight_check");
  }

  const fieldErrors = validateActionFields(input);
  if (fieldErrors.length > 0) {
    return fail(
      "VALIDATION_ERROR",
      `Missing or invalid required fields for ${input.actionType}: ${fieldErrors.join(" ")}`,
      false,
      "safehands_preflight_check"
    );
  }

  if (input.actionType === "x402_pay_and_fetch" && input.url) {
    try {
      await assertSafeFetchUrl(input.url);
    } catch (err) {
      return fail(
        "SSRF_BLOCKED",
        err instanceof Error ? err.message.replace(/^SSRF_BLOCKED:\s*/, "") : String(err),
        false,
        "safehands_preflight_check"
      );
    }
  }

  const isWriteAction = WRITE_ACTION_TYPES.has(input.actionType);
  const effectiveRequiresSigner = input.requiresSigner ?? (isWriteAction && input.signerAvailable !== undefined ? true : input.requiresSigner);

  const tokenForRegistry = input.tokenAddress || input.token || input.tokenOut || input.tokenIn;
  const registry = tokenForRegistry ? classifyTokenRegistryStatus(tokenForRegistry) : null;

  // Fail-closed on the token-security dimension: for token-trading/approval actions
  // the caller must not be able to skip the honeypot/tax signal by simply omitting
  // tokenSecurityStatus. Absent → treat as "unknown" so the engine routes to
  // REQUIRE_TOKEN_REVIEW instead of silently reaching ALLOW.
  const tokenSecurityStatus =
    input.tokenSecurityStatus ??
    (input.actionType === "execute_swap" || input.actionType === "approve_token" ? "unknown" : undefined);

  const policy = evaluateActionPolicy({
    ...input,
    requiresSigner: effectiveRequiresSigner,
    tokenRegistryStatus: registry?.status,
    tokenSecurityStatus,
  });

  // Expose only the public four-value SafeHands decision; keep policy reasons,
  // checks, and risk level for explanation.
  const guardianDecision = mapEngineDecision(policy.decision, {
    executionAvailable: isExecutionAvailable(),
  });

  return ok({
    ...policy,
    decision: guardianDecision,
    guardianDecision,
    tokenRegistry: registry,
    source: "safehands_preflight_check",
  });
}
