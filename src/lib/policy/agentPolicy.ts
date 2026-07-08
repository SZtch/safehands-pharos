import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export type PolicyProfile = "conservative" | "balanced" | "advanced" | "custom";

export interface AgentPolicyLimits {
  maxPaymentPROS: string;
  maxSwapPROS: string;
  maxDailySpendPROS: string;
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
      maxPaymentPROS: "0.1",
      maxSwapPROS: "1",
      maxDailySpendPROS: "5",
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
      maxPaymentPROS: "1",
      maxSwapPROS: "10",
      maxDailySpendPROS: "25",
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
      maxPaymentPROS: "100",
      maxSwapPROS: "1000",
      maxDailySpendPROS: "5000",
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

// agentId becomes a filename — it must NEVER be able to traverse out of the
// policies directory. Reject path separators and `..` before it touches the FS.
const SAFE_AGENT_ID = /^[A-Za-z0-9_.:-]+$/;
export function isSafeAgentId(agentId: string): boolean {
  return SAFE_AGENT_ID.test(agentId) && !agentId.includes("..");
}

function policyPath(agentId: string): string {
  if (!isSafeAgentId(agentId)) {
    throw new Error(`Invalid agentId '${agentId}': only letters, digits and _ . : - are allowed (no path separators or '..').`);
  }
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
  for (const key of ["maxPaymentPROS", "maxSwapPROS", "maxDailySpendPROS", "maxX402PaymentUSDC", "maxApprovalUSDC"]) {
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

/**
 * P1-2 fail-closed fallback: a policy file that EXISTS but is malformed or
 * invalid must never silently degrade to the more permissive `balanced`
 * profile (a typo in a conservative custom policy would otherwise 10× the
 * per-tx limits). Warn the operator and pin the most restrictive profile.
 */
function invalidPolicyFallback(label: string, path: string): AgentPolicy {
  console.warn(
    `[SafeHands policy] ${label} policy file exists but is malformed or invalid — falling back to the 'conservative' profile (fail-closed). Fix ${path} to restore the intended limits.`
  );
  return POLICY_PROFILES.conservative;
}

export function loadAgentPolicy(agentId?: string): AgentPolicy {
  if (agentId && isSafeAgentId(agentId)) {
    const specific = policyPath(agentId);
    if (existsSync(specific)) {
      try {
        const parsed = validatePolicy(JSON.parse(readFileSync(specific, "utf-8")));
        if (parsed) return parsed;
      } catch { /* malformed JSON — fail closed below */ }
      return invalidPolicyFallback(`Agent '${agentId}'`, specific);
    }
  }

  const defaultPath = policyPath("default");
  if (existsSync(defaultPath)) {
    try {
      const parsed = validatePolicy(JSON.parse(readFileSync(defaultPath, "utf-8")));
      if (parsed) return parsed;
    } catch { /* malformed JSON — fail closed below */ }
    return invalidPolicyFallback("Default", defaultPath);
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
): { maxPaymentPROS: number; maxSwapPROS: number; maxX402PaymentUSDC: number; maxApprovalUSDC: number } {
  return {
    maxPaymentPROS: Number(policy.limits.maxPaymentPROS),
    maxSwapPROS: Number(policy.limits.maxSwapPROS),
    maxX402PaymentUSDC: Number(policy.limits.maxX402PaymentUSDC),
    maxApprovalUSDC: Number(policy.limits.maxApprovalUSDC),
  };
}
