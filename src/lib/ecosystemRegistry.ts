// ─── SafeHands Canonical Ecosystem Registry (types + validation) ────────
// The single machine-readable source of truth for repo-bundled ecosystem
// knowledge: canonical contracts, canonical tokens, price feeds, the SafeHands
// on-chain contracts, provider endpoints, and known-but-unverified protocols.
//
// Truth-model rules enforced here (see docs/DECISION_CONTRACT.md §Evidence):
//   • `safetyUse: "allow_eligible"` — the ONLY safetyUse that may contribute to
//     an ALLOW — requires verificationStatus VERIFIED, at least one verified
//     contract address, and at least one cited evidence source. Enforced by
//     validateEcosystemRegistry(), not convention.
//   • Name/alias matches are recognition only: an alias match without an
//     address match must never relax risk.
//   • `endpoint: null` is a first-class honest value meaning NOT_CONFIGURED —
//     generators and consumers must never fill it in.
//   • KNOWN_ECOSYSTEM (the name is real in the Pharos ecosystem) is deliberately
//     distinct from verificationStatus VERIFIED (SafeHands holds evidence).
//
// Provider *awareness* entries (CCIP, LayerZero, Fordefi, …) stay in
// src/lib/pharos/ecosystem.ts — they carry no bundled addresses/endpoints and
// are not part of this registry. The Anvita hosted-skill asset JSONs are
// GENERATED from this registry by scripts/sync-anvita-assets.ts.
// ─────────────────────────────────────────────────────────────────────────

import { ECOSYSTEM_REGISTRY_ITEMS } from "../data/ecosystemRegistry.data.js";

export type EcosystemItemCategory =
  | "token"
  | "protocol"
  | "bridge"
  | "oracle"
  | "infrastructure"
  | "provider"
  | "explorer"
  | "payment";

/** Ecosystem recognition status — knowing a name is never holding proof. */
export type EcosystemItemStatus = "VERIFIED" | "KNOWN_ECOSYSTEM" | "NOT_CONFIGURED" | "UNKNOWN";

/** Evidence-backed verification status (docs/REFERENCES.md ledger vocabulary). */
export type RegistryVerificationStatus = "VERIFIED" | "TO_VERIFY" | "UNVERIFIED";

export type RegistryEvidenceSourceType =
  | "onchain"
  | "official_docs"
  | "official_github"
  | "verified_explorer"
  | "provider";

export interface RegistryEvidenceSource {
  type: RegistryEvidenceSourceType;
  /** URL or repo-relative citation — never invented. */
  ref: string;
  /** ISO date the citation was last checked; null = never independently re-checked. */
  verifiedAt: string | null;
}

export interface RegistryContract {
  address: `0x${string}`;
  label: string;
  role: string;
  /** Same address across EVM chains by deterministic deployment (CREATE2). */
  deterministic: boolean;
  verificationStatus: RegistryVerificationStatus;
  /** Token/feed symbol, when the contract is a token or price feed. */
  symbol?: string;
  decimals?: number;
  /** Price pair for oracle feed contracts (e.g. "PROS/USD"). */
  pair?: string;
  /** Price reads supported, but no token identity/balance claims (e.g. USDT). */
  feedOnly?: boolean;
  note?: string;
}

export type RegistryProviderKind =
  | "rpc"
  | "price_feed"
  | "security_intel"
  | "subgraph"
  | "indexer"
  | "json_api"
  | "explorer_api"
  | "x402";

export interface RegistryProvider {
  kind: RegistryProviderKind;
  /** null = deliberately NOT_CONFIGURED — never invent an endpoint. */
  endpoint: string | null;
  /** Env var an operator can use to configure/override this provider. */
  configVia: string | null;
  status: "implemented" | "experimental" | "not_configured" | "not_implemented";
  note?: string;
}

/**
 * How an item may be used by safety logic:
 *   • allow_eligible  — address-verified canonical; may contribute to ALLOW.
 *   • recognition_only — may label/inform; never relaxes risk.
 *   • escalate_only   — recognition triggers extra caution (bridges, cross-chain,
 *     unverified protocols); never relaxes risk.
 */
export type RegistrySafetyUse = "allow_eligible" | "recognition_only" | "escalate_only";

