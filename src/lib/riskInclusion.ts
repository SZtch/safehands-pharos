// ─── L1 Merkle inclusion read-path ─────────────────────────────────────
// The keyless consumer that closes the L1 on-chain-memory loop. commitRiskRoot
// publishes a Merkle root (on-chain) + a data-availability pointer to the batch
// JSON (off-chain). This module reads that root, fetches the batch, and proves a
// single risk record is included — both locally and, for trustlessness, through
// the contract's own verifyRiskRecord view. No private key is ever touched: this
// is a pure read/verify path, safe for the zero-custody public profile.
// ────────────────────────────────────────────────────────────────────────

import { isAddress, keccak256 } from "viem";
import { MerkleTree } from "merkletreejs";
import { publicClient } from "./pharosClient.js";
import { buildMerkleTree, computeRiskLeaf, type RiskRecordInput } from "./merkleBatcher.js";
import { SAFEHANDS_REGISTRY_ADDRESS, SAFEHANDS_REGISTRY_ABI } from "./constants.js";

const ZERO_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";

function registryAddress(): `0x${string}` | null {
  return SAFEHANDS_REGISTRY_ADDRESS && isAddress(SAFEHANDS_REGISTRY_ADDRESS)
    ? (SAFEHANDS_REGISTRY_ADDRESS as `0x${string}`)
    : null;
}

/** Coerce expiresAt from any serialized form ("123n" suffixed, numeric string, number, bigint). */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") {
    const trimmed = value.trim();
    const digits = /n$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed;
    if (/^\d+$/.test(digits)) return BigInt(digits);
  }
  return 0n;
}

/**
 * Normalize the DA batch JSON into typed RiskRecordInput[]. The writer may
 * serialize expiresAt as a bigint-tagged string or a plain number, so we coerce
 * defensively rather than trusting a single encoding.
 */
export function normalizeRiskRecords(raw: unknown): RiskRecordInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r: any) => ({
      target: String(r.target ?? ""),
      actionHash: String(r.actionHash ?? ""),
      score: Number(r.score ?? 0),
      level: Number(r.level ?? 0),
      recommendation: Number(r.recommendation ?? 0),
      policyVersionHash: String(r.policyVersionHash ?? ""),
      evidenceHash: String(r.evidenceHash ?? ""),
      expiresAt: toBigInt(r.expiresAt),
    }));
}

export interface InclusionProof {
  record: RiskRecordInput;
  leaf: `0x${string}`;
  proof: `0x${string}`[];
  /** Root recomputed from the full batch — must equal the on-chain root for a valid claim. */
  computedRoot: `0x${string}`;
  /** merkletreejs verification of proof→leaf against the recomputed root. */
  verifiedLocal: boolean;
}

/**
 * Pure inclusion proof: find the record matching `match` in `records`, rebuild
 * the tree, and produce the Merkle proof for its leaf. No network, no chain —
 * fully unit-testable. Returns null when no record matches.
 */
export function proveInclusion(
  records: RiskRecordInput[],
  match: { target: string; actionHash?: string }
): InclusionProof | null {
  const target = match.target.toLowerCase();
  const actionHash = match.actionHash?.toLowerCase();
  const record = records.find(
    (r) =>
      r.target.toLowerCase() === target &&
      (actionHash === undefined || r.actionHash.toLowerCase() === actionHash)
  );
  if (!record) return null;

  const tree = buildMerkleTree(records);
  const leaf = computeRiskLeaf(record);
  const proof = tree.getHexProof(leaf) as `0x${string}`[];
  const computedRoot = tree.getHexRoot() as `0x${string}`;
  const verifiedLocal = MerkleTree.verify(proof, leaf, computedRoot, keccak256, { sortPairs: true });

  return { record, leaf, proof, computedRoot, verifiedLocal };
}

export interface RiskInclusionResult {
  /** SAFEHANDS_REGISTRY_ADDRESS is set to a valid address. */
  configured: boolean;
  /** A non-zero Merkle root has been committed on-chain. */
  committed: boolean;
  onchainMerkleRoot: string | null;
  dataURI: string | null;
  /** A record for the target was located in the batch. */
  found: boolean;
  /** The recomputed batch root equals the committed on-chain root (DA is authentic & current). */
  rootMatches: boolean;
  /** Merkle proof verified locally (merkletreejs) against the recomputed root. */
  verifiedLocal: boolean;
  /** Contract verifyRiskRecord view returned true (trustless, composable). null = not attempted. */
  verifiedOnchain: boolean | null;
  /** Record's expiresAt has passed (on-chain verifyRiskRecord would revert with Expired). */
  expired: boolean;
  proof: string[] | null;
  record: {
    target: string;
    actionHash: string;
    score: number;
    level: number;
    recommendation: number;
    policyVersionHash: string;
    evidenceHash: string;
    expiresAt: string;
  } | null;
  source: "onchain-view" | "local-only" | "unconfigured" | "not-committed" | "not-found" | "root-mismatch" | "error";
  error?: string;
}

function neutral(partial: Partial<RiskInclusionResult>): RiskInclusionResult {
  return {
    configured: false,
    committed: false,
    onchainMerkleRoot: null,
    dataURI: null,
    found: false,
    rootMatches: false,
    verifiedLocal: false,
    verifiedOnchain: null,
    expired: false,
    proof: null,
    record: null,
    source: "unconfigured",
    ...partial,
  };
}

