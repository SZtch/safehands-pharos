import { createPublicClient, createWalletClient, http, keccak256, stringToHex, parseAbi, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pharosNetwork } from "../pharosClient.js";
import { auditLog } from "../auditLog.js";
import { readJsonFile, stateFile, writeJsonFileAtomic } from "../persistentJsonStore.js";

/**
 * Resolve the SafeHandsAttestation contract address. Prefers the new
 * SAFEHANDS_ATTESTATION_ADDRESS; falls back to the legacy SAFEHANDS_RISK_REGISTRY_ADDRESS
 * for backward compatibility during the migration.
 */
function attestationContractAddress(): string | undefined {
  return process.env.SAFEHANDS_ATTESTATION_ADDRESS || process.env.SAFEHANDS_RISK_REGISTRY_ADDRESS;
}

// Action Types matching the contract
export const ACTION_PAYMENT = keccak256(stringToHex("PAYMENT"));
export const ACTION_SWAP = keccak256(stringToHex("SWAP"));
export const ACTION_BRIDGE = keccak256(stringToHex("BRIDGE"));
export const ACTION_APPROVAL = keccak256(stringToHex("APPROVAL"));
export const ACTION_CONTRACT_CALL = keccak256(stringToHex("CONTRACT_CALL"));
export const ACTION_UNKNOWN = keccak256(stringToHex("UNKNOWN"));

const attestationAbi = parseAbi([
  "function attest(bytes32 preparedTransactionHash, bytes32 txHash, uint256 chainId, bytes32 actionType, bytes32 policyHash, bytes32 metadataHash, address agent) external",
  "function reputationOf(address agent) view returns (uint256 verifiedCount, uint64 lastAt)",
  "function attestationCountByAgent(address agent) view returns (uint256)"
]);

type AttestationStatus = "required" | "skipped" | "published" | "confirmed" | "pending_retry" | "failed";

export interface PendingAttestation {
  txHash: string;
  preparedTransactionHash: string;
  chainId: number;
  actionType: `0x${string}`;
  policyHash: `0x${string}`;
  metadataHash: `0x${string}`;
  /** The agent/signer the verified action is attributed to (drives reputationOf). */
  agent: `0x${string}`;
  status: AttestationStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  attestationTxHash?: string;
  lastError?: string;
}

interface AttestationState {
  records: Record<string, PendingAttestation>;
}

const STORE_PATH = stateFile("attestations.json", "SAFEHANDS_ATTESTATION_STORE_PATH");
const RETRY_ENABLED = process.env.SAFEHANDS_ATTESTATION_RETRY_ENABLED !== "false";
const MAX_ATTEMPTS = Number(process.env.SAFEHANDS_ATTESTATION_MAX_ATTEMPTS || 5);
const RETRY_DELAY_MS = Number(process.env.SAFEHANDS_ATTESTATION_RETRY_DELAY_MS || 60_000);
const RETRY_INTERVAL_MS = Number(process.env.SAFEHANDS_ATTESTATION_RETRY_INTERVAL_MS || 60_000);

let state = readJsonFile<AttestationState>(STORE_PATH, { records: {} });
let retryLoopStarted = false;

function persist(): void {
  writeJsonFileAtomic(STORE_PATH, state);
}

function upsert(record: PendingAttestation): void {
  state.records[record.txHash.toLowerCase()] = record;
  persist();
}

export function getAttestationStatus(txHash: string): AttestationStatus {
  state = readJsonFile<AttestationState>(STORE_PATH, { records: {} });
  return state.records[txHash.toLowerCase()]?.status || "skipped";
}

export function getAttestationRecord(txHash: string): PendingAttestation | null {
  state = readJsonFile<AttestationState>(STORE_PATH, { records: {} });
  return state.records[txHash.toLowerCase()] ?? null;
}

export function checkAttestationConfig() {
  const required = process.env.SAFEHANDS_ATTESTATION_REQUIRED === "true";
  const address = attestationContractAddress();
  const pk = process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY;

  if (required && (!address || !pk)) {
    throw new Error("Attestation required but SAFEHANDS_ATTESTATION_ADDRESS or SAFEHANDS_ATTESTER_PRIVATE_KEY is missing. Aborting broadcast.");
  }
}

