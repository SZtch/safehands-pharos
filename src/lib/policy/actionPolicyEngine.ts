// ─── SafeHands Action Policy Engine ───────────────────────────────────
// Reusable transaction safety firewall for AI agent actions on Pharos.
// It is intentionally deterministic. Mainnet-first (Pharos Pacific, chain 1672).
// ───────────────────────────────────────────────────────────────────────

import { isAddress, parseUnits } from "viem";
import { isDenylistedRecipient } from "../recipientSafety.js";
import {
  CHAIN_ID,
  PHAROS_ENVIRONMENT,
  COUNTERPARTY_CRITICAL_THRESHOLD,
  MAX_APPROVAL_AMOUNT_USDC,
  MAX_TX_AMOUNT_PROS,
  MAX_X402_PAYMENT_USDC,
  RISK_BLOCK_THRESHOLD,
  activeX402AllowedTokenAddresses,
  PACIFIC_USDC_ADDRESS,
  PACIFIC_WPROS_ADDRESS,
  USDC_ADDRESS,
  WPROS_ADDRESS,
  isCanonicalInfrastructure,
} from "../constants.js";
import { getNetworkByChainId } from "../networks.js";
import { resolvePriceableToken } from "../spendAccumulator.js";
import { loadAgentPolicy, resolveEffectiveLimits, type AgentPolicy } from "./agentPolicy.js";
import type { RiskAssessment } from "../riskEngine.js";

export type SafeHandsActionType =
  | "send_payment"
  | "approve_token"
  | "execute_swap"
  | "x402_pay_and_fetch"
  | "publish_risk_score"
  | "custom_contract_call";

// Internal 6-value decision. Mapped to the public 4-value GuardianDecision by
// mapEngineDecision() (see docs/DECISION_CONTRACT.md). `WARN` is reserved for a
// future soft-advisory tier and is not currently emitted; it still maps safely
// to REQUIRE_CONFIRMATION.
export type PolicyDecision =
  | "ALLOW"
  | "WARN"
  | "BLOCK"
  | "REQUIRE_CONFIRMATION"
  | "REQUIRE_FUNDING"
  | "REQUIRE_TOKEN_REVIEW";

export type PolicyRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

export interface PolicyCheck {
  name: string;
  status: "pass" | "warn" | "fail" | "unknown";
  message: string;
}

/**
 * Advisory risk-engine output passed to the policy engine as EVIDENCE. The
 * policy engine, not the risk engine, decides (see docs/DECISION_CONTRACT.md).
 * Check names derived from this evidence are `risk_*` — deliberately containing
 * neither "token" nor "funding" so the decision remap below never applies.
 */
export interface PolicyRiskEvidence {
  /** 0-100 weighted risk score. */
  score: number;
  /** Critical risk signal could not be evaluated (H2) — never sign silently. */
  degraded: boolean;
  degradedReasons?: string[];
  /** Counterparty breakdown dimension (0-100). */
  counterpartyRisk?: number;
  /** Structural SWAP_LIQUIDITY_NOT_CONFIGURED state (permanent, not transient). */
  swapProviderNotConfigured?: boolean;
}

/** Projects a RiskAssessment into the policy-evidence shape. Single mapper — write tools must use this rather than hand-rolling the projection. */
export function riskEvidenceFromAssessment(a: RiskAssessment): PolicyRiskEvidence {
  return {
    score: a.riskScore,
    degraded: a.degraded,
    degradedReasons: a.degradedReasons,
    counterpartyRisk: a.breakdown.counterpartyRisk,
    swapProviderNotConfigured: a.swapProviderNotConfigured,
  };
}

