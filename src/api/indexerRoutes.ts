import { goldskyStatus, lookupLatestRiskRootInGoldsky } from "../lib/goldsky.js";
import { queryRegistryForTarget } from "../lib/safeHandsRegistry.js";
import { getAgentReputation } from "../lib/pharos/attestationPublisher.js";
import { getActiveNetworkName } from "../lib/networks.js";
import { readOnlyMeta } from "./response.js";
import { isAddress } from "viem";

export function handleGoldskyStatus() {
  return {
    service: "safehands-goldsky-indexer",
    status: goldskyStatus(),
    role: "Goldsky indexes SafeHands on-chain Registry and Attestation events for fast user/agent lookup. Contracts remain the source of truth.",
    recommendedEntities: {
      attestations: process.env.GOLDSKY_ATTESTATION_ENTITIES || "safeHandsAttesteds,attestations",
      riskRoots: process.env.GOLDSKY_RISK_ROOT_ENTITIES || "riskRootCommitteds,safeHandsRiskRootCommitteds",
    },
    network: getActiveNetworkName(),
    ...readOnlyMeta(),
  };
}

/**
 * Read-only, keyless, composable on-chain reputation for an address: the count of
 * SafeHands-verified safe broadcasts attributed to it (+ recency), plus registry
 * authorization/risk-record context. Any agent can query this as a trust signal.
 * Zero count = NEUTRAL (no track record yet), never negative.
 */
export async function handleAgentReputation(address: string) {
  if (!address || !isAddress(address)) {
    throw new Error("A valid 0x address is required (GET /reputation/:address).");
  }
  const [reputation, registry] = await Promise.all([
    getAgentReputation(address),
    queryRegistryForTarget(address as `0x${string}`),
  ]);
  return {
    address,
    reputation: {
      verifiedActionCount: reputation.verifiedCount,
      lastVerifiedActionAt: reputation.lastAttestationAt,
      configured: reputation.configured,
      source: reputation.source,
    },
    registry: {
      isAuthorizedAgent: registry.authorized,
      hasRiskRecord: registry.hasRiskRecord,
      currentMerkleRoot: registry.currentMerkleRoot,
    },
    interpretation:
      reputation.verifiedCount > 0
        ? `${reputation.verifiedCount} SafeHands-verified on-chain action(s); positive track record.`
        : "No SafeHands-verified actions yet: NEUTRAL. Absence of record is not negative; this ledger only records verified-safe actions.",
    network: getActiveNetworkName(),
    ...readOnlyMeta(),
  };
}

export async function handleLatestRiskRootIndex() {
  const goldsky = await lookupLatestRiskRootInGoldsky();

  // Optional on-chain registry read: queryRegistryForTarget also returns the current root.
  // It needs a wallet address only to include authorization; use zero address-like fallback
  // only when a valid operator address is supplied by env.
  const referenceWallet = process.env.SAFEHANDS_REGISTRY_REFERENCE_WALLET;
  let onchain: Record<string, unknown> | null = null;
  if (referenceWallet && isAddress(referenceWallet)) {
    onchain = { ...(await queryRegistryForTarget(referenceWallet as `0x${string}`)) };
  }

  return {
    status: goldsky.indexed ? "indexed" : "not_indexed",
    goldsky,
    onchain,
    note: onchain
      ? "onchain.currentMerkleRoot is included from SafeHandsRegistry. Goldsky is the fast query layer."
      : "Set SAFEHANDS_REGISTRY_REFERENCE_WALLET to include an on-chain registry read in this endpoint.",
    network: getActiveNetworkName(),
    ...readOnlyMeta(),
  };
}
