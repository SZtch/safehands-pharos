// ─── Tiered In-Memory Quota ──────────────────────────────────────
// Generalizes the base in-memory rate limiter into per-caller-tier quota.
// No Redis, no DB, no external dependency — a bounded in-memory bucket Map.
//
// Buckets are keyed by a TRUSTED identifier only: `key:<keyId>` for a valid API
// key, else the client IP. Untrusted body identity (agentId/a2aPeerId) is NEVER
// a quota key — it is gameable. The tier (anonymous | api-key | agent | a2a)
// selects the limit. Pure logic + state; no signing/wallet/write primitives.
// ────────────────────────────────────────────────────────────────────────

export type QuotaTier = "anonymous" | "api-key" | "agent" | "a2a";

export const QUOTA_TIERS: readonly QuotaTier[] = ["anonymous", "api-key", "agent", "a2a"];

export interface QuotaConfig {
  enabled: boolean;
  windowMs: number;
  /** Max requests per window, per tier. */
  max: Record<QuotaTier, number>;
}

export interface QuotaState {
  tier: QuotaTier;
  limit: number;
  remaining: number;
  limited: boolean;
  /** Unix seconds at which the current window resets. */
  resetAtSec: number;
  /** Seconds until reset (for Retry-After). */
  retryAfterSec: number;
}

/** Map an access-context callerType to a quota tier (fail-safe to anonymous). */
export function tierForCaller(callerType: string): QuotaTier {
  return (QUOTA_TIERS as readonly string[]).includes(callerType) ? (callerType as QuotaTier) : "anonymous";
}

export class QuotaLimiter {
  private cfg: QuotaConfig;
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(cfg: QuotaConfig) {
    this.cfg = cfg;
  }

  /** Reconfigure + clear state (used at server start / tests). */
  configure(cfg: QuotaConfig): void {
    this.cfg = cfg;
    this.buckets.clear();
  }

  /**
   * Count one request against the (tier, identifier) bucket and return the
   * resulting state. `identifier` MUST be a trusted value (keyId or IP).
   */
  consume(tier: QuotaTier, identifier: string, now: number = Date.now()): QuotaState {
    const limit = this.cfg.max[tier] ?? this.cfg.max.anonymous;
    const bucketKey = `${tier}:${identifier}`;
    let bucket = this.buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.cfg.windowMs };
      this.buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    return {
      tier,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      limited: bucket.count > limit,
      resetAtSec: Math.ceil(bucket.resetAt / 1000),
      retryAfterSec: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
}
