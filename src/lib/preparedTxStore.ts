import { keccak256, stringToHex } from "viem";
import { randomUUID } from "crypto";
import { readJsonFile, stateFile, writeJsonFileAtomic } from "./persistentJsonStore.js";

export interface PreparedTransactionRecord {
  id: string;
  hash: string;
  from: string;
  to: string;
  dataHash: string;
  value: string;
  chainId: number;
  decision: string;
  policyVersion: string | null;
  policyPreset: string | null;
  expiresAt: number;
  usedAt: number | null;
  createdAt?: number;
  updatedAt?: number;
}

interface PreparedTxState {
  records: Record<string, PreparedTransactionRecord>;
}

const STORE_PATH = stateFile("prepared_transactions.json", "SAFEHANDS_PREPARED_TX_STORE_PATH");
const EXPIRATION_MS = Number(process.env.SAFEHANDS_PREPARED_TX_TTL_MS || 60 * 60 * 1000);

let state = loadState();

function loadState(): PreparedTxState {
  const loaded = readJsonFile<PreparedTxState>(STORE_PATH, { records: {} });
  cleanupExpired(loaded, Date.now(), false);
  return loaded;
}

function persist(): void {
  writeJsonFileAtomic(STORE_PATH, state);
}

function cleanupExpired(target: PreparedTxState = state, now = Date.now(), shouldPersist = true): void {
  let changed = false;
  for (const [id, record] of Object.entries(target.records)) {
    if (record.expiresAt < now) {
      delete target.records[id];
      changed = true;
    }
  }
  if (changed && shouldPersist) persist();
}

// M3: bound the store so an anonymous flood of /wallet/prepare writes cannot grow
// it without limit between TTL sweeps. Evicts oldest-created first. (Public-scale
// deployments should back this with Redis/Postgres rather than a JSON file.)
const MAX_PREPARED_TX_RECORDS = Number(process.env.SAFEHANDS_PREPARED_TX_MAX || 5000);

function enforceStoreCap(): void {
  const ids = Object.keys(state.records);
  if (ids.length <= MAX_PREPARED_TX_RECORDS) return;
  const excess = ids.length - MAX_PREPARED_TX_RECORDS;
  const oldest = ids
    .map((id) => ({ id, createdAt: state.records[id].createdAt ?? 0 }))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, excess);
  for (const { id } of oldest) delete state.records[id];
}

export function generatePreparedTransactionHash(
  from: string,
  to: string,
  data: string,
  value: string,
  chainId: number,
  decision: string,
): string {
  const payload = `${from.toLowerCase()}:${to.toLowerCase()}:${data.toLowerCase()}:${value}:${chainId}:${decision}`;
  return keccak256(stringToHex(payload));
}

export function savePreparedTx(
  from: string,
  to: string,
  data: string,
  value: string,
  chainId: number,
  decision: string,
  policyVersion: string | null,
  policyPreset: string | null,
): PreparedTransactionRecord {
  cleanupExpired();
  const id = randomUUID();
  const hash = generatePreparedTransactionHash(from, to, data, value, chainId, decision);
  const now = Date.now();

  const record: PreparedTransactionRecord = {
    id,
    hash,
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    dataHash: keccak256(data as `0x${string}`),
    value,
    chainId,
    decision,
    policyVersion,
    policyPreset,
    expiresAt: now + EXPIRATION_MS,
    usedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  state.records[id] = record;
  enforceStoreCap();
  persist();
  return record;
}

export function getPreparedTx(id: string): PreparedTransactionRecord | null {
  // Reload on read so a restarted process or another single-node lifecycle write
  // is visible without requiring a full application restart.
  state = loadState();
  const record = state.records[id];
  return record ?? null;
}

export function markPreparedTxUsed(id: string): void {
  state = loadState();
  const record = state.records[id];
  if (record && !record.usedAt) {
    const now = Date.now();
    record.usedAt = now;
    record.updatedAt = now;
    persist();
  }
}

setInterval(() => cleanupExpired(), 5 * 60 * 1000).unref();