export interface EcosystemItem {
  /** Stable slug, e.g. "token:pacific-mainnet:usdc". */
  id: string;
  name: string;
  /** Names/symbols that resolve to this item — recognition and impersonation detection only. */
  aliases: string[];
  category: EcosystemItemCategory;
  /** null = chain-agnostic (deterministic CREATE2 deployments). */
  chainId: number | null;
  ecosystemStatus: EcosystemItemStatus;
  verificationStatus: RegistryVerificationStatus;
  /** REQUIRED non-empty for verificationStatus VERIFIED. */
  evidenceSources: RegistryEvidenceSource[];
  /** Empty = no on-chain footprint claimed. */
  contracts: RegistryContract[];
  providers: RegistryProvider[];
  safetyUse: RegistrySafetyUse;
  notes: string;
}

/** The canonical registry (see src/data/ecosystemRegistry.data.ts). */
export const ECOSYSTEM_REGISTRY: readonly EcosystemItem[] = ECOSYSTEM_REGISTRY_ITEMS;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validate the registry against the fail-closed truth-model rules. Returns a
 * list of human-readable violations (empty = valid). Enforced by tests so a
 * registry edit that weakens the rules fails CI.
 */
export function validateEcosystemRegistry(items: readonly EcosystemItem[] = ECOSYSTEM_REGISTRY): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const item of items) {
    const at = `item "${item.id}"`;

    if (seenIds.has(item.id)) errors.push(`${at}: duplicate id.`);
    seenIds.add(item.id);

    if (!item.name.trim()) errors.push(`${at}: empty name.`);

    for (const c of item.contracts) {
      if (!ADDRESS_RE.test(c.address)) errors.push(`${at}: invalid contract address "${c.address}".`);
      if (!c.label.trim()) errors.push(`${at}: contract ${c.address} has an empty label.`);
    }

    const addrs = item.contracts.map((c) => c.address.toLowerCase());
    if (new Set(addrs).size !== addrs.length) errors.push(`${at}: duplicate contract addresses.`);

    // VERIFIED requires citations — an uncited entry is a claim, not truth.
    if (item.verificationStatus === "VERIFIED" && item.evidenceSources.length === 0) {
      errors.push(`${at}: verificationStatus VERIFIED requires at least one evidence source.`);
    }

    // allow_eligible is the only safetyUse that can contribute to ALLOW — gate it hard.
    if (item.safetyUse === "allow_eligible") {
      if (item.verificationStatus !== "VERIFIED") {
        errors.push(`${at}: allow_eligible requires verificationStatus VERIFIED (got ${item.verificationStatus}).`);
      }
      if (item.ecosystemStatus !== "VERIFIED") {
        errors.push(`${at}: allow_eligible requires ecosystemStatus VERIFIED (got ${item.ecosystemStatus}).`);
      }
      if (item.contracts.length === 0) {
        errors.push(`${at}: allow_eligible requires at least one contract address (name alone must never produce ALLOW).`);
      }
      if (item.contracts.some((c) => c.verificationStatus !== "VERIFIED")) {
        errors.push(`${at}: allow_eligible requires every contract to be VERIFIED.`);
      }
      if (item.evidenceSources.length === 0) {
        errors.push(`${at}: allow_eligible requires cited evidence sources.`);
      }
    }

    for (const p of item.providers) {
      if (p.endpoint === null && p.status !== "not_configured" && p.status !== "not_implemented") {
        // price_feed/rpc-style providers whose "endpoint" is on-chain or env-only are
        // allowed to be implemented without a URL, but must say so via configVia/note.
        const onChainOrEnv = p.kind === "price_feed" || p.configVia !== null;
        if (!onChainOrEnv) {
          errors.push(`${at}: provider kind=${p.kind} has no endpoint but claims status "${p.status}"; must be not_configured/not_implemented, or document configVia.`);
        }
      }
      if (p.endpoint !== null && !p.endpoint.startsWith("https://")) {
        errors.push(`${at}: provider kind=${p.kind} endpoint must be https (got "${p.endpoint}").`);
      }
    }

    if (item.ecosystemStatus === "NOT_CONFIGURED") {
      if (item.providers.length === 0 || item.providers.some((p) => p.endpoint !== null)) {
        errors.push(`${at}: NOT_CONFIGURED requires providers with null endpoints only.`);
      }
      if (item.safetyUse === "allow_eligible") {
        errors.push(`${at}: NOT_CONFIGURED can never be allow_eligible.`);
      }
    }

    if (item.ecosystemStatus === "KNOWN_ECOSYSTEM" && item.safetyUse === "allow_eligible") {
      errors.push(`${at}: KNOWN_ECOSYSTEM (name recognition) can never be allow_eligible: knowing a name is not holding proof.`);
    }
  }

  return errors;
}

