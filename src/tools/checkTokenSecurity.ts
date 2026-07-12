// ─── Tool: check_token_security ─────────────────────────────────────────
// Fetches token security intelligence from GoPlus Security API.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { isAddress } from "viem";
import { CHAIN_ID, IS_MAINNET, PHAROS_ENVIRONMENT, activeTokenMap } from "../lib/constants.js";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";

export const checkTokenSecuritySchema = z.object({
  tokenAddress: z.string(),
  chainId: z.number().optional().default(CHAIN_ID),
});

export type CheckTokenSecurityInput = z.input<typeof checkTokenSecuritySchema>;

export const checkTokenSecurityTool = {
  name: "check_token_security",
  description:
    "Check token contract security (honeypot, mintable, ownership privileges, tax) via GoPlus Security API.",
  inputSchema: checkTokenSecuritySchema,
};

/**
 * GoPlus base URL — env-configurable via GOPLUS_API_BASE (same variable the
 * hosted Anvita engine honors), defaulting to the keyless public API. Read at
 * call time so tests/operators can repoint it without a process restart.
 */
function goplusApiBase(): string {
  return (process.env.GOPLUS_API_BASE || "https://api.gopluslabs.io").replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchGoplus(url: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "SafeHands/2.4.0",
        },
      });

      if (!isRetryableStatus(res.status) || attempt === 2) {
        return res;
      }

      lastError = new Error(`GoPlus API returned status ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === 2) throw err;
    } finally {
      clearTimeout(timeout);
    }

    await sleep(300 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ─── GoPlus schema parsing (P0-1 fail-closed) ───────────────────────────────
// GoPlus's Pharos (chain 1672) support is new and its response schema is still
// maturing. GoPlus encodes booleans as "1"/"0" strings; we tolerate numeric/boolean
// drift too, so a retyped value can't make a real honeypot read as false. Crucially,
// if the honeypot decision field is absent or in an unrecognized shape,
// interpretGoplusTokenResult returns null so the caller FAILS CLOSED — it never scores
// an unreadable response as safetyScore=100 (an effective ALLOW on data never assessed).
function goplusTruthy(v: unknown): boolean {
  return v === "1" || v === 1 || v === true;
}
function goplusFlagKnown(v: unknown): boolean {
  return v === "1" || v === "0" || v === 1 || v === 0 || v === true || v === false;
}

// Untrusted external strings, display-only: trim + cap; absent/non-string → undefined.
// Identity metadata never influences any fail-closed decision.
function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 128) : undefined;
}

export interface GoplusTokenProfile {
  /** Display-only identity metadata — never used in scoring or policy decisions. */
  tokenName?: string;
  tokenSymbol?: string;
  isHoneypot: boolean;
  buyTaxPercent: number;
  sellTaxPercent: number;
  isMintable: boolean;
  transferPausable: boolean;
  isProxy: boolean;
  ownerAddress: string;
  creatorAddress: string;
}

/**
 * Parse a GoPlus token_security result entry into a normalized profile, or return
 * `null` when the schema is unrecognized (the honeypot decision field is missing or
 * not a boolean-ish value). Pure + synchronous so the fail-open guard is unit-testable
 * with no network. Callers MUST treat null as "data unavailable" and fail closed.
 */
export function interpretGoplusTokenResult(details: unknown): GoplusTokenProfile | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (!goplusFlagKnown(d.is_honeypot)) return null; // schema drift → fail closed, never "safe"
  const zero = "0x0000000000000000000000000000000000000000";
  return {
    tokenName: optionalString(d.token_name),
    tokenSymbol: optionalString(d.token_symbol),
    isHoneypot: goplusTruthy(d.is_honeypot),
    buyTaxPercent: (parseFloat(String(d.buy_tax ?? "")) || 0) * 100,
    sellTaxPercent: (parseFloat(String(d.sell_tax ?? "")) || 0) * 100,
    isMintable: goplusTruthy(d.is_mintable),
    transferPausable: goplusTruthy(d.transfer_pausable),
    isProxy: goplusTruthy(d.is_proxy),
    ownerAddress: (typeof d.owner_address === "string" && d.owner_address) || zero,
    creatorAddress: (typeof d.creator_address === "string" && d.creator_address) || zero,
  };
}

/**
 * Best-effort, DISPLAY-ONLY token identity from GoPlus. Reads ONLY token_name /
 * token_symbol and deliberately ignores the security schema: a payload that
 * check_token_security fails closed on (e.g. is_honeypot missing) can still carry
 * identity metadata. Never throws — returns {} on any timeout/network/parse failure.
 * Unlike the security check (which keeps the stronger fetchGoplus retry path),
 * this is optional enrichment: a single attempt with a short 3s timeout so it
 * cannot make token_registry_status slow.
 * MUST NOT be used for risk scoring, policy decisions, write gates, or
 * allow/block logic; it does not verify anything about the token.
 */
export async function fetchGoplusTokenIdentity(
  tokenAddress: string,
  chainId = CHAIN_ID
): Promise<{ tokenName?: string; tokenSymbol?: string }> {
  const address = tokenAddress.toLowerCase().trim();
  if (!isAddress(address)) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(
      `${goplusApiBase()}/api/v1/token_security/${chainId}?contract_addresses=${address}`,
      {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "SafeHands/2.4.0",
        },
      }
    );
    if (!res.ok) return {};
    const data = (await res.json()) as any;
    const d = data?.result?.[address];
    if (!d || typeof d !== "object") return {};
    return {
      tokenName: optionalString(d.token_name),
      tokenSymbol: optionalString(d.token_symbol),
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * P1-5: network metadata for the tool response, derived from the ACTIVE network
 * instead of a hardcoded `isMainnet: true` (which misreported on
 * atlantic-testnet). Unknown chains report false. Pure + exported for tests.
 */
export function tokenSecurityNetworkMetadata(chainId: number): {
  chainId: number;
  environment: string;
  isMainnet: boolean;
} {
  return {
    chainId,
    environment: chainId === CHAIN_ID ? PHAROS_ENVIRONMENT : "custom-chain",
    isMainnet: chainId === CHAIN_ID ? IS_MAINNET : false,
  };
}

export async function handleCheckTokenSecurity(raw: CheckTokenSecurityInput) {
  const input = checkTokenSecuritySchema.parse(raw);
  const address = input.tokenAddress.toLowerCase().trim();
  const chainId = input.chainId;

  if (!isAddress(address)) {
    return fail("INVALID_TOKEN_ADDRESS", `Invalid token address: ${input.tokenAddress}`, false, "check_token_security");
  }

  // GoPlus supports Pharos Mainnet (chain 1672) — a third-party claim; results are
  // risk intel, never identity. Base URL honors GOPLUS_API_BASE like the hosted
  // Anvita engine, so both runtimes point at the same configurable truth source.
  const url = `${goplusApiBase()}/api/v1/token_security/${chainId}?contract_addresses=${address}`;

  try {
    const res = await fetchGoplus(url);
    if (!res.ok) {
      throw new Error(`GoPlus API returned status ${res.status}`);
    }

    const data = (await res.json()) as any;

    if (data.code !== 1 || !data.result || !data.result[address]) {
      return fail(
        "TOKEN_SECURITY_DATA_UNAVAILABLE",
        data.message || "Token security data is not available for this contract on the specified chain.",
        true,
        "goplus_api"
      );
    }

    const details = data.result[address];

    // P0-1: refuse to score an unrecognized GoPlus schema as "safe" — fail closed.
    const profile = interpretGoplusTokenResult(details);
    if (!profile) {
      return fail(
        "TOKEN_SECURITY_DATA_UNAVAILABLE",
        "GoPlus returned an unrecognized token-security schema for this contract (honeypot signal missing or not boolean). Failing closed: token treated as unreviewed, not safe.",
        true,
        "goplus_api"
      );
    }
    const { isHoneypot, buyTaxPercent: buyTax, sellTaxPercent: sellTax, isMintable, transferPausable } = profile;

    let riskScore = 0;
    const flags: string[] = [];

    if (isHoneypot) {
      riskScore += 80;
      flags.push("Honeypot contract detected - buy at your own peril (cannot sell)");
    }
    if (buyTax > 10) {
      riskScore += 15;
      flags.push(`High buy tax: ${buyTax.toFixed(2)}%`);
    }
    if (sellTax > 10) {
      riskScore += 15;
      flags.push(`High sell tax: ${sellTax.toFixed(2)}%`);
    }
    if (isMintable) {
      riskScore += 10;
      flags.push("Token is mintable by owner/creator");
    }
    if (transferPausable) {
      riskScore += 15;
      flags.push("Trading/transfers can be paused by owner");
    }

    const safetyScore = Math.max(0, 100 - riskScore);

    return ok({
      ...tokenSecurityNetworkMetadata(chainId),
      tokenAddress: address,
      tokenName: profile.tokenName,
      tokenSymbol: profile.tokenSymbol,
      securityProfile: {
        safetyScore,
        isHoneypot,
        buyTaxPercent: buyTax,
        sellTaxPercent: sellTax,
        isMintable,
        transferPausable,
        isProxy: profile.isProxy,
        ownerAddress: profile.ownerAddress,
        creatorAddress: profile.creatorAddress,
      },
      flags,
      source: "goplus_api",
      sourceStatus: "ok",
    });
  } catch (err) {
    return classifyExternalError("goplus_api", err);
  }
}

// ─── Reusable token-security gate for the EXECUTE path (H3) ─────────────────
// Wraps handleCheckTokenSecurity into a fail-closed verdict the write tools feed
// into evaluateActionPolicy. Maps to:
//   • "block"  → honeypot / severe (hard stop in the tool — never confirmable)
//   • "review" + policyStatus="unknown"     → GoPlus HAS data and flagged the token
//                (tax, mintable, pausable, low score) → REQUIRE_TOKEN_REVIEW, which a
//                caller may confirm AFTER reviewing the flags.
//   • "review" + policyStatus="unavailable" → GoPlus outage / token not indexed /
//                unresolvable address — nothing was actually reviewed, so a caller
//                confirmation cannot substitute for the missing intel. The write gate
//                fails closed on this (P0-2). Exception: tokens whose address matches
//                the official active-network token registry keep "unknown" — identity
//                is registry-verified even when GoPlus intel is missing.
//   • "ok"     → clean → tokenSecurityStatus="ok"
export type TokenSecurityVerdict = "ok" | "review" | "block";

export interface TokenSecurityGateResult {
  verdict: TokenSecurityVerdict;
  /** Value to pass as evaluateActionPolicy input.tokenSecurityStatus. */
  policyStatus: "ok" | "unknown" | "unavailable";
  flags: string[];
  safetyScore?: number;
  detail?: string;
}

/** Address is a canonical token in the active-network registry (identity verified). */
function isRegistryToken(address: string): boolean {
  const a = address.toLowerCase();
  return Object.values(activeTokenMap()).some(
    (v) => typeof v === "string" && v.toLowerCase() === a
  );
}

export async function evaluateTokenSecurityGate(
  tokenAddress: string,
  chainId = CHAIN_ID
): Promise<TokenSecurityGateResult> {
  if (!isAddress(tokenAddress)) {
    // Unresolvable token → nothing reviewable → fail closed (not caller-confirmable).
    return { verdict: "review", policyStatus: "unavailable", flags: [], detail: "Token address could not be resolved for security review." };
  }

  const res = await handleCheckTokenSecurity({ tokenAddress, chainId });
  if (!res.success) {
    // GoPlus unavailable / token not indexed → nothing was reviewed. Registry-canonical
    // tokens stay caller-confirmable (identity verified on the official token registry);
    // everything else is "unavailable" and the write gate fails closed on it (P0-2).
    if (isRegistryToken(tokenAddress)) {
      return { verdict: "review", policyStatus: "unknown", flags: [], detail: `${res.error.message} Token address matches the official active-network token registry: identity verified; GoPlus intel unavailable.` };
    }
    return { verdict: "review", policyStatus: "unavailable", flags: [], detail: res.error.message };
  }

  const data = res.data as {
    securityProfile: { safetyScore: number; isHoneypot: boolean; buyTaxPercent: number; sellTaxPercent: number; transferPausable: boolean };
    flags: string[];
  };
  const p = data.securityProfile;

  if (p.isHoneypot || p.sellTaxPercent >= 25 || p.buyTaxPercent >= 25) {
    return { verdict: "block", policyStatus: "unknown", flags: data.flags, safetyScore: p.safetyScore, detail: "Token flagged as honeypot or extreme-tax by GoPlus." };
  }
  if (p.safetyScore < 70 || p.transferPausable || data.flags.length > 0) {
    return { verdict: "review", policyStatus: "unknown", flags: data.flags, safetyScore: p.safetyScore };
  }
  return { verdict: "ok", policyStatus: "ok", flags: data.flags, safetyScore: p.safetyScore };
}