export interface ActionPolicyInput {
  actionType: SafeHandsActionType;
  environment?: string;
  chainId?: number;
  isMainnet?: boolean;
  amount?: string;
  amountUnit?: "PROS" | "USDC" | "USD" | "TOKEN";
  token?: string;
  tokenAddress?: string;
  tokenIn?: string;
  tokenOut?: string;
  recipient?: string;
  spender?: string;
  targetContract?: string;
  approvalAmount?: string;
  approvalToken?: string;
  approvalUnlimited?: boolean;
  url?: string;
  paymentAmountUsdc?: string;
  paymentTokenAddress?: string;
  walletAddress?: string;
  walletBalancePhs?: string;
  signerAvailable?: boolean;
  tokenSecurityStatus?: "ok" | "unavailable" | "unknown";
  tokenRegistryStatus?: string;
  /**
   * Caller CLAIM that the recipient was verified — never independently confirmed
   * by this engine. Omitted = treated as unverified (fail-closed), never as safe.
   */
  recipientVerified?: boolean;
  /** Caller CLAIM (same semantics as recipientVerified). */
  spenderVerified?: boolean;
  allowUnlimitedApproval?: boolean;
  writeToolsEnabled?: boolean;
  requiresSigner?: boolean;
  agentId?: string;
  agentPolicy?: AgentPolicy;
  /**
   * Advisory risk-engine output passed as EVIDENCE (riskEvidenceFromAssessment).
   * Write tools MUST provide this and gate with `requireRiskEvidence: true` —
   * never gate on riskEngine output directly. Omitted by structural/preflight
   * callers, which then get no risk_* checks.
   */
  risk?: PolicyRiskEvidence;
}

export interface ActionPolicyResult {
  decision: PolicyDecision;
  riskLevel: PolicyRiskLevel;
  safeToExecute: boolean;
  reasons: string[];
  requiredActions: string[];
  checks: PolicyCheck[];
  environment: string;
  chainId: number;
  isMainnet: boolean;
}

function numeric(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pushCheck(
  checks: PolicyCheck[],
  name: string,
  status: PolicyCheck["status"],
  message: string,
  reasons?: string[],
  requiredActions?: string[],
  reason?: string,
  action?: string
): void {
  checks.push({ name, status, message });
  if (status === "fail" && reasons && reason) reasons.push(reason);
  if ((status === "fail" || status === "warn") && requiredActions && action) requiredActions.push(action);
}

export function isUnlimitedApprovalAmount(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (["max", "unlimited", "infinite", "uint256_max"].includes(normalized)) return true;
  try {
    return BigInt(normalized) >= 2n ** 255n;
  } catch {
    return false;
  }
}

function isSuspiciousUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  if (!["http:", "https:"].includes(parsed.protocol)) return true;

  // ALLOW_LOCAL_X402_FETCH relaxes ONLY loopback, and only outside production.
  // Cloud-metadata / private / link-local ranges are ALWAYS suspicious — the flag
  // can no longer wave through 169.254.169.254 or RFC1918 hosts.
  const isLoopback =
    host === "localhost" || host.endsWith(".localhost") ||
    host === "127.0.0.1" || host.startsWith("127.") ||
    host === "[::1]" || host === "::1";
  const loopbackBypass =
    process.env.ALLOW_LOCAL_X402_FETCH === "true" &&
    (process.env.NODE_ENV || "").toLowerCase() !== "production";
  if (isLoopback) return loopbackBypass ? false : true;

  if (host === "0.0.0.0") return true;
  if (/^0\./.test(host)) return true;
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host.startsWith("169.254.")) return true;
  if (host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80:")) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  return false;
}

function classifyRisk(checks: PolicyCheck[]): PolicyRiskLevel {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const unknowns = checks.filter((c) => c.status === "unknown").length;
  if (fails >= 3) return "CRITICAL";
  if (fails > 0) return "HIGH";
  if (warns >= 2) return "MEDIUM";
  if (warns > 0 || unknowns > 0) return "MEDIUM";
  return "LOW";
}

