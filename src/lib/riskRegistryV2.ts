import { privateKeyToAccount } from "viem/accounts";
import { keccak256, encodePacked, isAddress } from "viem";
import { publicClient, createPharosWalletClientFromAccount } from "./pharosClient.js";
import {
  RISK_REGISTRY_V2_ADDRESS, RISK_REGISTRY_V2_ABI,
  CHAIN_ID, AUTO_AUTHORIZE_AGENT_WALLET,
} from "./constants.js";

export async function isAgentAuthorized(walletAddress: `0x${string}`): Promise<boolean> {
  try {
    return await publicClient.readContract({
      address: RISK_REGISTRY_V2_ADDRESS,
      abi: RISK_REGISTRY_V2_ABI,
      functionName: "isAuthorizedAgent",
      args: [walletAddress],
    }) as boolean;
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
    return {
      riskRegistryAuthorized: false,
      autoAuthorized: false,
      authorizationReason: "AUTO_AUTHORIZE_AGENT_WALLET is disabled.",
    };
  }

  const ownerKey = process.env.RISK_REGISTRY_OWNER_PRIVATE_KEY;
  if (!ownerKey) {
    return {
      riskRegistryAuthorized: false,
      autoAuthorized: false,
      authorizationReason: "RISK_REGISTRY_OWNER_PRIVATE_KEY is not configured.",
    };
  }

  if (!isAddress(walletAddress) || walletAddress === "0x0000000000000000000000000000000000000000") {
    return {
      riskRegistryAuthorized: false,
      autoAuthorized: false,
      authorizationReason: "Invalid wallet address for auto-authorization.",
    };
  }

  try {
    const already = await isAgentAuthorized(walletAddress);
    if (already) {
      return { riskRegistryAuthorized: true, autoAuthorized: false };
    }

    const normalized = (ownerKey.startsWith("0x") ? ownerKey : `0x${ownerKey}`) as `0x${string}`;
    const ownerAccount = privateKeyToAccount(normalized);
    const ownerWallet = createPharosWalletClientFromAccount(ownerAccount);

    const txHash = await ownerWallet.writeContract({
      address: RISK_REGISTRY_V2_ADDRESS,
      abi: RISK_REGISTRY_V2_ABI,
      functionName: "setAuthorizedAgent",
      args: [walletAddress, true],
    });

    return {
      riskRegistryAuthorized: true,
      autoAuthorized: true,
      authorizationTxHash: txHash,
    };
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

export async function checkManagedWalletAuthorization(
  walletAddress: `0x${string}`,
): Promise<ManagedAuthCheckResult> {
  const authorized = await isAgentAuthorized(walletAddress);
  if (authorized) return { authorized: true };

  const autoResult = await tryAutoAuthorize(walletAddress);
  if (autoResult.riskRegistryAuthorized) {
    return { authorized: true, autoAuthResult: autoResult };
  }

  return {
    authorized: false,
    autoAuthResult: autoResult,
    errorCode: "AGENT_WALLET_NOT_AUTHORIZED",
    errorMessage: `Managed wallet ${walletAddress} is not authorized in RiskRegistry V2. ` +
      `The contract owner must call setAuthorizedAgent(${walletAddress}, true) or enable AUTO_AUTHORIZE_AGENT_WALLET=true with the owner key.`,
  };
}

export function deriveActionHash(
  chainId: number,
  actionType: string,
  walletAddress: string,
  extra: Record<string, string | undefined>,
): `0x${string}` {
  const parts = [
    String(chainId),
    actionType,
    walletAddress,
    ...Object.values(extra).filter(Boolean),
  ].join(":");
  return keccak256(encodePacked(["string"], [parts]));
}

export interface OnChainRiskRecord {
  recordId: string;
  wallet: string;
  agent: string;
  actionHash: string;
  score: number;
  riskLevel: string;
  recommendation: string;
  policyVersion: string;
  evidenceURI: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  valid: boolean;
}

function formatRecord(raw: any, valid: boolean): OnChainRiskRecord {
  return {
    recordId: String(raw.recordId),
    wallet: raw.wallet,
    agent: raw.agent,
    actionHash: raw.actionHash,
    score: Number(raw.score),
    riskLevel: raw.riskLevel,
    recommendation: raw.recommendation,
    policyVersion: raw.policyVersion,
    evidenceURI: raw.evidenceURI,
    createdAt: new Date(Number(raw.createdAt) * 1000).toISOString(),
    expiresAt: raw.expiresAt === 0n ? "never" : new Date(Number(raw.expiresAt) * 1000).toISOString(),
    revoked: raw.revoked,
    valid,
  };
}

export interface RiskRegistryQueryResult {
  version: string;
  address: string;
  walletAddress: string;
  authorized: boolean;
  hasRiskRecord: boolean;
  latestRecord: OnChainRiskRecord | null;
  error?: string;
}

export async function queryV2ForWallet(walletAddress: `0x${string}`): Promise<RiskRegistryQueryResult> {
  const base = {
    version: "v2",
    address: RISK_REGISTRY_V2_ADDRESS,
    walletAddress,
  };

  try {
    const authorized = await isAgentAuthorized(walletAddress);

    let latestRecord: OnChainRiskRecord | null = null;
    try {
      const raw = await publicClient.readContract({
        address: RISK_REGISTRY_V2_ADDRESS,
        abi: RISK_REGISTRY_V2_ABI,
        functionName: "getLatestRiskRecordForWallet",
        args: [walletAddress],
      }) as any;

      let valid = false;
      try {
        valid = await publicClient.readContract({
          address: RISK_REGISTRY_V2_ADDRESS,
          abi: RISK_REGISTRY_V2_ABI,
          functionName: "isRiskRecordValid",
          args: [raw.recordId],
        }) as boolean;
      } catch { /* validity check failed, default false */ }

      latestRecord = formatRecord(raw, valid);
    } catch {
      // RecordNotFound revert — no record exists
    }

    return {
      ...base,
      authorized,
      hasRiskRecord: latestRecord !== null,
      latestRecord,
    };
  } catch (err) {
    return {
      ...base,
      authorized: false,
      hasRiskRecord: false,
      latestRecord: null,
      error: `RiskRegistry unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
