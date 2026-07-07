import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { MerkleTree } from "merkletreejs";

export interface RiskRecordInput {
  target: string;
  actionHash: string;
  score: number;
  level: number;
  recommendation: number;
  policyVersionHash: string;
  evidenceHash: string;
  expiresAt: bigint;
}

const BATCH_FILE = process.env.SAFEHANDS_RISK_QUEUE_PATH || path.join(process.env.SAFEHANDS_STATE_DIR || process.env.STATE_DIR || ".safehands", "pending_risks.json");

export function queueRiskRecord(record: RiskRecordInput) {
  let pending: RiskRecordInput[] = [];
  if (existsSync(BATCH_FILE)) {
    try {
      pending = JSON.parse(readFileSync(BATCH_FILE, "utf-8"), (k, v) => 
        (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)
      );
    } catch (e) {
      console.warn("Failed to parse pending_risks.json, starting fresh.");
    }
  }
  
  pending.push(record);
  
  const dir = path.dirname(BATCH_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  
  writeFileSync(BATCH_FILE, JSON.stringify(pending, (k, v) => 
    (typeof v === "bigint" ? v.toString() + "n" : v)
  , 2));
}

export function getPendingRecords(): RiskRecordInput[] {
  if (!existsSync(BATCH_FILE)) return [];
  try {
    return JSON.parse(readFileSync(BATCH_FILE, "utf-8"), (k, v) => 
      (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)
    );
  } catch (e) {
    return [];
  }
}

export function clearPendingRecords() {
  if (existsSync(BATCH_FILE)) {
    writeFileSync(BATCH_FILE, "[]");
  }
}

const LEAF_ABI = parseAbiParameters("address, bytes32, uint8, uint8, uint8, bytes32, bytes32, uint64");

/**
 * Compute the Merkle leaf for a single risk record. This is the canonical leaf
 * encoding — both the writer (buildMerkleTree) and any reader (inclusion proof
 * verification) MUST derive leaves through here so they can never drift from the
 * on-chain SafeHandsRegistry.verifyRiskRecord double-keccak scheme.
 */
export function computeRiskLeaf(record: RiskRecordInput): `0x${string}` {
  const leafData = encodeAbiParameters(LEAF_ABI, [
    record.target as `0x${string}`,
    record.actionHash as `0x${string}`,
    record.score,
    record.level,
    record.recommendation,
    record.policyVersionHash as `0x${string}`,
    record.evidenceHash as `0x${string}`,
    record.expiresAt
  ]);
  // Double keccak256 to match the Smart Contract.
  return keccak256(keccak256(leafData));
}

export function buildMerkleTree(records: RiskRecordInput[]): MerkleTree {
  const leaves = records.map(computeRiskLeaf);
  return new MerkleTree(leaves, keccak256, { sortPairs: true });
}
