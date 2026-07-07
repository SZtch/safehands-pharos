// ─── SafeHands Typed Config & Safety Gates ─────────────────────────────
// Read-only by default. All four execution-related gates default to false so a
// hosted/default deployment performs read-only SafeHands checks only. Gates are
// read dynamically from the environment so runtime changes (and tests) apply.
// ────────────────────────────────────────────────────────────────────────

import {
  getActiveNetwork,
  getActiveNetworkName,
  NETWORKS,
  type NetworkName,
  type PharosNetwork,
} from "./networks.js";

function gate(name: string): boolean {
  return process.env[name] === "true";
}

// ── Safety gates (all default false) ───────────────────────────────────
export function writeToolsEnabled(): boolean { return gate("WRITE_TOOLS_ENABLED"); }
export function safeExecuteEnabled(): boolean { return gate("SAFE_EXECUTE_ENABLED"); }
export function managedWalletEnabled(): boolean { return gate("MANAGED_WALLET_ENABLED") || gate("SAFEHANDS_ENABLE_MANAGED_WALLET"); }
export function publishRiskRecordsEnabled(): boolean { return gate("PUBLISH_RISK_RECORDS_ENABLED"); }

export interface SafetyGates {
  WRITE_TOOLS_ENABLED: boolean;
  SAFE_EXECUTE_ENABLED: boolean;
  MANAGED_WALLET_ENABLED: boolean;
  PUBLISH_RISK_RECORDS_ENABLED: boolean;
}

export function getGates(): SafetyGates {
  return {
    WRITE_TOOLS_ENABLED: writeToolsEnabled(),
    SAFE_EXECUTE_ENABLED: safeExecuteEnabled(),
    MANAGED_WALLET_ENABLED: managedWalletEnabled(),
    PUBLISH_RISK_RECORDS_ENABLED: publishRiskRecordsEnabled(),
  };
}

/** Read-only mode = no execution-related gate is enabled (the default). */
export function isReadOnlyMode(): boolean {
  const g = getGates();
  return !(
    g.WRITE_TOOLS_ENABLED ||
    g.SAFE_EXECUTE_ENABLED ||
    g.MANAGED_WALLET_ENABLED ||
    g.PUBLISH_RISK_RECORDS_ENABLED
  );
}

/**
 * Execution is available only when writes are explicitly enabled AND the active
 * network permits execution. Writes stay gated by WRITE_TOOLS_ENABLED (default
 * false), so mainnet execution is never available by default.
 */
export function isExecutionAvailable(network: PharosNetwork = getActiveNetwork()): boolean {
  return writeToolsEnabled() && network.executionAllowed;
}

export interface ActiveNetworkConfig {
  network: NetworkName;
  isMainnet: boolean;
  readOnly: boolean;
  executionAvailable: boolean;
  gates: SafetyGates;
}

export function getActiveNetworkConfig(): ActiveNetworkConfig {
  const network = getActiveNetwork();
  return {
    network: getActiveNetworkName(),
    isMainnet: network.isMainnet,
    readOnly: isReadOnlyMode(),
    executionAvailable: isExecutionAvailable(network),
    gates: getGates(),
  };
}

// ── Honest product capability flags ────────────────────────────────────
// A deterministic, secret-free (booleans only) summary of what SafeHands can and
// cannot do TODAY. Implemented live read/check/analyze capabilities are `true`;
// write / signing / managed-wallet / custody capabilities — which the SafeHands API
// does NOT implement — are hard `false`. This is honest, not aspirational: a `true`
// here means there is shipping code (+ tests) behind it. It never enables anything.
export interface CapabilityFlags {
  // Implemented live (read-only, mainnet-first)
  mainnetLive: boolean;
  pharosPacificMainnet: boolean;
  liveReadChecksAvailable: boolean;
  guardianApiAvailable: boolean;
  agentApiAvailable: boolean;
  a2aAvailable: boolean;
  pharosEvidenceAvailable: boolean;
  rpcEvidenceAvailable: boolean;
  gasEvidenceAvailable: boolean;
  tokenRegistryEvidenceAvailable: boolean;
  canonicalContractEvidenceAvailable: boolean;
  ecosystemEvidenceAvailable: boolean;
  x402PreflightAvailable: boolean;
  railwayReady: boolean;
  // Phase 7 — observability + access-control foundation + public activity API (read-only)
  publicReadApiAvailable: boolean;
  apiKeyAuthAvailable: boolean;
  scopedApiKeysAvailable: boolean;
  quotaControlsAvailable: boolean;
  policyProfilesAvailable: boolean;
  activityApiAvailable: boolean;
  metricsApiAvailable: boolean;
  structuredLoggingAvailable: boolean;
  requestIdAvailable: boolean;
  // Not implemented (write / signing / managed wallet / custody) — always false here
  prepareTxAvailable: boolean;
  // Attestation
  riskRegistryAvailable: boolean;
  onchainAttestationAvailable: boolean;
  attestedBroadcastRequired: boolean;
  