interface AddressLookupResult {
  item: EcosystemItem;
  contract: RegistryContract;
}

const ADDRESS_INDEX: Map<string, AddressLookupResult> = (() => {
  const m = new Map<string, AddressLookupResult>();
  for (const item of ECOSYSTEM_REGISTRY) {
    for (const contract of item.contracts) {
      m.set(contract.address.toLowerCase(), { item, contract });
    }
  }
  return m;
})();

/** Address-matched lookup — the only lookup that may feed allow_eligible handling. */
export function lookupRegistryByAddress(address: string): AddressLookupResult | undefined {
  if (!address) return undefined;
  return ADDRESS_INDEX.get(address.trim().toLowerCase());
}

export interface AddressTrustEvidence {
  /** Address matched a registry contract registered for the given chain. */
  recognized: boolean;
  /**
   * VERIFIED item + VERIFIED contract + allow_eligible + chain match — the ONLY
   * state that may relax risk. Recognition without this is informational only.
   */
  verifiedCanonical: boolean;
  itemId: string | null;
  itemName: string | null;
  contractLabel: string | null;
  safetyUse: RegistrySafetyUse | null;
  verificationStatus: RegistryVerificationStatus | null;
  /** Registry chainId of the matched item (null = chain-agnostic). */
  registryChainId: number | null;
  note: string | null;
}

const NO_TRUST: AddressTrustEvidence = {
  recognized: false,
  verifiedCanonical: false,
  itemId: null,
  itemName: null,
  contractLabel: null,
  safetyUse: null,
  verificationStatus: null,
  registryChainId: null,
  note: null,
};

/**
 * Registry-driven trust evaluation for a single address on a given chain.
 * This is the ONLY sanctioned way for risk logic to derive spender/counterparty
 * trust: hardcoded "known address" maps outside the registry are forbidden
 * (truth-model rule: do not upgrade anything to VERIFIED without evidence).
 * An address registered for a different chainId gets NO recognition — testnet
 * provenance never carries to mainnet.
 */
export function addressTrustEvidence(address: string, chainId: number): AddressTrustEvidence {
  const hit = lookupRegistryByAddress(address);
  if (!hit) return NO_TRUST;
  const base = {
    itemId: hit.item.id,
    itemName: hit.item.name,
    contractLabel: hit.contract.label,
    safetyUse: hit.item.safetyUse,
    verificationStatus: hit.item.verificationStatus,
    registryChainId: hit.item.chainId,
  };
  const chainMatches = hit.item.chainId === null || hit.item.chainId === chainId;
  if (!chainMatches) {
    return {
      ...NO_TRUST,
      ...base,
      note: `Address matches registry entry "${hit.contract.label}" registered for chainId ${hit.item.chainId}, not the active chain ${chainId}; recognition does not carry across chains.`,
    };
  }
  return {
    ...base,
    recognized: true,
    verifiedCanonical:
      hit.item.safetyUse === "allow_eligible" &&
      hit.item.verificationStatus === "VERIFIED" &&
      hit.contract.verificationStatus === "VERIFIED",
    note: hit.contract.note ?? null,
  };
}

/**
 * Name/alias lookup — recognition only. A name match carries NO address
 * verification and must never relax a decision, regardless of the item's
 * safetyUse (which applies to address-matched evidence only).
 */
export function lookupRegistryByName(name: string): EcosystemItem | undefined {
  const q = (name ?? "").trim().toLowerCase();
  if (!q) return undefined;
  return ECOSYSTEM_REGISTRY.find(
    (item) => item.name.toLowerCase() === q || item.aliases.some((a) => a.toLowerCase() === q),
  );
}

/** Registry item by stable id. */
export function getRegistryItem(id: string): EcosystemItem | undefined {
  return ECOSYSTEM_REGISTRY.find((item) => item.id === id);
}
