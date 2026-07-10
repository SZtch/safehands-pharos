// ─── Gas buffering helpers (read-only) ─────────────────────────────────
// Shared gas-limit buffering used by the estimate_gas / simulate_transaction
// tools and RPC evidence. Never submits a transaction.
// (A full `analyzeGas` analyzer lived here until 2026-07: zero call sites, no
// surface, no tests — removed per the dead-code policy; see git history.)
// ────────────────────────────────────────────────────────────────────────

export const DEFAULT_GAS_BUFFER_PCT = 20;

/** Apply a buffer percentage to a raw gas estimate (integer math). */
export function recommendGasWithBuffer(estimate: bigint, bufferPct: number = DEFAULT_GAS_BUFFER_PCT): bigint {
  const pct = BigInt(Math.max(0, Math.trunc(bufferPct)));
  return estimate + (estimate * pct) / 100n;
}
