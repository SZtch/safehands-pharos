// ─── Tool: token_registry_status ───────────────────────────────────────
// Classify exact token addresses without silently replacing user input.
// The official Pharos Skill Engine (pharos-skill-engine-0.1.0)
// assets/tokens.json lists 0xE0BE... as USDC for atlantic-testnet.
// ───────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { ok, type ToolResponse } from "../lib/toolResponse.js";
import { TOKEN_REGISTRY, CIRCLE_USDC_ADDRESS, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";

export const tokenRegistryStatusSchema = z.object({
  token: z.string().optional().describe("Token symbol or exact contract address to classify"),
  tokenAddress: z.string().optional().describe("Exact token contract address to classify"),
});

export type TokenRegistryStatusInput = z.input<typeof tokenRegistryStatusSchema>;

export type TokenRegistryStatusValue =
  | "CANONICAL_TESTNET_TOKEN"
  | "SKILL_ENGINE_CANONICAL_TOKEN"
  | "ALTERNATE_SOURCE_TOKEN"
  | "CUSTOM_NON_REGISTRY"
  | "UNKNOWN"
  | "INVALID_ADDRESS";

function deriveStatus(match: any): TokenRegistryStatusValue {
  if (match.verificationStatus === "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE") return "SKILL_ENGINE_CANONICAL_TOKEN";
  if (match.verificationStatus === "CIRCLE_REFERENCED_USDC") return "ALTERNATE_SOURCE_TOKEN";
  return "CANONICAL_TESTNET_TOKEN";
}

export function classifyTokenRegistryStatus(token: string) {
  const raw = token.trim();
  const upper = raw.toUpperCase();
  const bySymbol = (TOKEN_REGISTRY as Record<string, any>)[upper];
  if (bySymbol) {
    return {
      input: token,
      normalizedAddress: bySymbol.address,
      symbol: bySymbol.symbol,
      status: deriveStatus(bySymbol),
      verificationStatus: bySymbol.verificationStatus || (bySymbol.isCanonical ? "PROJECT_CONFIGURED" : "UNVERIFIED_CONFIG_VALUE"),
      docsSource: bySymbol.docsSource || "project constants",
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: false,
    };
  }

  if (!isAddress(raw)) {
    return {
      input: token,
      normalizedAddress: null,
      symbol: null,
      status: "INVALID_ADDRESS" as TokenRegistryStatusValue,
      verificationStatus: "INVALID_ADDRESS",
      docsSource: null,
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: false,
    };
  }

  const checksum = getAddress(raw);
  const entries = Object.values(TOKEN_REGISTRY as Record<string, any>);
  const match = entries.find((t) => t.address.toLowerCase() === checksum.toLowerCase());
  if (match) {
    return {
      input: token,
      normalizedAddress: checksum,
      symbol: match.symbol,
      status: deriveStatus(match),
      verificationStatus: match.verificationStatus || "PROJECT_CONFIGURED",
      docsSource: match.docsSource || "project constants",
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: false,
    };
  }

  // Check if it's the Circle USDC address directly (even if not primary)
  if (checksum.toLowerCase() === CIRCLE_USDC_ADDRESS.toLowerCase()) {
    return {
      input: token,
      normalizedAddress: checksum,
      symbol: "CIRCLE_USDC",
      status: "ALTERNATE_SOURCE_TOKEN" as TokenRegistryStatusValue,
      verificationStatus: "CIRCLE_REFERENCED_USDC",
      docsSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: false,
    };
  }

  return {
    input: token,
    normalizedAddress: checksum,
    symbol: null,
    status: "CUSTOM_NON_REGISTRY" as TokenRegistryStatusValue,
    verificationStatus: "UNVERIFIED_CUSTOM_TOKEN",
    docsSource: null,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
  };
}

export async function handleTokenRegistryStatus(raw: TokenRegistryStatusInput): Promise<ToolResponse<unknown>> {
  const input = tokenRegistryStatusSchema.parse(raw);
  return ok(classifyTokenRegistryStatus(input.tokenAddress || input.token || ""));
}
