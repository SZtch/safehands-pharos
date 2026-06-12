// ─── SafeHands Action Policy Engine ───────────────────────────────────
// Reusable transaction safety firewall for AI agent actions on Pharos.
// It is intentionally deterministic and testnet-only.
// ───────────────────────────────────────────────────────────────────────
import { isAddress, parseUnits } from "viem";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, MAX_APPROVAL_AMOUNT_USDC, MAX_TX_AMOUNT_PHRS, MAX_X402_PAYMENT_USDC, USDC_ADDRESS, TEST_USDC_ADDRESS, } from "../constants.js";
function numeric(value) {
    if (!value)
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function pushCheck(checks, name, status, message, reasons, requiredActions, reason, action) {
    checks.push({ name, status, message });
    if (status === "fail" && reasons && reason)
        reasons.push(reason);
    if ((status === "fail" || status === "warn") && requiredActions && action)
        requiredActions.push(action);
}
export function isUnlimitedApprovalAmount(value) {
    if (!value)
        return false;
    const normalized = value.trim().toLowerCase();
    if (["max", "unlimited", "infinite", "uint256_max"].includes(normalized))
        return true;
    try {
        return BigInt(normalized) >= 2n ** 255n;
    }
    catch {
        return false;
    }
}
function isSuspiciousUrl(rawUrl) {
    if (!rawUrl)
        return false;
    if (process.env.ALLOW_LOCAL_X402_FETCH === "true")
        return false;
    try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        if (!["http:", "https:"].includes(parsed.protocol))
            return true;
        if (host === "localhost" || host.endsWith(".localhost"))
            return true;
        if (host === "127.0.0.1" || host.startsWith("127.") || host === "0.0.0.0")
            return true;
        if (host.startsWith("10.") || host.startsWith("192.168."))
            return true;
        if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host))
            return true;
        if (host === "[::1]" || host === "::1")
            return true;
        return false;
    }
    catch {
        return true;
    }
}
function classifyRisk(checks) {
    const fails = checks.filter((c) => c.status === "fail").length;
    const warns = checks.filter((c) => c.status === "warn").length;
    const unknowns = checks.filter((c) => c.status === "unknown").length;
    if (fails >= 3)
        return "CRITICAL";
    if (fails > 0)
        return "HIGH";
    if (warns >= 2)
        return "MEDIUM";
    if (warns > 0 || unknowns > 0)
        return "MEDIUM";
    return "LOW";
}
function defaultDecision(riskLevel, checks) {
    if (checks.some((c) => c.status === "fail"))
        return "BLOCK";
    if (riskLevel === "MEDIUM")
        return "REQUIRE_CONFIRMATION";
    if (riskLevel === "UNKNOWN")
        return "REQUIRE_TOKEN_REVIEW";
    return "ALLOW";
}
export function evaluateActionPolicy(input) {
    const environment = input.environment || PHAROS_ENVIRONMENT;
    const chainId = input.chainId ?? CHAIN_ID;
    const isMainnet = input.isMainnet ?? IS_MAINNET;
    const checks = [];
    const reasons = [];
    const requiredActions = [];
    if (isMainnet) {
        pushCheck(checks, "mainnet_guard", "fail", "Mainnet actions are blocked by SafeHands.", reasons, requiredActions, "Mainnet actions are not supported.", "Switch to Pharos Atlantic Testnet.");
    }
    else {
        pushCheck(checks, "mainnet_guard", "pass", "Action is not targeting mainnet.");
    }
    if (chainId !== CHAIN_ID) {
        pushCheck(checks, "chain_id", "fail", `Expected chain ID ${CHAIN_ID}, received ${chainId}.`, reasons, requiredActions, "Chain ID mismatch.", "Switch wallet/RPC to Pharos Atlantic Testnet.");
    }
    else {
        pushCheck(checks, "chain_id", "pass", `Chain ID is Pharos Atlantic Testnet (${CHAIN_ID}).`);
    }
    if (environment !== PHAROS_ENVIRONMENT) {
        pushCheck(checks, "environment", "warn", `Expected ${PHAROS_ENVIRONMENT}, received ${environment}.`, reasons, requiredActions, undefined, "Verify the runtime environment before execution.");
    }
    else {
        pushCheck(checks, "environment", "pass", `Environment is ${PHAROS_ENVIRONMENT}.`);
    }
    if (input.requiresSigner && !input.signerAvailable) {
        pushCheck(checks, "signer", "fail", "No signer is available for this write/payment action.", reasons, requiredActions, "No signer available.", "Configure WALLET_MODE=managed-testnet, X402_SIGNER_PRIVATE_KEY, or PRIVATE_KEY for testnet only.");
    }
    if (input.actionType === "send_payment") {
        const amount = numeric(input.amount);
        if (amount !== null && amount > Number(MAX_TX_AMOUNT_PHRS)) {
            pushCheck(checks, "payment_limit", "fail", `Payment ${amount} PHRS exceeds limit ${MAX_TX_AMOUNT_PHRS} PHRS.`, reasons, requiredActions, "Payment exceeds configured PHRS limit.", "Reduce amount or increase MAX_TX_AMOUNT_PHRS consciously for testnet.");
        }
        else {
            pushCheck(checks, "payment_limit", "pass", `Payment is within ${MAX_TX_AMOUNT_PHRS} PHRS limit.`);
        }
        if (input.recipient && !isAddress(input.recipient)) {
            pushCheck(checks, "recipient_address", "fail", "Recipient address is invalid.", reasons, requiredActions, "Invalid recipient address.", "Provide a valid EVM address.");
        }
        else if (input.recipientVerified === false) {
            pushCheck(checks, "recipient_reputation", "warn", "Recipient is unverified.", reasons, requiredActions, undefined, "Verify recipient before sending funds.");
        }
    }
    if (input.actionType === "approve_token") {
        const unlimited = input.approvalUnlimited || isUnlimitedApprovalAmount(input.approvalAmount) || isUnlimitedApprovalAmount(input.amount);
        if (unlimited && input.allowUnlimitedApproval !== true) {
            pushCheck(checks, "approval_amount", "fail", "Unlimited approval is blocked by default.", reasons, requiredActions, "Unlimited approval requested.", "Use a limited approval amount.");
        }
        else {
            const approvalAmount = numeric(input.approvalAmount) ?? numeric(input.amount);
            if (approvalAmount !== null && approvalAmount > Number(MAX_APPROVAL_AMOUNT_USDC)) {
                pushCheck(checks, "approval_limit", "fail", `Approval ${approvalAmount} exceeds limit ${MAX_APPROVAL_AMOUNT_USDC}.`, reasons, requiredActions, "Approval exceeds configured limit.", "Reduce approval or increase MAX_APPROVAL_AMOUNT_USDC consciously for testnet.");
            }
            else {
                pushCheck(checks, "approval_limit", "pass", `Approval is within ${MAX_APPROVAL_AMOUNT_USDC} USDC-equivalent limit.`);
            }
        }
        if (input.spender && !isAddress(input.spender)) {
            pushCheck(checks, "spender_address", "fail", "Spender address is invalid.", reasons, requiredActions, "Invalid spender address.", "Provide a valid spender address.");
        }
        else if (input.spenderVerified === false) {
            pushCheck(checks, "spender_reputation", "warn", "Spender is unverified.", reasons, requiredActions, undefined, "Verify spender contract before approving.");
        }
    }
    if (input.actionType === "execute_swap") {
        const amount = numeric(input.amount);
        if (amount !== null && amount > Number(MAX_TX_AMOUNT_PHRS) && (input.tokenIn || "").toUpperCase() === "PHRS") {
            pushCheck(checks, "swap_amount_limit", "fail", `Swap ${amount} PHRS exceeds limit ${MAX_TX_AMOUNT_PHRS} PHRS.`, reasons, requiredActions, "Swap exceeds configured PHRS limit.", "Reduce amount or increase MAX_TX_AMOUNT_PHRS consciously for testnet.");
        }
    }
    if (input.actionType === "x402_pay_and_fetch") {
        if (isSuspiciousUrl(input.url)) {
            pushCheck(checks, "x402_url", "fail", "x402 URL is SSRF-sensitive or invalid.", reasons, requiredActions, "SSRF-sensitive x402 URL blocked.", "Use a public HTTPS/HTTP endpoint or set ALLOW_LOCAL_X402_FETCH only for local tests.");
        }
        else {
            pushCheck(checks, "x402_url", "pass", "x402 URL passed static SSRF checks.");
        }
        const payment = numeric(input.paymentAmountUsdc);
        if (payment !== null && payment > Number(MAX_X402_PAYMENT_USDC)) {
            pushCheck(checks, "x402_payment_limit", "fail", `x402 payment ${payment} USDC exceeds limit ${MAX_X402_PAYMENT_USDC} USDC.`, reasons, requiredActions, "x402 payment exceeds configured limit.", "Reduce payment amount or increase MAX_X402_PAYMENT_USDC consciously for testnet.");
        }
        else {
            pushCheck(checks, "x402_payment_limit", "pass", `x402 payment is within ${MAX_X402_PAYMENT_USDC} USDC limit.`);
        }
        if (input.paymentTokenAddress && input.paymentTokenAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
            const status = input.paymentTokenAddress.toLowerCase() === TEST_USDC_ADDRESS.toLowerCase() ? "warn" : "fail";
            pushCheck(checks, "x402_payment_token", status, `Payment token ${input.paymentTokenAddress} is not canonical Circle USDC ${USDC_ADDRESS}.`, reasons, requiredActions, status === "fail" ? "x402 payment token is not canonical USDC." : undefined, "Use docs-verified Pharos testnet USDC or label the token as project-configured.");
        }
    }
    const tokenStatus = input.tokenRegistryStatus;
    if (tokenStatus === "CUSTOM_NON_REGISTRY" || tokenStatus === "UNKNOWN") {
        pushCheck(checks, "token_registry", "warn", `Token registry status is ${tokenStatus}.`, reasons, requiredActions, undefined, "Review token contract before execution.");
    }
    if (input.tokenSecurityStatus === "unavailable" || input.tokenSecurityStatus === "unknown") {
        pushCheck(checks, "token_security_provider", "warn", "Token security provider is unavailable or unknown.", reasons, requiredActions, undefined, "Proceed only after manual token review.");
    }
    const riskLevel = classifyRisk(checks);
    let decision = defaultDecision(riskLevel, checks);
    if (checks.some((c) => c.name.includes("funding") && c.status === "fail"))
        decision = "REQUIRE_FUNDING";
    if (checks.some((c) => c.name.includes("token") && c.status === "unknown"))
        decision = "REQUIRE_TOKEN_REVIEW";
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
export function explainPolicyResult(result) {
    if (result.decision === "ALLOW") {
        return "This action was allowed because it targets Pharos Atlantic Testnet, passed policy checks, and stayed within configured safety limits.";
    }
    const reasonText = result.reasons.length > 0 ? result.reasons.join(" ") : "one or more safety checks failed or require review.";
    const actionText = result.requiredActions.length > 0 ? ` SafeHands recommends: ${result.requiredActions.join(" ")}` : "";
    const verb = result.decision === "BLOCK" ? "blocked" : result.decision.toLowerCase().replaceAll("_", " ");
    return `This action was ${verb} because ${reasonText}${actionText}`;
}
export function parseTokenAmountToUnits(amount, decimals = 6) {
    try {
        return parseUnits(amount, decimals);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=actionPolicyEngine.js.map