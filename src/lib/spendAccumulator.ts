// ─── Daily Spend Accumulator ────────────────────────────────────────────
// In-memory per-wallet daily spend tracker. Resets at UTC midnight.
// Enforces MAX_DAILY_SPEND_USD across sendPayment and executeSwap.
// PROS → USD conversion uses PROS_USD_PRICE env var (default 1.0).
// ────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

interface DayBucket {
  dateUtc: string; // "YYYY-MM-DD"
  totalUsd: number;
}

const buckets = new Map<string, DayBucket>();
const SPEND_FILE = process.env.SAFEHANDS_SPEND_HISTORY_PATH || path.join(process.env.SAFEHANDS_STATE_DIR || process.env.STATE_DIR || ".safehands", "spend_history.json");

function loadBuckets() {
  try {
    if (fs.existsSync(SPEND_FILE)) {
      const data = JSON.parse(fs.readFileSync(SPEND_FILE, "utf-8"));
      for (const [k, v] of Object.entries(data)) {
        buckets.set(k, v as DayBucket);
      }
    }
  } catch (e) {
    console.error("Failed to load spend history:", e);
  }
}

function saveBuckets() {
  try {
    const dir = path.dirname(SPEND_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(buckets);
    fs.writeFileSync(SPEND_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to save spend history:", e);
  }
}

loadBuckets();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function getPhrsUsdPrice(): number {
  return parseFloat(process.env.PROS_USD_PRICE || "1.0");
}

export function getMaxDailySpendUsd(): number {
  return parseFloat(process.env.MAX_DAILY_SPEND_USD || "10");
}

export function estimateUsd(amount: string, token: "PROS" | "USDC" | "USDT" | string): number {
  const n = parseFloat(amount);
  if (isNaN(n)) return 0;
  const upper = token.toUpperCase();
  if (upper === "PROS") return n * getPhrsUsdPrice();
  if (upper === "USDC" || upper === "USDT") return n;
  return 0; // unknown token — do not count to avoid false blocks
}

export function checkDailyLimit(
  walletAddress: string,
  amountUsd: number
): { allowed: boolean; currentUsd: number; limitUsd: number; remainingUsd: number } {
  const key = walletAddress.toLowerCase();
  const today = todayUtc();
  const bucket = buckets.get(key);
  const currentUsd = !bucket || bucket.dateUtc !== today ? 0 : bucket.totalUsd;
  const limitUsd = getMaxDailySpendUsd();
  const remainingUsd = Math.max(0, limitUsd - currentUsd);
  return {
    allowed: currentUsd + amountUsd <= limitUsd,
    currentUsd,
    limitUsd,
    remainingUsd,
  };
}

export function recordSpend(walletAddress: string, amountUsd: number): void {
  if (amountUsd <= 0) return;
  const key = walletAddress.toLowerCase();
  const today = todayUtc();
  const bucket = buckets.get(key);
  if (!bucket || bucket.dateUtc !== today) {
    buckets.set(key, { dateUtc: today, totalUsd: amountUsd });
  } else {
    bucket.totalUsd += amountUsd;
  }
  saveBuckets();
}

/**
 * Atomic check-and-reserve (M2). `checkDailyLimit` + `recordSpend` run with NO
 * `await` between them, so within Node's single-threaded event loop the reserve is
 * atomic: two concurrent tool calls can no longer both pass the cap by reading the
 * pre-spend bucket. Reserve immediately BEFORE broadcasting, then `releaseReservation`
 * on any failure so a reverted/failed tx does not permanently consume the cap.
 */
export function reserveDailyLimit(
  walletAddress: string,
  amountUsd: number
): { allowed: boolean; currentUsd: number; limitUsd: number; remainingUsd: number } {
  const check = checkDailyLimit(walletAddress, amountUsd);
  if (check.allowed && amountUsd > 0) {
    recordSpend(walletAddress, amountUsd);
  }
  return check;
}

/** Release a previously reserved amount (call when a reserved tx fails/reverts). */
export function releaseReservation(walletAddress: string, amountUsd: number): void {
  if (amountUsd <= 0) return;
  const key = walletAddress.toLowerCase();
  const bucket = buckets.get(key);
  if (bucket && bucket.dateUtc === todayUtc()) {
    bucket.totalUsd = Math.max(0, bucket.totalUsd - amountUsd);
    saveBuckets();
  }
}
