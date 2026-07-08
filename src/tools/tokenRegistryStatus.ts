// ─── Tool: token_registry_status ───────────────────────────────────────
// Classify exact token inputs against the active network token registry.
// Pacific Mainnet uses PACIFIC_MAINNET_TOKEN_REGISTRY; Atlantic Testnet keeps
// the legacy testnet registry for compatibility.
// ───────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { ok, type ToolResponse } from "../lib/toolResponse.js";
import {
  TOKEN_REGISTRY,
  CIRCLE_USDC_ADDRESS,
  CHAIN_ID,
  PHAROS_ENVIRONMENT,
  IS_MAINNET,
  PACIFIC_MAINNET_TOKEN_REGISTRY,
} from "../lib/constants.js";
import { getActiveNetwork } from "../lib/networks.js";
import { fetchGoplusTokenIdentity } from "./checkTokenSecurity.js";

export const tokenRegistryStatusSchema = z.object({
  token: z.string().optional().describe("Token symbol or exact contract address to classify"),
  tokenAddress: z.string().optional().describe("Exact token contract address to classify"),
});

export type TokenRegistryStatusInput = z.input<typeof tokenRegistryStatusSchema>;

export type TokenRegistryStatusValue =
  | "CANONICAL_MAINNET_TOKEN"
  | "SKILL_ENGINE_CANONICAL_TOKEN"
  | "ALTERNATE_SOURCE_TOKEN"
  | "CUSTOM_NON_REGISTRY"
  | "UNKNOWN"
  | "INVALID_ADDRESS";

type RegistryEntry = {
  symbol: string;
  address: string;
  decimals?: number;
  chainId?: number;
  environment?: string;
  isMainnet?: boolean;
  isCanonical?: boolean;
  verificationStatus?: string;
  docsSource?: string;
};

function activeRegistry(): Record<string, RegistryEntry> {
  return getActiveNetwork().isMainnet
    ? (PACIFIC_MAINNET_TOKEN_REGISTRY as unknown as Record<string, RegistryEntry>)
    : (TOKEN_REGISTRY as unknown as Record<string, RegistryEntry>);
}

function deriveStatus(match: RegistryEntry): TokenRegistryStatusValue {
  if (getActiveNetwork().isMainnet || match.isMainnet) return "CANONICAL_MAINNET_TOKEN";
  if (match.verificationStatus === "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE") return "SKILL_ENGINE_CANONICAL_TOKEN";
  if (match.verificationStatus === "CIRCLE_REFERENCED_USDC") return "ALTERNATE_SOURCE_TOKEN";
  return "CANONICAL_MAINNET_TOKEN";
}

function responseBase() {
  return {
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: IS_MAINNET,
  };
}

export function classifyTokenRegistryStatus(token: string) {
  const raw = token.trim();
  const upper = raw.toUpperCase();
  const registry = activeRegistry();
  const bySymbol = registry[upper];
  if (bySymbol) {
    return {
      input: token,
      normalizedAddress: bySymbol.address,
      symbol: bySymbol.symbol,
      status: deriveStatus(bySymbol),
      verificationStatus: bySymbol.verificationStatus || (bySymbol.isCanonical ? "DOCS_VERIFIED" : "UNVERIFIED_CONFIG_VALUE"),
      docsSource: bySymbol.docsSource || "active network token registry",
      ...responseBase(),
    };
  }

  if (!isAddress(raw)) {
    return {
      input: token,
      normalizedAddress: null,
      symbol: null,
      status: (raw ? "UNKNOWN" : "INVALID_ADDRESS") as TokenRegistryStatusValue,
      verificationStatus: raw ? "UNKNOWN_SYMBOL" : "INVALID_ADDRESS",
      docsSource: null,
      ...responseBase(),
    };
  }

  const checksum = getAddress(raw);
  const entries = Object.values(registry);
  const match = entries.find((t) => t.address.toLowerCase() === checksum.toLowerCase());
  if (match) {
    return {
      input: token,
      normalizedAddress: checksum,
      symbol: match.symbol,
      status: deriveStatus(match),
      verificationStatus: match.verificationStatus || (getActiveNetwork().isMainnet ? "DOCS_VERIFIED" : "PROJECT_CONFIGURED"),
      docsSource: match.docsSource || "active network token registry",
      ...responseBase(),
    };
  }

  // Atlantic-only alternate USDC recognition. On Pacific Mainnet this old
  // address is intentionally treated as custom/non-registry.
  if (!getActiveNetwork().isMainnet && checksum.toLowerCase() === CIRCLE_USDC_ADDRESS.toLowerCase()) {
    return {
      input: token,
      normalizedAddress: checksum,
      symbol: "CIRCLE_USDC",
      status: "ALTERNATE_SOURCE_TOKEN" as TokenRegistryStatusValue,
      verificationStatus: "CIRCLE_REFERENCED_USDC",
      docsSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
      ...responseBase(),
    };
  }

  return {
    input: token,
    normalizedAddress: checksum,
    symbol: null,
    status: "CUSTOM_NON_REGISTRY" as TokenRegistryStatusValue,
    verificationStatus: "UNVERIFIED_CUSTOM_TOKEN",
    docsSource: null,
    ...responseBase(),
  };
}

export async function handleTokenRegistryStatus(raw: TokenRegistryStatusInput): Promise<ToolResponse<unknown>> {
  const input = tokenRegistryStatusSchema.parse(raw);
  const classification = classifyTokenRegistryStatus(input.tokenAddress || input.token || "");

  // For custom/non-registry tokens, best-effort DISPLAY-ONLY identity enrichment.
  // Purely additive: status/verificationStatus/symbol are never altered, metadata
  // is never fed into policy or gates (those consume classifyTokenRegistryStatus
  // directly), and a fetch failure leaves the response identical to before.
  if (classification.status !== "CUSTOM_NON_REGISTRY" || !classification.normalizedAddress) {
    return ok(classification);
  }
  const identity = await fetchGoplusTokenIdentity(classification.normalizedAddress);
  if (!identity.tokenName && !identity.tokenSymbol) {
    return ok(classification);
  }
  return ok({
    ...classification,
    tokenMetadata: {
      tokenName: identity.tokenName,
      tokenSymbol: identity.tokenSymbol,
      source: "goplus_metadata",
      verified: false,
      displayOnly: true,
      warning:
        "Untrusted display-only metadata reported by a third-party API. It does NOT verify this token's identity and does NOT imply the token is safe. The token remains UNVERIFIED_CUSTOM_TOKEN; anyone can deploy a token with any name/symbol.",
    },
  });
}
