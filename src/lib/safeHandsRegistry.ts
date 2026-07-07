// ─── SafeHandsRegistry client ──────────────────────────────────────────
// Read/write client for the on-chain SafeHandsRegistry (trust + reputation
// oracle). Replaces the legacy SafeHandsRegistry client. Read-only by default;
// the only writes are agent authorization (owner key) and risk-record
// publishing (operator key) — both behind explicit gates in the callers.
// ────────────────────────────────────────────────────────────────────────

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, encodePacked, isAddress } from "viem";
import { publicClient, createPharosWalletClientFromAccount } from "./pharosClient.js";
import {
  SAFEHANDS_REGISTRY_ADDRESS,
  SAFEHANDS_REGISTRY_ABI,
  AUTO_AUTHORIZE_AGENT_WALLET,
} from "./constants.js";

// SafeHandsRegistry enum orderings (must match the Solidity enums).
const LEVELS = ["low", "medium", "high", "critical"] as const;
const RECOMMENDATIONS = ["proceed", "caution", "block"] as const;

/** Map a risk-engine level string to the on-chain RiskLevel enum (default MEDIUM). */
export function riskLevelToEnum(level: string): number {
  const i = LEVELS.indexOf(level.toLowerCase() as (typeof LEVELS)[number]);
  return i >= 0 ? i : 1;
}

/** Map a risk-engine recommendation string to the on-chain Recommendation enum (default CAUTION). */
export function recommendationToEnum(rec: string): number {
  const i = RECOMMENDATIONS.indexOf(rec.toLowerCase() as (typeof RECOMMENDATIONS)[number]);
  return i >= 0 ? i : 1;
}

function levelToString(level: number): string {
  return LEVELS[level] ?? "unknown";
}

function recommendationToString(rec: number): string {
  return RECOMMENDATIONS[rec] ?? "unknown";
}

/** The configured registry address, or null when not yet deployed/configured. */
function registryAddress(): `0x${string}` | null {
  return SAFEHANDS_REGISTRY_ADDRESS && isAddress(SAFEHANDS_REGISTRY_ADDRESS)
    ? (SAFEHANDS_REGISTRY_ADDRESS as `0x${string}`)
    : null;
}

export async function isAgentAuthorized(walletAddress: `0x${string}`): Promise<boolean> {
  const address = registryAddress();
  if (!address) return false;
  try {
    return (await publicClient.readContract({
      address,
      abi: SAFEHANDS_REGISTRY_ABI,
      functionName: "isAuthorizedAgent",
      args: [walletAddress],
    })) as boolean;
  } catch {
    return false;
  }
}

export interface AutoAuthorizeResult {
  riskRegistryAuthorized: boolean;
  autoAuthorized: boolean;
  authorizationTxHash?: string;
  authorizationReason?: string;
}

