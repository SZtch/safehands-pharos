// ─── Activity Store ────────────────────────────────────────────────────
// In-memory, fixed-capacity ring buffer of sanitized activity items, plus
// O(1) cumulative counters for the public summary/metrics endpoints. No DB, no
// external service, no file I/O. Bounded memory by construction. Per-process /
// per-instance (documented): on multi-instance deployments each instance keeps
// its own window — acceptable for a public, illustrative activity feed.
// ────────────────────────────────────────────────────────────────────────

import type { ActivityItem, CallerType } from "./sanitize.js";

const DEFAULT_CAPACITY = 500;
const MIN_CAPACITY = 10;
const MAX_CAPACITY = 5000;

type DecisionKey = "ALLOW" | "BLOCK" | "REQUIRE_CONFIRMATION" | "PREPARE_ONLY" | "NONE";
type RiskKey = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

function emptyDecisions(): Record<DecisionKey, number> {
  return { ALLOW: 0, BLOCK: 0, REQUIRE_CONFIRMATION: 0, PREPARE_ONLY: 0, NONE: 0 };
}
function emptyRisks(): Record<RiskKey, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
}
function emptyCallers(): Record<CallerType, number> {
  return { api: 0, agent: 0, a2a: 0, unknown: 0 };
}

type AccessTierKey = "anonymous" | "api-key" | "agent" | "a2a";
function emptyAccessTiers(): Record<AccessTierKey, number> {
  return { anonymous: 0, "api-key": 0, agent: 0, a2a: 0 };
}

export interface ActivitySummary {
  window: { capacity: number; size: number };
  totals: {
    recorded: number;
    rateLimited: number;
    byCaller: Record<CallerType, number>;
    byAccessTier: Record<AccessTierKey, number>;
    byDecision: Record<DecisionKey, number>;
    byRisk: Record<RiskKey, number>;
    byEndpoint: Record<string, number>;
    byPolicyPreset: Record<string, number>;
  };
  lastActivityAt: string | null;
}

export interface ActivityMetrics {
  uptimeSeconds: number;
  totalChecks: number;
  totalAgentChecks: number;
  totalA2AChecks: number;
  totalBlocked: number;
  totalRequireConfirmation: number;
  totalPrepareOnly: number;
  totalAllowed: number;
  totalRateLimited: number;
  rateLimitedByTier: Record<AccessTierKey, number>;
  ring: { capacity: number; size: number };
}

function clampCapacity(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CAPACITY;
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.floor(n)));
}

export class ActivityStore {
  private capacity: number;
  private buf: (ActivityItem | undefined)[];
  private head = 0; // next write slot
  private size = 0;
  private startedAtMs = Date.now();
  private lastActivityAt: string | null = null;

  private recorded = 0;
  private rateLimited = 0;
  private rateLimitedByTier = emptyAccessTiers();
  private byCaller = emptyCallers();
  private byAccessTier = emptyAccessTiers();
  private byDecision = emptyDecisions();
  private byRisk = emptyRisks();
  private byEndpoint: Record<string, number> = {};
  private byPolicyPreset: Record<string, number> = {};

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = clampCapacity(capacity);
    this.buf = new Array(this.capacity);
  }

  /** Resize/reset the ring (used at server start from env). Clears all state. */
  configure(capacity: number): void {
    this.capacity = clampCapacity(capacity);
    this.reset();
  }

  /** Clear the buffer + counters (tests + reconfigure). */
  reset(): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
    this.startedAtMs = Date.now();
    this.lastActivityAt = null;
    this.recorded = 0;
    this.rateLimited = 0;
    this.rateLimitedByTier = emptyAccessTiers();
    this.byCaller = emptyCallers();
    this.byAccessTier = emptyAccessTiers();
    this.byDecision = emptyDecisions();
    this.byRisk = emptyRisks();
    this.byEndpoint = {};
    this.byPolicyPreset = {};
  }

  record(item: ActivityItem): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;

    this.recorded++;
    this.lastActivityAt = item.ts;
    this.byCaller[item.callerType] = (this.byCaller[item.callerType] ?? 0) + 1;
    const tier = (item.accessTier ?? "anonymous") as AccessTierKey;
    if (tier in this.byAccessTier) this.byAccessTier[tier]++;
    else this.byAccessTier.anonymous++;
    const dKey = (item.decision ?? "NONE") as DecisionKey;
    if (dKey in this.byDecision) this.byDecision[dKey]++;
    else this.byDecision.NONE++;
    const rKey = (item.riskLevel ?? "UNKNOWN") as RiskKey;
    if (rKey in this.byRisk) this.byRisk[rKey]++;
    else this.byRisk.UNKNOWN++;
    this.byEndpoint[item.endpoint] = (this.byEndpoint[item.endpoint] ?? 0) + 1;
    const preset = item.policyPreset ?? "none";
    this.byPolicyPreset[preset] = (this.byPolicyPreset[preset] ?? 0) + 1;
  }

  /** Count a rate-limited (429) request that never reached a handler. */
  recordRateLimited(tier?: string): void {
    this.rateLimited++;
    if (tier && tier in this.rateLimitedByTier) this.rateLimitedByTier[tier as AccessTierKey]++;
  }

  /** Newest-first slice of the most recent items (sanitized copies). */
  recent(limit: number): ActivityItem[] {
    const n = Math.min(Math.max(0, Math.floor(limit)), this.size);
    const out: ActivityItem[] = [];
    for (let i = 0; i < n; i++) {
      const idx = (this.head - 1 - i + this.capacity * 2) % this.capacity;
      const item = this.buf[idx];
      if (item) out.push(item);
    }
    return out;
  }

  summary(): ActivitySummary {
    return {
      window: { capacity: this.capacity, size: this.size },
      totals: {
        recorded: this.recorded,
        rateLimited: this.rateLimited,
        byCaller: { ...this.byCaller },
        byAccessTier: { ...this.byAccessTier },
        byDecision: { ...this.byDecision },
        byRisk: { ...this.byRisk },
        byEndpoint: { ...this.byEndpoint },
        byPolicyPreset: { ...this.byPolicyPreset },
      },
      lastActivityAt: this.lastActivityAt,
    };
  }

  metrics(): ActivityMetrics {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
      totalChecks: this.byCaller.api,
      totalAgentChecks: this.byCaller.agent,
      totalA2AChecks: this.byCaller.a2a,
      totalBlocked: this.byDecision.BLOCK,
      totalRequireConfirmation: this.byDecision.REQUIRE_CONFIRMATION,
      totalPrepareOnly: this.byDecision.PREPARE_ONLY,
      totalAllowed: this.byDecision.ALLOW,
      totalRateLimited: this.rateLimited,
      rateLimitedByTier: { ...this.rateLimitedByTier },
      ring: { capacity: this.capacity, size: this.size },
    };
  }
}

/** Process-wide singleton used by the server + activity routes. */
export const activityStore = new ActivityStore();
