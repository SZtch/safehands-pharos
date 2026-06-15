// ─── Shared Validation Helpers ─────────────────────────────────────────
// Reusable validators for amount, address, and field presence.
// Used by preflight, handlers, and smoke tests.
// ────────────────────────────────────────────────────────────────────────

import { isAddress } from "viem";

export function isValidPositiveAmount(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  if (str === "") return false;
  const n = Number(str);
  return Number.isFinite(n) && n > 0;
}

export function validatePositiveAmount(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return `${fieldName} is required and must be a positive number.`;
  }
  const str = String(value).trim();
  if (str === "") return `${fieldName} must not be empty.`;
  const n = Number(str);
  if (!Number.isFinite(n)) return `${fieldName} must be a valid finite number (got "${str}").`;
  if (n <= 0) return `${fieldName} must be positive (got ${n}).`;
  return null;
}

export function validateAddress(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === "") {
    return `${fieldName} is required.`;
  }
  const str = String(value).trim();
  if (!isAddress(str)) return `${fieldName} is not a valid EVM address (got "${str}").`;
  return null;
}

export function validateNonZeroAddress(value: unknown, fieldName: string): string | null {
  const addrError = validateAddress(value, fieldName);
  if (addrError) return addrError;
  if (String(value).trim().toLowerCase() === "0x0000000000000000000000000000000000000000") {
    return `${fieldName} must not be the zero address.`;
  }
  return null;
}

export function collectErrors(errors: (string | null)[]): string[] {
  return errors.filter((e): e is string => e !== null);
}
