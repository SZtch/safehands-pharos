// ─── Daily Spend Accumulator ────────────────────────────────────────────
// In-memory per-wallet daily spend tracker. Resets at UTC midnight.
// Enforces MAX_DAILY_SPEND_USD across sendPayment and executeSwap.
// PHRS → USD conversion uses PHRS_USD_PRICE env var (default 1.0).
// ────────────────────────────────────────────────────────────────────────

interface DayBucket {
  dateUtc: string; // "YYYY-MM-DD"
  totalUsd: number;
}

const buckets = new Map<string, DayBucket>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function getPhrsUsdPrice(): number {
  return parseFloat(process.env.PHRS_USD_PRICE || "1.0");
}

export function getMaxDailySpendUsd(): number {
  return parseFloat(process.env.MAX_DAILY_SPEND_USD || "10");
}

export function estimateUsd(amount: string, token: "PHRS" | "USDC" | "USDT" | string): number {
  const n = parseFloat(amount);
  if (isNaN(n)) return 0;
  const upper = token.toUpperCase();
  if (upper === "PHRS") return n * getPhrsUsdPrice();
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
}
