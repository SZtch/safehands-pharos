// ─── Strict ABI word reading for calldata analysis ────────────────────────
// viem's decodeFunctionData is built to mirror what the EVM will accept: it
// masks the upper 12 bytes of an address word and tolerates trailing bytes.
// That is the wrong posture for a pre-signature safety report. solc's own ABI
// decoder reverts on a dirty address word, so calldata carrying one is either
// malformed or deliberately deceptive, and silently normalizing it hands the
// reader a clean, confident spender for bytes that will not execute that way.
//
// The hosted engine already refuses those payloads (see wordToAddress and the
// per-method word-count checks in anvita/safehands/scripts/safehands-engine.js).
// These helpers give the TypeScript analyzers the same strictness so both
// engines read identical facts from identical bytes.
// ──────────────────────────────────────────────────────────────────────────

/** An ABI address word is 12 zero bytes followed by the 20 address bytes. */
const CLEAN_ADDRESS_WORD = /^0{24}[0-9a-f]{40}$/;

/**
 * Calldata payload after the 4-byte selector: lowercased, 0x-stripped.
 * Returns null when `data` is not at least a full selector.
 */
export function calldataBody(data: string | null | undefined): string | null {
  if (typeof data !== "string") return null;
  const hex = (data.startsWith("0x") ? data.slice(2) : data).toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex) || hex.length < 8) return null;
  return hex.slice(8);
}

/** Whole 32-byte words in the payload. A trailing partial word is not counted. */
export function calldataWordCount(body: string): number {
  return Math.floor(body.length / 64);
}

/** True when the payload is exactly `expected` whole words, with nothing trailing. */
export function hasExactWords(body: string, expected: number): boolean {
  return body.length === expected * 64;
}

/**
 * Address at word `index`, or null when the word is absent or its upper padding
 * is dirty. Null means "this payload does not cleanly encode an address here",
 * and callers must treat that as malformed rather than fall back to the low 20
 * bytes.
 */
export function addressAtWord(body: string, index: number): `0x${string}` | null {
  const word = body.slice(index * 64, (index + 1) * 64);
  if (word.length !== 64 || !CLEAN_ADDRESS_WORD.test(word)) return null;
  return `0x${word.slice(24)}`;
}
