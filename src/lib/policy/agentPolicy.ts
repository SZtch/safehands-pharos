import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export type PolicyProfile = "conservative" | "balanced" | "advanced" | "custom";

export interface AgentPolicyLimits {
  maxPaymentPHRS: string;
  maxSwapPHRS: string;
  maxDailySpendPHRS: string;
  maxX402PaymentUSDC: string;
  maxApprovalUSDC: string;
}

export interface AgentPolicyFlags {
  allowUnknownTokens: boolean;
  allowCustomContractCalls: boolean;
  requireConfirmationAboveRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface AgentPolicy {
  profile: PolicyProfile;
  limits: AgentPolicyLimits;
  flags: AgentPolicyFlags;
}

export const POLICY_PROFILES: Record<Exclude<PolicyProfile, "custom">, AgentPolicy> = {
  conservative: {
    profile: "conservative",
    limits: {
      maxPaymentPHRS: "0.1",
      maxSwapPHRS: "1",
      maxDailySpendPHRS: "5",
      maxX402PaymentUSDC: "0.01",
      maxApprovalUSDC: "10",
    },
    flags: {
      allowUnknownTokens: false,
      allowCustomContractCalls: false,
      requireConfirmationAboveRisk: "LOW",
    },
  },
  balanced: {
    profile: "balanced",
    limits: {
      maxPaymentPHRS: "1",
      maxSwapPHRS: "10",
      maxDailySpendPHRS: "25",
      maxX402PaymentUSDC: "0.1",
      maxApprovalUSDC: "50",
    },
    flags: {
      allowUnknownTokens: false,
      allowCustomContractCalls: false,
      requireConfirmationAboveRisk: "MEDIUM",
    },
  },
  advanced: {
    profile: "advanced",
    limits: {
      maxPaymentPHRS: "100",
      maxSwapPHRS: "1000",
      maxDailySpendPHRS: "5000",
      maxX402PaymentUSDC: "1",
      maxApprovalUSDC: "500",
    },
    flags: {
      allowUnknownTokens: true,
      allowCustomContractCalls: true,
      requireConfirmationAboveRisk: "HIGH",
    },
  },
};

function getPoliciesDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "..", "..", "..", ".agents", "policies");
}

function policyPath(agentId: string): string {
  return join(getPoliciesDir(), `${agentId}.json`);
}

function validatePolicy(raw: unknown): AgentPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const profile = obj.profile;
  if (typeof profile !== "string") return null;
  if (!["conservative", "balanced", "advanced", "custom"].includes(profile)) return null;

  const limits = obj.limits;
  if (!limits || typeof limits !== "object") return null;
  const l = limits as Record<string, unknown>;
  for (const key of ["maxPaymentPHRS", "maxSwapPHRS", "maxDailySpendPHRS", "maxX402PaymentUSDC", "maxApprovalUSDC"]) {
    if (typeof l[key] !== "string") return null;
    const n = Number(l[key]);
    if (!Number.isFinite(n) || n < 0) return null;
  }

  const flags = obj.flags;
  if (!flags || typeof flags !== "object") return null;
  const f = flags as Record<string, unknown>;
  if (typeof f.allowUnknownTokens !== "boolean") return null;
  if (typeof f.allowCustomContractCalls !== "boolean") return null;
  if (typeof f.requireConfirmationAboveRisk !== "string") return null;
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(f.requireConfirmationAboveRisk as string)) return null;

  return {
    profile: profile as PolicyProfile,
    limits: l as unknown as AgentPolicyLimits,
    flags: f as unknown as AgentPolicyFlags,
  };
}

export function loadAgentPolicy(agentId?: string): AgentPolicy {
  const dir = getPoliciesDir();

  if (agentId) {
    const specific = policyPath(agentId);
    if (existsSync(specific)) {
      try {
        const parsed = validatePolicy(JSON.parse(readFileSync(specific, "utf-8")));
        if (parsed) return parsed;
      } catch { /* fall through to default */ }
    }
  }

  const defaultPath = policyPath("default");
  if (existsSync(defaultPath)) {
    try {
      const parsed = validatePolicy(JSON.parse(readFileSync(defaultPath, "utf-8")));
      if (parsed) return parsed;
    } catch { /* fall through to hardcoded */ }
  }

  return POLICY_PROFILES.balanced;
}

export function saveAgentPolicy(agentId: string, policy: AgentPolicy): void {
  const dir = getPoliciesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(policyPath(agentId), JSON.stringify(policy, null, 2), "utf-8");
}

export function resolveEffectiveLimits(
  policy: AgentPolicy,
): { maxPaymentPHRS: number; maxSwapPHRS: number; maxX402PaymentUSDC: number; maxApprovalUSDC: number } {
  return {
    maxPaymentPHRS: Number(policy.limits.maxPaymentPHRS),
    maxSwapPHRS: Number(policy.limits.maxSwapPHRS),
    maxX402PaymentUSDC: Number(policy.limits.maxX402PaymentUSDC),
    maxApprovalUSDC: Number(policy.limits.maxApprovalUSDC),
  };
}