/**
 * True only when this process holds both an attestation contract address and an
 * attester signing key. The zero-custody public profile has neither, so there is
 * nothing for the retry loop to publish — arming the timer would just spin.
 */
function isAttesterConfigured(): boolean {
  return Boolean(attestationContractAddress() && process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY);
}

export function classifyAction(parsedTx: any): `0x${string}` {
  if (!parsedTx.data || parsedTx.data === "0x") {
    return ACTION_PAYMENT;
  }
  const selector = parsedTx.data.slice(0, 10);
  if (selector === "0x095ea7b3") { // approve(address,uint256)
    return ACTION_APPROVAL;
  }
  return ACTION_CONTRACT_CALL;
}

function makePending(txHash: string, parsedTx: any, record: any): PendingAttestation {
  const actionType = classifyAction(parsedTx);
  const policyHash = record.policyVersion ? keccak256(stringToHex(record.policyVersion)) : keccak256(stringToHex("none"));
  const metadataHash = record.evidenceHash ? (record.evidenceHash as `0x${string}`) : keccak256(stringToHex("none"));
  const agent = (record.from as `0x${string}`) || zeroAddress;
  const now = Date.now();
  return {
    txHash,
    preparedTransactionHash: record.hash,
    chainId: record.chainId,
    actionType,
    policyHash,
    metadataHash,
    agent,
    status: "pending_retry",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function attemptPublish(record: PendingAttestation): Promise<AttestationStatus> {
  const required = process.env.SAFEHANDS_ATTESTATION_REQUIRED === "true";
  const address = attestationContractAddress() as `0x${string}` | undefined;
  const pk = process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY;

  if (!address || !pk) {
    record.status = required ? "failed" : "skipped";
    record.updatedAt = Date.now();
    record.lastError = required ? "Attestation required but signer/address missing" : undefined;
    upsert(record);
    return record.status;
  }

  try {
    record.status = "pending_retry";
    record.attempts += 1;
    record.updatedAt = Date.now();
    upsert(record);

    const formattedPk = pk.startsWith("0x") ? pk : `0x${pk}`;
    const account = privateKeyToAccount(formattedPk as `0x${string}`);
    const rpc = process.env.PHAROS_RPC_URL || "https://rpc.pharos.xyz";

    const publicClient = createPublicClient({
      chain: pharosNetwork,
      transport: http(rpc)
    });

    const walletClient = createWalletClient({
      account,
      chain: pharosNetwork,
      transport: http(rpc)
    });

    const { request } = await publicClient.simulateContract({
      address,
      abi: attestationAbi,
      functionName: "attest",
      args: [
        record.preparedTransactionHash as `0x${string}`,
        record.txHash as `0x${string}`,
        BigInt(record.chainId),
        record.actionType,
        record.policyHash,
        record.metadataHash,
        record.agent
      ],
      account
    });

    const attestationTxHash = await walletClient.writeContract(request);
    record.attestationTxHash = attestationTxHash;
    record.status = "published";
    record.updatedAt = Date.now();
    upsert(record);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: attestationTxHash });
    record.status = receipt.status === "success" ? "confirmed" : "failed";
    record.updatedAt = Date.now();
    if (receipt.status !== "success") record.lastError = "Attestation transaction reverted";
    upsert(record);

    auditLog({
      ts: new Date().toISOString(),
      tool: "publish_attestation",
      success: record.status === "confirmed",
      errorCode: record.status === "confirmed" ? undefined : "ATTESTATION_TX_REVERTED",
      txHash: record.txHash,
      attestationTxHash,
      attempts: record.attempts,
      status: record.status,
    });

    return record.status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record.status = record.attempts >= MAX_ATTEMPTS ? "failed" : "pending_retry";
    record.nextAttemptAt = Date.now() + RETRY_DELAY_MS * Math.max(1, record.attempts);
    record.updatedAt = Date.now();
    record.lastError = message;
    upsert(record);
    auditLog({
      ts: new Date().toISOString(),
      tool: "publish_attestation",
      success: false,
      errorCode: "ATTESTATION_PUBLISH_FAILED",
      txHash: record.txHash,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt,
      message,
    });
    console.error("Attestation publish failed:", message);
    return record.status;
  }
}