function defaultDecision(riskLevel: PolicyRiskLevel, checks: PolicyCheck[]): PolicyDecision {
  if (checks.some((c) => c.status === "fail")) return "BLOCK";
  if (riskLevel === "MEDIUM") return "REQUIRE_CONFIRMATION";
  if (riskLevel === "UNKNOWN") return "REQUIRE_TOKEN_REVIEW";
  return "ALLOW";
}

export function evaluateActionPolicy(input: ActionPolicyInput): ActionPolicyResult {
  const environment = input.environment || PHAROS_ENVIRONMENT;
  const chainId = input.chainId ?? CHAIN_ID;
  const network = getNetworkByChainId(chainId);
  const isMainnet = input.isMainnet ?? network?.isMainnet ?? false;
  const checks: PolicyCheck[] = [];
  const reasons: string[] = [];
  const requiredActions: string[] = [];

  const policy = input.agentPolicy ?? loadAgentPolicy(input.agentId);
  const effectiveLimits = resolveEffectiveLimits(policy);

  // Chain guard: only supported Pharos networks pass. Unknown chains (e.g.
  // Ethereum mainnet, chain 1) are blocked. Pharos Pacific Mainnet (1672) is a
  // supported network for read-only SafeHands checks.
  if (!network) {
    pushCheck(checks, "chain_id", "fail", `Chain ID ${chainId} is not a supported Pharos network.`, reasons, requiredActions, "Unsupported chain.", "Use Pharos Pacific Mainnet (1672) or Atlantic Testnet (688689).");
  } else {
    pushCheck(checks, "chain_id", "pass", `Chain ID is ${network.label} (${chainId}).`);
  }

  // Mainnet read-only SafeHands checks are allowed. Mainnet execution / write /
  // payment is disabled by default and gated separately (WRITE_TOOLS_ENABLED and
  // the network executionAllowed flag) — it is never live here.
  if (isMainnet) {
    pushCheck(checks, "mainnet_guard", "pass", `${network ? network.label : "Pharos mainnet"} — read-only SafeHands checks allowed; execution/write/payment is gated and disabled by default.`);
  } else {
    pushCheck(checks, "mainnet_guard", "pass", "Action is not targeting mainnet.");
  }

  if (environment !== PHAROS_ENVIRONMENT) {
    pushCheck(checks, "environment", "warn", `Expected ${PHAROS_ENVIRONMENT}, received ${environment}.`, reasons, requiredActions, undefined, "Verify the runtime environment before execution.");
  } else {
    pushCheck(checks, "environment", "pass", `Environment is ${PHAROS_ENVIRONMENT}.`);
  }

  if (input.requiresSigner && input.signerAvailable === false) {
    pushCheck(checks, "signer", "fail", "No signer is available for this write/payment action.", reasons, requiredActions, "No signer available.", "Configure WALLET_MODE=managed-mainnet, X402_SIGNER_PRIVATE_KEY, or PRIVATE_KEY for mainnet only.");
  } else if (input.requiresSigner && input.signerAvailable === undefined) {
    pushCheck(checks, "signer_unknown", "warn", "Signer availability is unknown — a signer will be required for execution.", reasons, requiredActions, undefined, "Ensure a signer is available before executing this write/payment action.");
  }

    if (input.actionType === "send_payment") {
      const amount = numeric(input.amount);
      const paymentLimit = effectiveLimits.maxPaymentPROS;
      if (amount !== null && amount > paymentLimit) {
        pushCheck(checks, "payment_limit", "fail", `Payment ${amount} PROS exceeds limit ${paymentLimit} PROS (policy: ${policy.profile}).`, reasons, requiredActions, "Payment exceeds configured PROS limit.", "Reduce amount or adjust agent policy.");
      } else {
        pushCheck(checks, "payment_limit", "pass", `Payment is within ${paymentLimit} PROS limit (policy: ${policy.profile}).`);
      }
      
      const balance = numeric(input.walletBalancePhs);
      if (amount !== null && balance !== null) {
        if (amount > balance) {
          pushCheck(checks, "funding_balance", "fail", `Insufficient PROS balance. Have ${balance}, need ${amount}.`, reasons, requiredActions, "Insufficient PROS balance.", "Fund the wallet before executing.");
        } else {
          pushCheck(checks, "funding_balance", "pass", "Sufficient PROS balance for payment.");
        }
      }

      if (input.recipient && !isAddress(input.recipient)) {
        pushCheck(checks, "recipient_address", "fail", "Recipient address is invalid.", reasons, requiredActions, "Invalid recipient address.", "Provide a valid EVM address.");
      } else if (isDenylistedRecipient(input.recipient)) {
        pushCheck(checks, "recipient_denylist", "fail", "Recipient is on the operator denylist (known-bad address).", reasons, requiredActions, "Recipient address is denylisted.", "Do not send to this address — it is flagged as known-bad by the operator.");
      } else if (input.recipientVerified === false) {
        pushCheck(checks, "recipient_reputation", "warn", "Recipient is unverified.", reasons, requiredActions, undefined, "Verify recipient before sending funds.");
      } else if (input.recipient && input.recipientVerified === undefined) {
        // Fail-closed: recipientVerified is a caller CLAIM. When it is omitted, no
        // verification happened — treat exactly like an unverified recipient instead
        // of silently skipping the reputation check (truth-model rule 5).
        pushCheck(checks, "recipient_reputation", "unknown", "Recipient verification was not asserted — the recipient is treated as an unverified claim.", reasons, requiredActions, undefined, "Verify the recipient against chain/registry evidence before sending funds.");
      } else if (input.recipient && input.recipientVerified === true) {
        pushCheck(checks, "recipient_reputation", "pass", "Recipient verification asserted by the caller (caller-attested claim; not independently verified by SafeHands).");
      }
    }

  if (input.actionType === "approve_token") {
    const unlimited = input.approvalUnlimited || isUnlimitedApprovalAmount(input.approvalAmount) || isUnlimitedApprovalAmount(input.amount);
    if (unlimited && input.allowUnlimitedApproval !== true) {
      pushCheck(checks, "approval_amount", "fail", "Unlimited approval is blocked by default.", reasons, requiredActions, "Unlimited approval requested.", "Use a limited approval amount.");
    } else {
      const approvalAmount = numeric(input.approvalAmount) ?? numeric(input.amount);
      const approvalLimit = effectiveLimits.maxApprovalUSDC;
      if (approvalAmount !== null && approvalAmount > approvalLimit) {
        pushCheck(checks, "approval_limit", "fail", `Approval ${approvalAmount} exceeds limit ${approvalLimit} (policy: ${policy.profile}).`, reasons, requiredActions, "Approval exceeds configured limit.", "Reduce approval or adjust agent policy.");
      } else {
        pushCheck(checks, "approval_limit", "pass", `Approval is within ${approvalLimit} USDC-equivalent limit (policy: ${policy.profile}).`);
      }
    }
    if (input.spender && !isAddress(input.spender)) {
      pushCheck(checks, "spender_address", "fail", "Spender address is invalid.", reasons, requiredActions, "Invalid spender address.", "Provide a valid spender address.");
    } else if (input.spenderVerified === false) {
      pushCheck(checks, "spender_reputation", "warn", "Spender is unverified.", reasons, requiredActions, undefined, "Verify spender contract before approving.");
    } else if (input.spender && input.spenderVerified === undefined) {
      // Fail-closed: same rule as recipientVerified — an omitted claim is not evidence.
      pushCheck(checks, "spender_reputation", "unknown", "Spender verification was not asserted — the spender is treated as an unverified claim.", reasons, requiredActions, undefined, "Verify the spender contract against chain/registry evidence before approving.");
    } else if (input.spender && input.spenderVerified === true) {
      pushCheck(checks, "spender_reputation", "pass", "Spender verification asserted by the caller (caller-attested claim; not independently verified by SafeHands).");
    }
  }

  if (input.actionType === "execute_swap") {
    const amount = numeric(input.amount);
    const swapLimit = effectiveLimits.maxSwapPROS;
    if (amount !== null && amount > swapLimit && (input.tokenIn || "").toUpperCase() === "PROS") {
      pushCheck(checks, "swap_amount_limit", "fail", `Swap ${amount} PROS exceeds limit ${swapLimit} PROS (policy: ${policy.profile}).`, reasons, requiredActions, "Swap exceeds configured PROS limit.", "Reduce amount or adjust agent policy.");
    }

    // P0-3: an input token that cannot be priced in USD contributes $0 to
    // MAX_DAILY_SPEND_USD and has no per-transaction ceiling — the spend caps would
    // silently not apply. Deny by default (fail → BLOCK, never confirmable).
    if (input.tokenIn && resolvePriceableToken(input.tokenIn) === null) {
      pushCheck(checks, "swap_notional_unpriceable", "fail", `Swap input token ${input.tokenIn} cannot be priced in USD, so the daily USD cap and per-transaction ceiling cannot bound this spend — denied by default.`, reasons, requiredActions, "Unpriceable input token would escape spend caps.", "Swap a priceable token (PROS, WPROS, USDC, USDT) or add the token to the price map before enabling it.");
    }

    const balance = numeric(input.walletBalancePhs);
    if (amount !== null && balance !== null && (input.tokenIn || "").toUpperCase() === "PROS") {
      if (amount > balance) {
        pushCheck(checks, "funding_balance", "fail", `Insufficient PROS balance. Have ${balance}, need ${amount}.`, reasons, requiredActions, "Insufficient PROS balance.", "Fund the wallet before executing.");
      } else {
        pushCheck(checks, "funding_balance", "pass", "Sufficient PROS balance for swap.");
      }
    }
  }

  if (input.actionType === "custom_contract_call" && input.targetContract) {
    if (isCanonicalInfrastructure(input.targetContract, isMainnet)) {
      pushCheck(checks, "canonical_contract", "pass", `Contract ${input.targetContract} is recognized as official Pharos canonical infrastructure.`);
    } else {
      pushCheck(checks, "unknown_contract", "warn", `Contract ${input.targetContract} is not recognized as canonical Pharos infrastructure.`, reasons, requiredActions, undefined, "Review the contract interaction carefully before confirming.");
    }
  }

  if (input.actionType === "x402_pay_and_fetch") {
    if (isSuspiciousUrl(input.url)) {
      pushCheck(checks, "x402_url", "fail", "x402 URL is SSRF-sensitive or invalid.", reasons, requiredActions, "SSRF-sensitive x402 URL blocked.", "Use a public HTTPS/HTTP endpoint or set ALLOW_LOCAL_X402_FETCH only for local tests.");
    } else {
      pushCheck(checks, "x402_url", "pass", "x402 URL passed static SSRF checks.");
    }

    const payment = numeric(input.paymentAmountUsdc);
    const x402Limit = effectiveLimits.maxX402PaymentUSDC;
    if (payment !== null && payment > x402Limit) {
      pushCheck(checks, "x402_payment_limit", "fail", `x402 payment ${payment} USDC exceeds limit ${x402Limit} USDC (policy: ${policy.profile}).`, reasons, requiredActions, "x402 payment exceeds configured limit.", "Reduce payment amount or adjust agent policy.");
    } else {
      pushCheck(checks, "x402_payment_limit", "pass", `x402 payment is within ${x402Limit} USDC limit (policy: ${policy.profile}).`);
    }

    const balance = numeric(input.walletBalancePhs);
    if (payment !== null && balance !== null && (input.paymentTokenAddress || "").toLowerCase() === PACIFIC_USDC_ADDRESS.toLowerCase()) {
      if (payment > balance) {
        pushCheck(checks, "funding_balance_x402", "fail", `Insufficient USDC balance for x402 payment. Have ${balance}, need ${payment}.`, reasons, requiredActions, "Insufficient USDC balance.", "Fund the wallet with USDC.");
      } else {
        pushCheck(checks, "funding_balance_x402", "pass", "Sufficient USDC balance for x402 payment.");
      }
    }

    const allowedX402Tokens = activeX402AllowedTokenAddresses().map((a) => a.toLowerCase());
    if (input.paymentTokenAddress && !allowedX402Tokens.includes(input.paymentTokenAddress.toLowerCase())) {
      const mainnetMsg = `supported x402 payment tokens are Pacific USDC (${PACIFIC_USDC_ADDRESS}) or Pacific WPROS (${PACIFIC_WPROS_ADDRESS})`;
      const testnetMsg = `supported x402 payment tokens are USDC (${USDC_ADDRESS}) or WPROS (${WPROS_ADDRESS})`;
      pushCheck(
        checks,
        "x402_payment_token",
        "fail",
        `Payment token ${input.paymentTokenAddress} is not a supported x402 payment token; ${isMainnet ? mainnetMsg : testnetMsg}.`,
        reasons,
        requiredActions,
        "x402 payment token is not supported for this network.",
        isMainnet ? "Use Pacific USDC or Pacific WPROS for x402 payments." : "Use the active network USDC or WPROS token for x402 payments."
      );
    } else if (input.paymentTokenAddress) {
      pushCheck(checks, "x402_payment_token", "pass", `Payment token ${input.paymentTokenAddress} is supported for x402 on ${isMainnet ? "Pharos Pacific Mainnet" : "the active Pharos network"}.`);
    }
  }

  const tokenStatus = input.tokenRegistryStatus;
  if (tokenStatus === "CUSTOM_NON_REGISTRY" || tokenStatus === "UNKNOWN") {
    pushCheck(checks, "token_registry", "warn", `Token registry status is ${tokenStatus}.`, reasons, requiredActions, undefined, "Review token contract before execution.");
  }
  if (input.tokenSecurityStatus === "unavailable") {
    // P0-2: intel is MISSING (provider outage / token not indexed) — nothing was
    // reviewed. Distinct check name so the write-execution gate can fail closed on it
    // (a caller confirmation cannot substitute for intel that never existed).
    pushCheck(checks, "token_security_intel_missing", "unknown", "Token security intelligence is unavailable (provider outage or token not indexed) — the token was NOT reviewed.", reasons, requiredActions, undefined, "Retry when the token-security provider is reachable, or verify the token independently before executing.");
  } else if (input.tokenSecurityStatus === "unknown") {
    pushCheck(checks, "token_security_provider", "unknown", "Token security provider is unavailable or unknown.", reasons, requiredActions, undefined, "Proceed only after manual token review.");
  }

  // ─── Advisory risk-engine evidence (write paths) ─────────────────────
  // The risk engine never gates execution itself: its output arrives here as
  // evidence and these checks are where the score/degradation actually decide.
  if (input.risk) {
    const risk = input.risk;
    if (risk.score > RISK_BLOCK_THRESHOLD) {
      pushCheck(checks, "risk_score", "fail", `Weighted risk score ${risk.score}/100 exceeds the block threshold (${RISK_BLOCK_THRESHOLD}).`, reasons, requiredActions, `Risk score ${risk.score}/100 exceeds the block threshold (${RISK_BLOCK_THRESHOLD}).`, "Review the risk reasons and adjust the transaction parameters significantly before retrying.");
    } else {
      pushCheck(checks, "risk_score", "pass", `Weighted risk score ${risk.score}/100 is within the block threshold (${RISK_BLOCK_THRESHOLD}).`);
    }

    if (typeof risk.counterpartyRisk === "number" && risk.counterpartyRisk >= COUNTERPARTY_CRITICAL_THRESHOLD) {
      pushCheck(checks, "risk_counterparty", "fail", `Counterparty risk ${risk.counterpartyRisk}/100 is critical (≥ ${COUNTERPARTY_CRITICAL_THRESHOLD}) — missing, invalid, or zero-address counterparty.`, reasons, requiredActions, "Critically risky counterparty (missing/invalid/zero recipient).", "Provide a valid, verified counterparty address.");
    } else if (typeof risk.counterpartyRisk === "number") {
      pushCheck(checks, "risk_counterparty", "pass", `Counterparty risk ${risk.counterpartyRisk}/100 is below the critical threshold (${COUNTERPARTY_CRITICAL_THRESHOLD}).`);
    }

    if (risk.degraded) {
      let detail = (risk.degradedReasons ?? []).join(" ") || "A critical risk signal could not be evaluated.";
      if (risk.swapProviderNotConfigured && !detail.includes("SWAP_LIQUIDITY_NOT_CONFIGURED")) {
        detail += " The swap liquidity provider is not configured for this chain (SWAP_LIQUIDITY_NOT_CONFIGURED) — a permanent configuration state, not a transient outage.";
      }
      pushCheck(checks, "risk_degraded", "unknown", `Risk assessment is degraded — ${detail}`, reasons, requiredActions, undefined, "Re-invoke with confirm=true only after manually reviewing the degraded risk data.");
      // Unknown-status checks do not populate `reasons`; surface the degradation
      // detail there anyway so the CONFIRMATION_REQUIRED envelope explains itself
      // (parity with the former tool-level degraded message).
      reasons.push(`Risk assessment is degraded — ${detail}`);
    } else {
      pushCheck(checks, "risk_degraded", "pass", "No critical risk signal was missing during assessment.");
    }
  }

  const riskLevel = classifyRisk(checks);
  let decision = defaultDecision(riskLevel, checks);

  // Soft, recoverable signals must NEVER downgrade a hard BLOCK. Only remap when
  // the block is *solely* a funding shortfall (fundable) or when no hard fail
  // exists at all (token-security unresolved → review before proceeding).
  const hardFails = checks.filter((c) => c.status === "fail");
  const onlyFundingFails = hardFails.length > 0 && hardFails.every((c) => c.name.includes("funding"));
  const hasTokenUnknown = checks.some((c) => c.name.includes("token") && c.status === "unknown");
  if (decision === "BLOCK" && onlyFundingFails) {
    decision = "REQUIRE_FUNDING";
  } else if (decision !== "BLOCK" && hasTokenUnknown) {
    decision = "REQUIRE_TOKEN_REVIEW";
  }

  return {
    decision,
    riskLevel,
    safeToExecute: decision === "ALLOW",
    reasons: [...new Set(reasons)],
    requiredActions: [...new Set(requiredActions)],
    checks,
    environment,
    chainId,
    isMainnet,
  };
}

/** Network-aware phrase for explanations — never hardcodes a single network. */
function networkPhrase(isMainnet: boolean): string {
  if (typeof isMainnet !== "boolean") return "the Pharos network";
  return isMainnet ? "Pharos Pacific Mainnet" : "Pharos Atlantic Testnet";
}

export function explainPolicyResult(result: ActionPolicyResult): string {
  if (result.decision === "ALLOW") {
    return `This action was allowed because it targets ${networkPhrase(result.isMainnet)}, passed policy checks, and stayed within configured safety limits.`;
  }
  const reasonText = result.reasons.length > 0 ? result.reasons.join(" ") : "one or more safety checks failed or require review.";
  const actionText = result.requiredActions.length > 0 ? ` SafeHands recommends: ${result.requiredActions.join(" ")}` : "";
  const verb = result.decision === "BLOCK" ? "blocked" : result.decision.toLowerCase().replaceAll("_", " ");
  return `This action was ${verb} because ${reasonText}${actionText}`;
}

export function parseTokenAmountToUnits(amount: string, decimals = 6): bigint | null {
  try {
    return parseUnits(amount, decimals);
  } catch {
    return null;
  }
}
