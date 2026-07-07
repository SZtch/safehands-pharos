// ─── Tool: safehands_x402_preflight ────────────────────────────────────
// Checks whether an x402 paid resource is safe before payment signing.
// ───────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { ok, fail, type ToolResponse } from "../lib/toolResponse.js";
import { assertSafeFetchUrl, fetchWithTimeoutAndRetry } from "../lib/http.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, MAX_X402_PAYMENT_USDC, X402_PAYMENT_TOKEN_ADDRESS, IS_MAINNET } from "../lib/constants.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { mapEngineDecision } from "../lib/guardian/decision.js";
import { isExecutionAvailable } from "../lib/config.js";
import { analyzeX402 } from "../lib/analysis/x402.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { isValidPositiveAmount } from "../lib/validation.js";

export const safehandsX402PreflightSchema = z.object({
  url: z.string(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("GET"),
  paymentAmountUsdc: z.string().optional().default("0.001"),
  paymentTokenAddress: z.string().optional().default(X402_PAYMENT_TOKEN_ADDRESS),
  agentId: z.string().optional(),
  probeEndpoint: z.boolean().optional().default(false),
});

export type SafeHandsX402PreflightInput = z.input<typeof safehandsX402PreflightSchema>;

export async function handleSafeHandsX402Preflight(raw: SafeHandsX402PreflightInput): Promise<ToolResponse<unknown>> {
  const input = safehandsX402PreflightSchema.parse(raw);

  if (!isValidPositiveAmount(input.paymentAmountUsdc)) {
    return fail(
      "VALIDATION_ERROR",
      `paymentAmountUsdc must be a valid positive number (got "${input.paymentAmountUsdc}").`,
      false,
      "safehands_x402_preflight"
    );
  }

  try {
    await assertSafeFetchUrl(input.url);
  } catch (err) {
    return fail(
      "SSRF_BLOCKED",
      err instanceof Error ? err.message.replace(/^SSRF_BLOCKED:\s*/, "") : String(err),
      false,
      "safehands_x402_preflight"
    );
  }

  let detectedStatus: number | null = null;
  let paymentRequired: boolean | "unknown" = "unknown";
  if (input.probeEndpoint) {
    try {
      const res = await fetchWithTimeoutAndRetry(input.url, { method: input.method, timeoutMs: 7_500, retries: 0 });
      detectedStatus = res.status;
      paymentRequired = res.status === 402;
    } catch {
      paymentRequired = "unknown";
    }
  }

  const signer = await getSigner(input.agentId, { purpose: "x402" });
  const signerAvailable = !isSignerFailure(signer);
  const policy = evaluateActionPolicy({
    actionType: "x402_pay_and_fetch",
    agentId: input.agentId,
    url: input.url,
    paymentAmountUsdc: input.paymentAmountUsdc,
    paymentTokenAddress: input.paymentTokenAddress,
    signerAvailable,
    requiresSigner: paymentRequired === true,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: IS_MAINNET,
  });

  const analysis = analyzeX402({
    url: input.url,
    paymentAmountUsdc: input.paymentAmountUsdc,
    paymentTokenAddress: input.paymentTokenAddress,
    agentId: input.agentId,
    chainId: CHAIN_ID,
  });

  const guardianDecision = mapEngineDecision(policy.decision, {
    executionAvailable: isExecutionAvailable(),
  });

  return ok({
    ...policy,
    decision: guardianDecision,
    guardianDecision,
    url: input.url,
    method: input.method,
    paymentAmountUsdc: input.paymentAmountUsdc,
    maxPaymentUsdc: MAX_X402_PAYMENT_USDC,
    paymentTokenAddress: input.paymentTokenAddress,
    signerAvailable,
    signerMode: signerAvailable ? signer.mode : null,
    signerError: signerAvailable ? null : signer.error,
    probe: { enabled: input.probeEndpoint, status: detectedStatus, paymentRequired },
    mainnetPayment: true,
    analysis,
    source: "safehands_x402_preflight",
  });
}