export async function tryAutoAuthorize(walletAddress: `0x${string}`): Promise<AutoAuthorizeResult> {
  if (!AUTO_AUTHORIZE_AGENT_WALLET) {
    return { riskRegistryAuthorized: false, autoAuthorized: false, authorizationReason: "AUTO_AUTHORIZE_AGENT_WALLET is disabled." };
  }

  const address = registryAddress();
  if (!address) {
    return { riskRegistryAuthorized: false, autoAuthorized: false, authorizationReason: "SAFEHANDS_REGISTRY_ADDRESS is not configured." };
  }

  const ownerKey = process.env.RISK_REGISTRY_OWNER_PRIVATE_KEY;
  if (!ownerKey) {
    return { riskRegistryAuthorized: false, autoAuthorized: false, authorizationReason: "RISK_REGISTRY_OWNER_PRIVATE_KEY is not configured." };
  }

  if (!isAddress(walletAddress) || walletAddress === "0x0000000000000000000000000000000000000000") {
    return { riskRegistryAuthorized: false, autoAuthorized: false, authorizationReason: "Invalid wallet address for auto-authorization." };
  }

  try {
    if (await isAgentAuthorized(walletAddress)) {
      return { riskRegistryAuthorized: true, autoAuthorized: false };
    }

    const normalized = (ownerKey.startsWith("0x") ? ownerKey : `0x${ownerKey}`) as `0x${string}`;
    const ownerWallet = createPharosWalletClientFromAccount(privateKeyToAccount(normalized));
    const txHash = await ownerWallet.writeContract({
      address,
      abi: SAFEHANDS_REGISTRY_ABI,
      functionName: "setAuthorizedAgent",
      args: [walletAddress, true],
    });

    return { riskRegistryAuthorized: true, autoAuthorized: true, authorizationTxHash: txHash };
  } catch (err) {
    return {
      riskRegistryAuthorized: false,
      autoAuthorized: false,
      authorizationReason: `Auto-authorization failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface ManagedAuthCheckResult {
  authorized: boolean;
  autoAuthResult?: AutoAuthorizeResult;
  errorCode?: string;
  errorMessage?: string;
}

export async function checkManagedWalletAuthorization(walletAddress: `0x${string}`): Promise<ManagedAuthCheckResult> {
  if (await isAgentAuthorized(walletAddress)) return { authorized: true };

  const autoResult = await tryAutoAuthorize(walletAddress);
  if (autoResult.riskRegistryAuthorized) {
    return { authorized: true, autoAuthResult: autoResult };
  }

  return {
    authorized: false,
    autoAuthResult: autoResult,
    errorCode: "AGENT_WALLET_NOT_AUTHORIZED",
    errorMessage:
      `Managed wallet ${walletAddress} is not authorized in SafeHandsRegistry. ` +
      `The contract owner must call setAuthorizedAgent(${walletAddress}, true), ` +
      `or enable AUTO_AUTHORIZE_AGENT_WALLET=true with RISK_REGISTRY_OWNER_PRIVATE_KEY.`,
  };
}

export function deriveActionHash(
  chainId: number,
  actionType: string,
  walletAddress: string,
  extra: Record<string, string | undefined>,
): `0x${string}` {
  const parts = [String(chainId), actionType, walletAddress, ...Object.values(extra).filter(Boolean)].join(":");
  return keccak256(encodePacked(["string"], [parts]));
}

export interface OnChainRiskRecord {
  recordId: string;
  target: string;
  operator: string;
  actionHash: string;
  score: number;
  riskLevel: string;
  recommendation: string;
  policyVersionHash: string;
  evidenceHash: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  valid: boolean;
}

function formatRecord(raw: any, valid: boolean): OnChainRiskRecord {
  return {
    recordId: String(raw.recordId),
    target: raw.target,
    operator: raw.operator,
    actionHash: raw.actionHash,
    score: Number(raw.score),
    riskLevel: levelToString(Number(raw.level)),
    recommendation: recommendationToString(Number(raw.recommendation)),
    policyVersionHash: raw.policyVersionHash,
    evidenceHash: raw.evidenceHash,
    createdAt: new Date(Number(raw.createdAt) * 1000).toISOString(),
    expiresAt: raw.expiresAt === 0n ? "never" : new Date(Number(raw.expiresAt) * 1000).toISOString(),
    revoked: raw.revoked,
    valid,
  };
}

export interface RegistryQueryResult {
  version: string;
  address: string;
  walletAddress: string;
  authorized: boolean;
  hasRiskRecord: boolean; // Now indicates if L2 batching is active
  currentMerkleRoot: string | null;
  currentDataURI: string | null;
  error?: string;
}

export async function queryRegistryForTarget(walletAddress: `0x${string}`): Promise<RegistryQueryResult> {
  const address = registryAddress();
  const base = { version: "safehands-registry", address: address ?? "", walletAddress };

  if (!address) {
    return {
      ...base,
      authorized: false,
      hasRiskRecord: false,
      currentMerkleRoot: null,
      currentDataURI: null,
      error: "SafeHandsRegistry address not configured (deploy + set SAFEHANDS_REGISTRY_ADDRESS).",
    };
  }

  try {
    const authorized = await isAgentAuthorized(walletAddress);

    let currentMerkleRoot: string | null = null;
    let currentDataURI: string | null = null;
    try {
      currentMerkleRoot = (await publicClient.readContract({
        address,
        abi: SAFEHANDS_REGISTRY_ABI,
        functionName: "currentMerkleRoot",
        args: [],
      })) as string;
      
      currentDataURI = (await publicClient.readContract({
        address,
        abi: SAFEHANDS_REGISTRY_ABI,
        functionName: "currentDataURI",
        args: [],
      })) as string;
    } catch {
      /* ignore if not yet committed */
    }

    const hasRiskRecord = Boolean(currentMerkleRoot && currentMerkleRoot !== "0x0000000000000000000000000000000000000000000000000000000000000000");

    return { ...base, authorized, hasRiskRecord, currentMerkleRoot, currentDataURI };
  } catch (err) {
    return {
      ...base,
      authorized: false,
      hasRiskRecord: false,
      currentMerkleRoot: null,
      currentDataURI: null,
      error: `SafeHandsRegistry unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
