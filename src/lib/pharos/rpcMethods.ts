// ─── Pharos JSON-RPC Method Matrix (read-only enforcement) ─────────────
// Single source of truth classifying every JSON-RPC method SafeHands may
// encounter. Hosted/read-only mode allows ONLY read methods; write, signing,
// and account methods are blocked fail-closed (unknown methods are blocked too).
// Grounded in the official Pharos JSON-RPC docs
// (docs.pharos.xyz/api-and-sdk/json-rpc-methods, verified 2026-06-27):
//   • the ONLY documented write method is eth_sendRawTransaction
//   • eth_getProof (EIP-1186) and eth_getAccount are officially supported reads
//   • eth_accounts returns [] (the node manages no accounts); eth_sign is undocumented
// Nothing in this module signs, sends, or mutates chain state.
// ───────────────────────────────────────────────────────────────────────

export type RpcMethodClassification =
  | "read_only"
  | "experimental_read_only"
  | "write_blocked"
  | "unsupported"
  | "to_verify";

export type RpcMethodSafehandsStatus =
  | "implemented"
  | "experimental"
  | "blocked"
  | "not_implemented"
  | "to_verify";

export interface RpcMethodEntry {
  method: string;
  classification: RpcMethodClassification;
  officialDocsUrl?: string;
  safehandsStatus: RpcMethodSafehandsStatus;
  riskRelevance: string;
  hostedModeBehavior: string;
}

const JSON_RPC_DOCS = "https://docs.pharos.xyz/api-and-sdk/json-rpc-methods";
const GETPROOF_DOCS = "https://docs.pharos.xyz/api-and-sdk/eth-getproof-storage-state-verification";

const ALLOW_BEHAVIOR = "Allowed in hosted read-only mode.";
const EXPERIMENTAL_BEHAVIOR =
  "Allowed as a read-only call, attempted with graceful fallback; deeper verification (e.g. SPV) is NOT implemented.";
const BLOCK_BEHAVIOR = "BLOCKED in hosted read-only mode — never called.";
const UNSUPPORTED_BEHAVIOR = "Unsupported on Pharos / never called automatically.";

function readOnly(method: string, riskRelevance: string, officialDocsUrl: string = JSON_RPC_DOCS): RpcMethodEntry {
  return { method, classification: "read_only", officialDocsUrl, safehandsStatus: "implemented", riskRelevance, hostedModeBehavior: ALLOW_BEHAVIOR };
}
function experimental(method: string, riskRelevance: string, officialDocsUrl: string = JSON_RPC_DOCS): RpcMethodEntry {
  return { method, classification: "experimental_read_only", officialDocsUrl, safehandsStatus: "experimental", riskRelevance, hostedModeBehavior: EXPERIMENTAL_BEHAVIOR };
}
function writeBlocked(method: string, riskRelevance: string): RpcMethodEntry {
  return { method, classification: "write_blocked", officialDocsUrl: JSON_RPC_DOCS, safehandsStatus: "blocked", riskRelevance, hostedModeBehavior: BLOCK_BEHAVIOR };
}
function unsupported(method: string, riskRelevance: string): RpcMethodEntry {
  return { method, classification: "unsupported", safehandsStatus: "not_implemented", riskRelevance, hostedModeBehavior: UNSUPPORTED_BEHAVIOR };
}

