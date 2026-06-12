export type SafeHandsActionType = "send_payment" | "approve_token" | "execute_swap" | "x402_pay_and_fetch" | "publish_risk_score" | "custom_contract_call";
export type PolicyDecision = "ALLOW" | "WARN" | "BLOCK" | "REQUIRE_CONFIRMATION" | "REQUIRE_FUNDING" | "REQUIRE_TOKEN_REVIEW";
export type PolicyRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
export interface PolicyCheck {
    name: string;
    status: "pass" | "warn" | "fail" | "unknown";
    message: string;
}
export interface ActionPolicyInput {
    actionType: SafeHandsActionType;
    environment?: string;
    chainId?: number;
    isMainnet?: boolean;
    amount?: string;
    amountUnit?: "PHRS" | "USDC" | "USD" | "TOKEN";
    token?: string;
    tokenAddress?: string;
    tokenIn?: string;
    tokenOut?: string;
    recipient?: string;
    spender?: string;
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
    recipientVerified?: boolean;
    spenderVerified?: boolean;
    allowUnlimitedApproval?: boolean;
    writeToolsEnabled?: boolean;
    requiresSigner?: boolean;
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
export declare function isUnlimitedApprovalAmount(value: string | undefined): boolean;
export declare function evaluateActionPolicy(input: ActionPolicyInput): ActionPolicyResult;
export declare function explainPolicyResult(result: ActionPolicyResult): string;
export declare function parseTokenAmountToUnits(amount: string, decimals?: number): bigint | null;
//# sourceMappingURL=actionPolicyEngine.d.ts.map