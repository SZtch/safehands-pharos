// ─── x402 Analyzer (read-only) ─────────────────────────────────────────
// Wraps the existing deterministic x402 policy checks: URL SSRF guard, payment
// amount vs policy limit, and payment-token allowlist. Pure and offline-safe
// (static SSRF check, no DNS, no network). Requires NO payment keys.
//
// SafeHands supports x402 preflight by default. Actual settlement remains gated
// behind signer availability, WRITE_TOOLS_ENABLED, policy checks, and authorization.
// ────────────────────────────────────────────────────────────────────────

import { isAddress } from "viem";
import { evaluateActionPolicy } from "../policy/actionPolicyEngine.js";
import { mapEngineDecision } from "../guardian/decision.js";
import { MAX_X402_PAYMENT_USDC, X402_PAYMENT_TOKEN_ADDRESS } from "../constants.js";
import { makeResult, type AnalyzerResult } from "./types.js";

export interface X402AnalysisInput {
  url: string;
  paymentAmountUsdc?: string;
  paymentTokenAddress?: string;
  payTo?: string;
  agentId?: string;
  chainId?: number;
}

export interface X402AnalysisDetails {
  url: string;
  paymentAmountUsdc: string;
  maxPaymentUsdc: string;
  paymentTokenAddress: string;
  payTo: string | null;
  payToValid: boolean | null;
  urlSafe: boolean;
  amountWithinLimit: boolean;
  tokenAllowlisted: boolean;
  mainnetPaymentOnly: true;
  mainnetPaymentSupported: boolean;
}

export function analyzeX402(input: X402AnalysisInput): AnalyzerResult<X402AnalysisDetails> {
  const paymentAmountUsdc = input.paymentAmountUsdc ?? "0.001";
  const paymentTokenAddress = input.paymentTokenAddress ?? X402_PAYMENT_TOKEN_ADDRESS;

  const policy = evaluateActionPolicy({
    actionType: "x402_pay_and_fetch",
    agentId: input.agentId,
    url: input.url,
    paymentAmountUsdc,
    paymentTokenAddress,
    chainId: input.chainId,
  });

  const urlCheck = policy.checks.find((c) => c.name === "x402_url");
  const amountCheck = policy.checks.find((c) => c.name === "x402_payment_limit");
  const tokenCheck = policy.checks.find((c) => c.name === "x402_payment_token");

  const urlSafe = urlCheck ? urlCheck.status === "pass" : false;
  const amountWithinLimit = amountCheck ? amountCheck.status === "pass" : true;
  const tokenAllowlisted = !tokenCheck || tokenCheck.status === "pass";

  const payToValid = input.payTo !== undefined ? isAddress(input.payTo) : null;
  const warnings = [...policy.requiredActions];
  if (payToValid === false) warnings.push("payTo recipient is not a valid EVM address.");

  // payment keys are never required for analysis; settlement is gated at the tool layer
  const decision = payToValid === false ? "BLOCK" : mapEngineDecision(policy.decision);

  return makeResult<X402AnalysisDetails>({
    analyzer: "x402",
    decision,
    internalDecision: policy.decision,
    riskLevel: policy.riskLevel,
    reasons: policy.reasons.length ? policy.reasons : [urlSafe ? "x402 request passed static safety checks." : "x402 request failed a safety check."],
    warnings,
    analyzerStatus: "ok",
    details: {
      url: input.url,
      paymentAmountUsdc,
      maxPaymentUsdc: MAX_X402_PAYMENT_USDC,
      paymentTokenAddress,
      payTo: input.payTo ?? null,
      payToValid,
      urlSafe,
      amountWithinLimit,
      tokenAllowlisted,
      mainnetPaymentOnly: true,
      mainnetPaymentSupported: true,
    },
  });
}