async function fetchBatch(dataURI: string): Promise<unknown> {
  if (!/^https?:\/\//i.test(dataURI)) {
    throw new Error(
      `Unsupported data-availability URI scheme: ${dataURI}. Only http(s) batch pointers are resolvable by this read-path.`
    );
  }
  const res = await fetch(dataURI, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`DA fetch failed: HTTP ${res.status} for ${dataURI}`);
  return res.json();
}

/**
 * End-to-end keyless inclusion check for a target's risk record against the
 * currently committed on-chain Merkle root. Fail-closed and neutral on every
 * missing precondition (unconfigured, uncommitted, unreachable DA, not found).
 * When `verifyOnchain` is true (default) it additionally calls the contract's
 * verifyRiskRecord view so the "yes, this verdict is in the on-chain root" claim
 * is proven trustlessly rather than only in-process.
 */
export async function verifyRiskInclusion(
  match: { target: string; actionHash?: string },
  opts: { verifyOnchain?: boolean } = {}
): Promise<RiskInclusionResult> {
  const address = registryAddress();
  if (!address) {
    return neutral({ source: "unconfigured", error: "SAFEHANDS_REGISTRY_ADDRESS not configured." });
  }

  let onchainMerkleRoot: string;
  let dataURI: string;
  try {
    [onchainMerkleRoot, dataURI] = (await Promise.all([
      publicClient.readContract({ address, abi: SAFEHANDS_REGISTRY_ABI, functionName: "currentMerkleRoot", args: [] }),
      publicClient.readContract({ address, abi: SAFEHANDS_REGISTRY_ABI, functionName: "currentDataURI", args: [] }),
    ])) as [string, string];
  } catch (err) {
    return neutral({ configured: true, source: "error", error: `Registry read failed: ${(err as Error).message}` });
  }

  if (!onchainMerkleRoot || onchainMerkleRoot === ZERO_ROOT) {
    return neutral({ configured: true, onchainMerkleRoot, dataURI, source: "not-committed" });
  }

  let records: RiskRecordInput[];
  try {
    records = normalizeRiskRecords(await fetchBatch(dataURI));
  } catch (err) {
    return neutral({
      configured: true,
      committed: true,
      onchainMerkleRoot,
      dataURI,
      source: "error",
      error: (err as Error).message,
    });
  }

  const proven = proveInclusion(records, match);
  if (!proven) {
    return neutral({
      configured: true,
      committed: true,
      onchainMerkleRoot,
      dataURI,
      source: "not-found",
    });
  }

  const rootMatches = proven.computedRoot.toLowerCase() === onchainMerkleRoot.toLowerCase();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired = proven.record.expiresAt !== 0n && proven.record.expiresAt < now;

  const record = {
    target: proven.record.target,
    actionHash: proven.record.actionHash,
    score: proven.record.score,
    level: proven.record.level,
    recommendation: proven.record.recommendation,
    policyVersionHash: proven.record.policyVersionHash,
    evidenceHash: proven.record.evidenceHash,
    expiresAt: proven.record.expiresAt === 0n ? "never" : proven.record.expiresAt.toString(),
  };

  // If the batch we fetched does not hash to the committed root, the DA content is
  // stale or tampered — the proof is meaningless. Fail loudly rather than half-pass.
  if (!rootMatches) {
    return {
      ...neutral({}),
      configured: true,
      committed: true,
      onchainMerkleRoot,
      dataURI,
      found: true,
      rootMatches: false,
      verifiedLocal: proven.verifiedLocal,
      verifiedOnchain: null,
      expired,
      proof: proven.proof,
      record,
      source: "root-mismatch",
      error: "Recomputed batch root does not match the on-chain committed root (stale or tampered data availability).",
    };
  }

  let verifiedOnchain: boolean | null = null;
  const shouldVerifyOnchain = opts.verifyOnchain !== false;
  if (shouldVerifyOnchain) {
    try {
      verifiedOnchain = (await publicClient.readContract({
        address,
        abi: SAFEHANDS_REGISTRY_ABI,
        functionName: "verifyRiskRecord",
        args: [
          proven.record.target as `0x${string}`,
          proven.record.actionHash as `0x${string}`,
          proven.record.score,
          proven.record.level,
          proven.record.recommendation,
          proven.record.policyVersionHash as `0x${string}`,
          proven.record.evidenceHash as `0x${string}`,
          proven.record.expiresAt,
          proven.proof,
        ],
      })) as boolean;
    } catch (err) {
      // Expired() revert is a legitimate on-chain answer, not an infra failure.
      verifiedOnchain = false;
      if (!expired) {
        return {
          configured: true,
          committed: true,
          onchainMerkleRoot,
          dataURI,
          found: true,
          rootMatches: true,
          verifiedLocal: proven.verifiedLocal,
          verifiedOnchain: false,
          expired,
          proof: proven.proof,
          record,
          source: "error",
          error: `On-chain verifyRiskRecord failed: ${(err as Error).message}`,
        };
      }
    }
  }

  return {
    configured: true,
    committed: true,
    onchainMerkleRoot,
    dataURI,
    found: true,
    rootMatches: true,
    verifiedLocal: proven.verifiedLocal,
    verifiedOnchain,
    expired,
    proof: proven.proof,
    record,
    source: shouldVerifyOnchain ? "onchain-view" : "local-only",
  };
}
