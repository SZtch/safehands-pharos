export interface RiskBreakdown {
    liquidityRisk: number;
    slippageRisk: number;
    counterpartyRisk: number;
    balanceRisk: number;
    marketConditionRisk: number;
}
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskRecommendation = "proceed" | "caution" | "block";
export interface RiskAssessment {
    riskScore: number;
    riskLevel: RiskLevel;
    recommendation: RiskRecommendation;
    breakdown: RiskBreakdown;
    reasons: string[];
    suggestion: string;
}
export interface RiskInput {
    action: "swap" | "transfer";
    tokenIn?: string;
    tokenOut?: string;
    amount: string;
    toAddress?: string;
    walletAddress: string;
}
export declare function assessRisk(input: RiskInput): Promise<RiskAssessment>;
//# sourceMappingURL=riskEngine.d.ts.map