// ─── SafeHands API — Activity & Public Metrics (read-only) ────
// Pure handlers for the public activity feed + aggregate metrics that power the
// future SafeHands site. They read ONLY the in-memory activity store + the
// honest capability flags. No signer, no wallet, no write path, no secrets.
// server.ts wraps these in the standard ok() envelope.
// ────────────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { activityStore } from "../lib/observability/activityStore.js";
import { readOnlyMeta } from "./response.js";
import { resolveQuotaConfig } from "./httpHardening.js";
import { POLICY_VERSION, PRESET_NAMES } from "../lib/policy/policyPresets.js";
import { getActiveNetwork, getActiveNetworkName } from "../lib/networks.js";
import { getCapabilityFlags, isExecutionAvailable } from "../lib/config.js";

const SERVICE = "SafeHands API";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}
const VERSION = readVersion();

const RECENT_DEFAULT = 20;
const RECENT_MAX = 100;

function clampLimit(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return RECENT_DEFAULT;
  return Math.min(RECENT_MAX, Math.max(1, Math.floor(n)));
}

// ── GET /activity/summary ──────────────────────────────────────────────
export function handleActivitySummary() {
  return {
    generatedAt: new Date().toISOString(),
    ...activityStore.summary(),
    ...readOnlyMeta(),
  };
}

// ── GET /activity/recent?limit=N ───────────────────────────────────────
export function handleActivityRecent(query: unknown) {
  const limit = clampLimit(query && typeof query === "object" ? (query as Record<string, unknown>).limit : undefined);
  const items = activityStore.recent(limit);
  return {
    generatedAt: new Date().toISOString(),
    limit,
    count: items.length,
    items,
    ...readOnlyMeta(),
  };
}

// ── GET /metrics/public ────────────────────────────────────────────────
// Safe aggregate metrics only — no env, no payloads, no secrets, no memory dumps.
export function handleMetricsPublic() {
  const m = activityStore.metrics();
  const caps = getCapabilityFlags();
  const network = getActiveNetwork();
  const quotaCfg = resolveQuotaConfig();
  return {
    service: SERVICE,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    network: getActiveNetworkName(),
    chainId: network.chainId,
    uptimeSeconds: m.uptimeSeconds,
    totalChecks: m.totalChecks,
    totalAgentChecks: m.totalAgentChecks,
    totalA2AChecks: m.totalA2AChecks,
    totalBlocked: m.totalBlocked,
    totalRequireConfirmation: m.totalRequireConfirmation,
    totalPrepareOnly: m.totalPrepareOnly,
    totalAllowed: m.totalAllowed,
    totalRateLimited: m.totalRateLimited,
    rateLimitedByTier: m.rateLimitedByTier,
    ring: m.ring,
    // Safe quota config (limits + window only — NO keys/IPs/identifiers).
    quota: { windowSeconds: Math.floor(quotaCfg.windowMs / 1000), tiers: quotaCfg.max },
    mainnetLive: caps.mainnetLive,
    railwayReady: caps.railwayReady,
    publicReadApiAvailable: caps.publicReadApiAvailable,
    apiKeyAuthAvailable: caps.apiKeyAuthAvailable,
    scopedApiKeysAvailable: caps.scopedApiKeysAvailable,
    quotaControlsAvailable: caps.quotaControlsAvailable,
    policyProfilesAvailable: caps.policyProfilesAvailable,
    policyVersion: POLICY_VERSION,
    policyPresets: [...PRESET_NAMES],
    prepareTxAvailable: caps.prepareTxAvailable,
    signingAvailable: caps.signingAvailable,
    userSignedBroadcastAvailable: caps.userSignedBroadcastAvailable,
    premiumEndpointsAvailable: caps.premiumEndpointsAvailable,
    x402PaidEndpointsAvailable: caps.x402PaidEndpointsAvailable,
    readOnly: true,
    executionAvailable: isExecutionAvailable(),
  };
}
