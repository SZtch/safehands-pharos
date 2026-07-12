// ─── Daily Spend Accumulator ────────────────────────────────────────────
// In-memory per-wallet daily spend tracker. Resets at UTC midnight.
// Enforces MAX_DAILY_SPEND_USD across sendPayment and executeSwap.
// PROS/WPROS → USD conversion uses PROS_USD_PRICE env var (default 1.0).
// ────────────────────────────────────────────────────────────────────────

import path from "path";
import { readJsonFile, writeJsonFileAtomic } from "./persistentJsonStore.js";
import { activeTokenMap } from "./constants.js";

interface DayBucket {
  dateUtc: string; // "YYYY-MM-DD"
  totalUsd: number;
}

const buckets = new Map<string, DayBucket>();
const SPEND_FILE = process.env.SAFEHANDS_SPEND_HISTORY_PATH || path.join(process.env.SAFEHANDS_STATE_DIR || process.env.STATE_DIR || ".safehands", "spend_history.json");

function loadBuckets() {
  const data = readJsonFile<Record<string, DayBucket>>(SPEND_FILE, {});
  for (const [k, v] of Object.entries(data)) {
    buckets.set(k, v);
  }
}

function saveBuckets() {
  try {
    // Atomic write (temp file + rename) — a crash mid-write can no longer
    // truncate the spend history and silently reset the daily caps.
    writeJsonFileAtomic(SPEND_FILE, Object.fromEntries(buckets));
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

export type PriceableSpendToken = "PROS" | "WPROS" | "USDC" | "USDT";

/**
 * Resolve a token symbol OR address to a priceable spend token, or `null` when the
 * token cannot be priced in USD. Addresses are matched against the official
 * active-network token registry so registry USDC passed by address still counts
 * toward the caps instead of slipping past them.
 */
export function resolvePriceableToken(token: string): PriceableSpendToken | null {
  const trimmed = token.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "PROS" || upper === "WPROS" || upper === "USDC" || upper === "USDT") return upper;
  const lower = trimmed.toLowerCase();
  for (const [symbol, addr] of Object.entries(activeTokenMap())) {
    if (typeof addr === "string" && addr.toLowerCase() === lower) {
      const s = symbol.toUpperCase();
      if (s === "PROS" || s === "WPROS" || s === "USDC" || s === "USDT") return s;
    }
  }
  return null;
}

export function estimateUsd(amount: string, token: "PROS" | "USDC" | "USDT" | string): number {
  const n = parseFloat(amount);
  if (isNaN(n)) return 0;
  const resolved = resolvePriceableToken(token);
  if (resolved === "PROS" || resolved === "WPROS") return n * getPhrsUsdPrice();
  if (resolved === "USDC" || resolved === "USDT") return n;
  // Unpriceable token — the policy engine DENIES execute_swap on these upstream
  // (swap_notional_unpriceable → BLOCK), so this 0 is never a silent cap escape.
  return 0;
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
 * Atomic check-and-reserve. `checkDailyLimit` + `recordSpend` run with NO
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