export async function publishAttestation(txHash: string, parsedTx: any, record: any): Promise<AttestationStatus> {
  const required = process.env.SAFEHANDS_ATTESTATION_REQUIRED === "true";
  const address = attestationContractAddress();
  const pk = process.env.SAFEHANDS_ATTESTER_PRIVATE_KEY;

  if (!address || !pk) {
    const status = required ? "failed" : "skipped";
    if (required) {
      const pending = makePending(txHash, parsedTx, record);
      pending.status = "failed";
      pending.lastError = "Attestation required but signer/address missing";
      pending.updatedAt = Date.now();
      upsert(pending);
    }
    return status;
  }

  const pending = makePending(txHash, parsedTx, record);
  upsert(pending);
  return attemptPublish(pending);
}

export interface AgentReputation {
  agent: string;
  /** True when the on-chain SafeHandsAttestation address is configured. */
  configured: boolean;
  /** Count of SafeHands-verified safe broadcasts attributed to this address. */
  verifiedCount: number;
  /** Unix seconds of the most recent attestation (0 = no track record yet). */
  lastAttestationAt: number;
  source: "onchain" | "unconfigured";
}

/**
 * Read an address's on-chain SafeHands reputation (verified-safe broadcast count +
 * recency). Read-only, keyless, composable — any agent can consult this as a trust
 * signal. A zero count means "no track record yet" → treat as NEUTRAL, never as a
 * negative (the ledger only records verified-safe actions). Degrades gracefully to a
 * neutral zero when the contract is unconfigured or the RPC read fails.
 */
export async function getAgentReputation(agent: string): Promise<AgentReputation> {
  const address = attestationContractAddress() as `0x${string}` | undefined;
  const neutral = { agent, verifiedCount: 0, lastAttestationAt: 0 };
  if (!/^0x[0-9a-fA-F]{40}$/.test(agent)) {
    return { ...neutral, configured: Boolean(address), source: "unconfigured" };
  }
  if (!address) {
    return { ...neutral, configured: false, source: "unconfigured" };
  }
  try {
    const rpc = process.env.PHAROS_RPC_URL || "https://rpc.pharos.xyz";
    const publicClient = createPublicClient({ chain: pharosNetwork, transport: http(rpc) });
    const [verifiedCount, lastAt] = (await publicClient.readContract({
      address,
      abi: attestationAbi,
      functionName: "reputationOf",
      args: [agent as `0x${string}`],
    })) as readonly [bigint, bigint];
    return {
      agent,
      configured: true,
      verifiedCount: Number(verifiedCount),
      lastAttestationAt: Number(lastAt),
      source: "onchain",
    };
  } catch {
    return { ...neutral, configured: true, source: "onchain" };
  }
}

export async function retryPendingAttestations(): Promise<number> {
  state = readJsonFile<AttestationState>(STORE_PATH, { records: {} });
  const now = Date.now();
  const records = Object.values(state.records).filter((record) =>
    record.status === "pending_retry" && record.attempts < MAX_ATTEMPTS && record.nextAttemptAt <= now
  );
  let attempted = 0;
  for (const record of records) {
    attempted += 1;
    await attemptPublish(record);
  }
  return attempted;
}

export function startAttestationRetryLoop(): void {
  if (!RETRY_ENABLED || retryLoopStarted) return;
  // Zero-custody profile has no attester key/address: don't arm an unusable timer.
  // If attestation is explicitly required, keep the loop so a late/misconfig gets
  // surfaced via retryPendingAttestations → attemptPublish marking records failed.
  if (!isAttesterConfigured() && process.env.SAFEHANDS_ATTESTATION_REQUIRED !== "true") return;
  retryLoopStarted = true;
  setInterval(() => {
    retryPendingAttestations().catch((err) => {
      console.error("Attestation retry loop failed:", err instanceof Error ? err.message : String(err));
    });
  }, RETRY_INTERVAL_MS).unref();
}

startAttestationRetryLoop();