const ENTRIES: RpcMethodEntry[] = [
  // ── Read-only (officially supported) ──────────────────────────────────
  readOnly("eth_chainId", "Confirms the active chain (Pacific Mainnet = 1672)."),
  readOnly("eth_blockNumber", "Chain head; freshness of read evidence."),
  readOnly("eth_gasPrice", "Legacy gas price for fee estimation."),
  readOnly("eth_maxPriorityFeePerGas", "EIP-1559 priority fee for fee estimation."),
  readOnly("eth_feeHistory", "Historical base/priority fees for fee estimation."),
  readOnly("eth_call", "Simulated read-only call; never changes state."),
  readOnly("eth_estimateGas", "Gas estimation; a failing estimate often signals a revert."),
  readOnly("eth_getCode", "Distinguishes contracts from EOAs."),
  readOnly("eth_getBalance", "Account balance for affordability checks."),
  readOnly("eth_getStorageAt", "Raw contract storage read."),
  readOnly("eth_getTransactionCount", "Account nonce."),
  readOnly("eth_getTransactionByHash", "Transaction lookup by hash."),
  readOnly("eth_getTransactionReceipt", "Receipt/status of a mined transaction."),
  readOnly("eth_getBlockByHash", "Block lookup by hash."),
  readOnly("eth_getBlockByNumber", "Block lookup by number."),
  readOnly("eth_getBlockReceipts", "All transaction receipts in a block."),
  readOnly("eth_getLogs", "Event logs (block range ≤100 when rate-limited)."),
  readOnly("eth_getAccount", "Account details (balance/nonce); officially supported read."),
  readOnly("eth_syncing", "Node sync status."),
  readOnly("net_version", "Network id."),
  readOnly("web3_clientVersion", "Client version string."),

  // ── Experimental read-only (supported but heavy / not fully consumed) ──
  experimental(
    "eth_getProof",
    "EIP-1186 account/storage Merkle proof. SafeHands exposes availability as evidence only — full SPV verification is NOT implemented.",
    GETPROOF_DOCS,
  ),
  experimental("debug_traceTransaction", "Full execution trace; heavy/optional, best-effort only."),
  experimental("trace_filter", "Filtered traces (block range ≤500); heavy/optional, best-effort only."),

  // ── Write — BLOCKED in hosted read-only mode ──────────────────────────
  writeBlocked("eth_sendRawTransaction", "Submits a signed transaction — the only documented state-changing method; NEVER used in hosted read-only mode."),
  writeBlocked("eth_sendTransaction", "Node-signed send; blocked (the node manages no accounts and SafeHands never sends)."),
  writeBlocked("eth_signTransaction", "Signs a transaction; blocked — SafeHands never signs."),
  writeBlocked("eth_sign", "Signs arbitrary data; blocked (also undocumented on Pharos)."),
  writeBlocked("personal_sign", "Wallet message signing; blocked — SafeHands holds no keys."),
  writeBlocked("eth_signTypedData", "EIP-712 typed-data signing; blocked."),
  writeBlocked("eth_signTypedData_v4", "EIP-712 typed-data signing; blocked."),
  writeBlocked("personal_unlockAccount", "Unlocks a node-managed account; blocked."),
  writeBlocked("personal_newAccount", "Account creation; blocked — SafeHands never creates/holds keys."),
  writeBlocked("personal_importRawKey", "Private-key import; blocked — SafeHands never imports keys."),
  writeBlocked("wallet_addEthereumChain", "Wallet management; blocked."),
  writeBlocked("wallet_switchEthereumChain", "Wallet management; blocked."),
  writeBlocked("wallet_watchAsset", "Wallet management; blocked."),
  writeBlocked("wallet_requestPermissions", "Wallet management; blocked."),

  // ── Unsupported on Pharos / never auto-called ─────────────────────────
  unsupported("eth_accounts", "Returns [] on Pharos (node manages no accounts); never relied upon."),
  unsupported("eth_coinbase", "Deprecated PoW-era method; not used."),
  unsupported("eth_mining", "Deprecated PoW-era method; not used."),
  unsupported("eth_hashrate", "Deprecated PoW-era method; not used."),
  unsupported("eth_getUncleCountByBlockHash", "Uncles are a PoW concept; returns null."),
  unsupported("eth_getUncleCountByBlockNumber", "Uncles are a PoW concept; returns null."),
  unsupported("eth_getUncleByBlockHashAndIndex", "Uncles are a PoW concept; returns null."),
  unsupported("eth_getUncleByBlockNumberAndIndex", "Uncles are a PoW concept; returns null."),
  unsupported("eth_getCompilers", "Deprecated."),
  unsupported("eth_pendingTransactions", "Returns empty array on Pharos."),
  unsupported("eth_batchGetBlockByNumber", "Method not implemented on Pharos."),
  unsupported("eth_batchGetTransactionByHash", "Method not implemented on Pharos."),
  unsupported("eth_batchGetTransactionReceipt", "Method not implemented on Pharos."),
  unsupported("eth_batchGetBlockReceipts", "Method not implemented on Pharos."),
  
  // ── Newly Documented Read Methods (Pacific Mainnet) ───────────────────
  readOnly("eth_createAccessList", "Creates an EIP-2930 access list for a transaction (under debugging)."),
  readOnly("eth_getBlockTransactionCountByHash", "Returns the number of transactions in a block by block hash."),
  readOnly("eth_getBlockTransactionCountByNumber", "Returns the number of transactions in a block by block number."),
  readOnly("eth_getTransactionByBlockHashAndIndex", "Returns a transaction by block hash and index position."),
  readOnly("eth_getTransactionByBlockNumberAndIndex", "Returns a transaction by block number and index position."),
  readOnly("eth_subscribe", "Creates a subscription for real-time events (WebSocket only)."),
  readOnly("eth_unsubscribe", "Cancels an existing subscription (WebSocket only)."),
  readOnly("net_listening", "Returns whether the node is actively listening (not available on public RPC)."),
  readOnly("net_peerCount", "Returns the number of connected peers (not available on public RPC)."),
  readOnly("web3_sha3", "Returns the Keccak-256 hash of the given data (not available on public RPC)."),
  readOnly("eth_getProposerByTxHash", "Returns the block proposer for a given transaction (Pharos Extension)."),
  readOnly("eth_getProposersByBlockNumber", "Returns the list of proposers for a given block (Pharos Extension)."),
  
  // ── Debug / Trace Methods ──────────────────────────────────────────────
  experimental("debug_traceCall", "Executes a call and returns the execution trace without creating a transaction."),
  experimental("debug_traceBlockByHash", "Returns traces for all transactions in a block by block hash."),
  experimental("debug_traceBlockByNumber", "Returns traces for all transactions in a block by block number."),
  experimental("debug_getRawBlock", "Returns the RLP-encoded block data."),
  experimental("debug_getRawHeader", "Returns the RLP-encoded block header."),
  experimental("debug_getRawReceipts", "Returns the raw receipts for a block."),
  experimental("debug_getRawTransaction", "Returns the raw transaction data by hash."),
  experimental("debug_protocolVersion", "Returns detailed protocol and version information."),
  experimental("txpool_nonceFrom", "Returns the next nonce for an address from the transaction pool."),
  experimental("debug_getValidatorInfo", "Returns validator information for the consensus layer (Pharos Extension)."),
  experimental("debug_getBlockProof", "Returns the block proof data for BLS signature verification (Pharos Extension)."),
  experimental("debug_getBlockReadStates", "Returns the read state set for a block (Pharos Extension)."),
  experimental("debug_getBlockWriteStates", "Returns the write state set for a block (Pharos Extension)."),
  experimental("debug_getBlockWriteSetKeys", "Returns the write set keys for a block (Pharos Extension)."),
];