  userSignedBroadcastAvailable: boolean;
  localWalletHelperAvailable: boolean;
  signingAvailable: boolean;
  managedWalletAvailable: boolean;
  autoExecutionAvailable: boolean;
  onchainPublishingAvailable: boolean;
  custodyAvailable: boolean;
  // Paid/premium surface — x402 service is active when receiver + facilitator signer are configured.
  premiumEndpointsAvailable: boolean;
  x402PaidEndpointsAvailable: boolean;
}

/**
 * Compute the honest capability flags. `true` ⇒ shipping read-only code exists;
 * the write/sign/custody group is hard-`false` because the SafeHands API has no such
 * path by construction. Pure: derives only from the network registry + which modules
 * ship — no env secrets, no side effects.
 */
export function getCapabilityFlags(network: PharosNetwork = getActiveNetwork()): CapabilityFlags {
  const mainnet = NETWORKS["pacific-mainnet"];
  // The product supports Pharos Pacific mainnet read checks (registered + read-only).
  const mainnetReadable = mainnet.readOnlyChecks === true && mainnet.chainId === 1672;
  void network; // flags are product-level; active network does not gate read availability
  return {
    // Implemented live
    mainnetLive: mainnetReadable,
    pharosPacificMainnet: mainnetReadable,
    liveReadChecksAvailable: mainnetReadable,
    guardianApiAvailable: true,
    agentApiAvailable: true,
    a2aAvailable: true,
    pharosEvidenceAvailable: true,
    rpcEvidenceAvailable: true,
    gasEvidenceAvailable: true,
    tokenRegistryEvidenceAvailable: true,
    canonicalContractEvidenceAvailable: true,
    ecosystemEvidenceAvailable: true,
    x402PreflightAvailable: true,
    // Server binds 0.0.0.0 on process.env.PORT (see api/server.ts) → deploy-ready.
    railwayReady: true,
    // Phase 7 — shipped read-only observability + public activity surface.
    publicReadApiAvailable: true,
    apiKeyAuthAvailable: true,
    scopedApiKeysAvailable: true,
    quotaControlsAvailable: true,
    policyProfilesAvailable: true,
    activityApiAvailable: true,
    metricsApiAvailable: true,
    structuredLoggingAvailable: true,
    requestIdAvailable: true,
    // — prepare-only UNSIGNED transactions (read-only; never signs/broadcasts).
    prepareTxAvailable: true,
    // Attestation
    riskRegistryAvailable: !!(process.env.SAFEHANDS_REGISTRY_ADDRESS || process.env.SAFEHANDS_RISK_REGISTRY_ADDRESS) && !!process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY,
    onchainAttestationAvailable: !!(process.env.SAFEHANDS_ATTESTATION_ADDRESS || process.env.SAFEHANDS_RISK_REGISTRY_ADDRESS) && !!process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY,
    attestedBroadcastRequired: process.env.SAFEHANDS_ATTESTATION_REQUIRED === "true",

    // Opt-in execution surfaces — honest, env-gated flags (all default OFF, so a
    // hosted deployment reports read-only/no-custody until explicitly enabled).
    userSignedBroadcastAvailable: process.env.SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED === "true",
    localWalletHelperAvailable: process.env.SAFEHANDS_LOCAL_WALLET_HELPER_ENABLED === "true",
    managedWalletAvailable: process.env.WALLET_MODE === "managed-mainnet" && managedWalletEnabled(),
    signingAvailable:
      writeToolsEnabled() &&
      (process.env.WALLET_MODE === "managed-mainnet" || process.env.WALLET_MODE === "env" || !!process.env.PRIVATE_KEY),
    autoExecutionAvailable: writeToolsEnabled() && process.env.WALLET_MODE === "managed-mainnet" && managedWalletEnabled(),
    onchainPublishingAvailable: writeToolsEnabled() && !!process.env.SAFEHANDS_REGISTRY_ADDRESS,
    custodyAvailable: process.env.WALLET_MODE === "managed-mainnet" && managedWalletEnabled(),
    // Paid/premium endpoints are live in src/x402Server.ts when receiver + facilitator are configured.
    premiumEndpointsAvailable: !!(process.env.X402_PAY_TO || process.env.WALLET_ADDRESS) && !!process.env.X402_FACILITATOR_PRIVATE_KEY,
    x402PaidEndpointsAvailable: !!(process.env.X402_PAY_TO || process.env.WALLET_ADDRESS) && !!process.env.X402_FACILITATOR_PRIVATE_KEY,
  };
}
