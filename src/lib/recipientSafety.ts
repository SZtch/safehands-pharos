// ─── Recipient safety — operator-configurable denylist ─────────────────────
// A sync, keyless, honest guard for the RECIPIENT of a value transfer/approval.
// The denylist is entirely operator-supplied via env (empty by default) — SafeHands
// ships NO fabricated scam list, so there is never false "scam protection" confidence.
// Operators point it at their own known-bad set (drainers, scam addresses, mistyped
// treasury addresses to hard-block, etc.).
//
// NOTE (honest scope): deeper recipient intelligence — address-poisoning detection
// and first-time-recipient warnings — requires the sender's transfer history, which
// is too RPC-heavy for the hot path without the Goldsky indexer. That is deferred to
// the indexer-backed path rather than added as a laggy hot-path scan.
// ───────────────────────────────────────────────────────────────────────────

import { isAddress } from "viem";

/** Parse the operator-supplied denylist from env (comma-separated). Empty by default. */
export function recipientDenylist(): Set<string> {
  const raw = process.env.SAFEHANDS_RECIPIENT_DENYLIST || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => isAddress(s)),
  );
}

/** True when the address is a valid EVM address present on the operator denylist. */
export function isDenylistedRecipient(address?: string | null): boolean {
  if (!address || !isAddress(address)) return false;
  return recipientDenylist().has(address.toLowerCase());
}