export const RPC_METHOD_MATRIX: Record<string, RpcMethodEntry> = Object.fromEntries(
  ENTRIES.map((e) => [e.method, e]),
);

/** Error thrown when a non-read-only (or unknown) method is requested in hosted mode. */
export class RpcMethodBlockedError extends Error {
  readonly method: string;
  readonly classification: RpcMethodClassification;
  constructor(method: string, classification: RpcMethodClassification) {
    super(`RPC method "${method}" is blocked in hosted read-only mode (classification: ${classification}).`);
    this.name = "RpcMethodBlockedError";
    this.method = method;
    this.classification = classification;
  }
}

/**
 * Classify a method. Known methods use the matrix; unknown `wallet_*`/`personal_*`
 * are treated as write_blocked, and any other unknown method as unsupported — both
 * fail closed in {@link assertHostedReadOnlyMethod}.
 */
export function classifyRpcMethod(method: string): RpcMethodClassification {
  const entry = RPC_METHOD_MATRIX[method];
  if (entry) return entry.classification;
  if (method.startsWith("wallet_") || method.startsWith("personal_")) return "write_blocked";
  return "unsupported";
}

/** A method usable by read-only analyzers (read_only or experimental_read_only). */
export function isReadOnlyMethod(method: string): boolean {
  const c = classifyRpcMethod(method);
  return c === "read_only" || c === "experimental_read_only";
}

export function isWriteBlockedMethod(method: string): boolean {
  return classifyRpcMethod(method) === "write_blocked";
}

/**
 * Fail-closed gate for hosted/read-only mode. Returns for read_only and
 * experimental_read_only methods; THROWS for write_blocked, unsupported,
 * to_verify, and any unknown method. This must run BEFORE any network I/O.
 */
export function assertHostedReadOnlyMethod(method: string): void {
  const c = classifyRpcMethod(method);
  if (c === "read_only" || c === "experimental_read_only") return;
  throw new RpcMethodBlockedError(method, c);
}

export const READ_ONLY_METHODS: string[] = ENTRIES.filter((e) => e.classification === "read_only").map((e) => e.method);
export const EXPERIMENTAL_READ_ONLY_METHODS: string[] = ENTRIES.filter((e) => e.classification === "experimental_read_only").map((e) => e.method);
export const WRITE_BLOCKED_METHODS: string[] = ENTRIES.filter((e) => e.classification === "write_blocked").map((e) => e.method);
export const UNSUPPORTED_METHODS: string[] = ENTRIES.filter((e) => e.classification === "unsupported").map((e) => e.method);

export interface RpcMethodMatrixSummary {
  readOnly: number;
  experimentalReadOnly: number;
  writeBlocked: number;
  unsupported: number;
  toVerify: number;
  total: number;
}

export function rpcMethodMatrixSummary(): RpcMethodMatrixSummary {
  const vals = Object.values(RPC_METHOD_MATRIX);
  const count = (c: RpcMethodClassification) => vals.filter((e) => e.classification === c).length;
  return {
    readOnly: count("read_only"),
    experimentalReadOnly: count("experimental_read_only"),
    writeBlocked: count("write_blocked"),
    unsupported: count("unsupported"),
    toVerify: count("to_verify"),
    total: vals.length,
  };
}
