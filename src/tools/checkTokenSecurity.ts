// ─── Tool: check_token_security ─────────────────────────────────────────
// Fetches token security intelligence from GoPlus Security API.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { isAddress } from "viem";
import { CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { fetchWithTimeoutAndRetry } from "../lib/http.js";
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

export interface GoplusTokenProfile {
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

export async function handleCheckTokenSecurity(raw: CheckTokenSecurityInput) {
  const input = checkTokenSecuritySchema.parse(raw);
  const address = input.tokenAddress.toLowerCase().trim();
  const chainId = input.chainId;

  if (!isAddress(address)) {
    return fail("INVALID_TOKEN_ADDRESS", `Invalid token address: ${input.tokenAddress}`, false, "check_token_security");
  }

  // GoPlus now officially supports Pharos Mainnet (Chain 1672)!
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;

  try {
    const res = await fetchWithTimeoutAndRetry(url, { timeoutMs: 10_000, retries: 2, retryDelayMs: 300 });
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
        "GoPlus returned an unrecognized token-security schema for this contract (honeypot signal missing or not boolean). Failing closed — token treated as unreviewed, not safe.",
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
      chainId,
      environment: chainId === CHAIN_ID ? PHAROS_ENVIRONMENT : "custom-chain",
      isMainnet: true, // GoPlus works on Pharos Mainnet
      tokenAddress: address,
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
//   • "review" → flagged (tax, mintable, pausable, low score) OR provider
//                unavailable / no data → tokenSecurityStatus="unknown" so the
//                policy routes to REQUIRE_TOKEN_REVIEW (confirmable after review)
//   • "ok"     → clean → tokenSecurityStatus="ok"
export type TokenSecurityVerdict = "ok" | "review" | "block";

export interface TokenSecurityGateResult {
  verdict: TokenSecurityVerdict;
  /** Value to pass as evaluateActionPolicy input.tokenSecurityStatus. */
  policyStatus: "ok" | "unknown";
  flags: string[];
  safetyScore?: number;
  detail?: string;
}

export async function evaluateTokenSecurityGate(
  tokenAddress: string,
  chainId = CHAIN_ID
): Promise<TokenSecurityGateResult> {
  if (!isAddress(tokenAddress)) {
    // Unresolvable token → cannot clear it → fail closed to review.
    return { verdict: "review", policyStatus: "unknown", flags: [], detail: "Token address could not be resolved for security review." };
  }

  const res = await handleCheckTokenSecurity({ tokenAddress, chainId });
  if (!res.success) {
    // GoPlus unavailable / no data → fail closed to review, never silently ok.
    return { verdict: "review", policyStatus: "unknown", flags: [], detail: res.error.message };
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
