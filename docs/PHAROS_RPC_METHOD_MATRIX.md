# SafeHands — Pharos JSON-RPC Method Matrix (Phase 5C)

> The classification SafeHands applies to every JSON-RPC method. Source of truth in
> code: **`src/lib/pharos/rpcMethods.ts`** (`RPC_METHOD_MATRIX`). Grounded in the
> official Pharos JSON-RPC docs (`docs.pharos.xyz/api-and-sdk/json-rpc-methods`,
> verified 2026-06-27).
>
> **Classifications:** `read_only` (allowed) · `experimental_read_only` (allowed,
> best-effort/graceful fallback) · `write_blocked` (BLOCKED in hosted mode) ·
> `unsupported` (not on Pharos / never auto-called) · `to_verify` (unconfirmed —
> blocked by default). Unknown methods fail closed (blocked).

---

## Read-only (allowed in hosted mode) — IMPLEMENTED

| Method | Risk relevance |
|--------|----------------|
| `eth_chainId` | Confirms the active chain (Pacific = 1672). |
| `eth_blockNumber` | Chain head / read freshness. |
| `eth_gasPrice` | Legacy gas price for fee estimation. |
| `eth_maxPriorityFeePerGas` | EIP-1559 priority fee. |
| `eth_feeHistory` | Historical base/priority fees. |
| `eth_call` | Simulated read-only call; no state change. |
| `eth_estimateGas` | Gas estimate; a failing estimate often signals a revert. |
| `eth_getCode` | Contract vs EOA. |
| `eth_getBalance` | Affordability checks. |
| `eth_getStorageAt` | Raw storage read. |
| `eth_getTransactionCount` | Account nonce. |
| `eth_getTransactionByHash` | Transaction lookup. |
| `eth_getTransactionReceipt` | Receipt / status. |
| `eth_getBlockByHash` / `eth_getBlockByNumber` | Block lookup. |
| `eth_getBlockReceipts` | All receipts in a block. |
| `eth_getLogs` | Event logs (≤100 blocks when rate-limited). |
| `eth_getAccount` | Account details (balance/nonce) — officially supported. |
| `eth_syncing` / `net_version` / `web3_clientVersion` | Node/network metadata. |

## Experimental read-only — EXPERIMENTAL

| Method | Status | Notes |
|--------|--------|-------|
| `eth_getProof` | experimental | EIP-1186 proof; availability exposed as evidence, **SPV verification NOT implemented**. |
| `debug_traceTransaction` | experimental | Heavy execution trace; best-effort only. |
| `trace_filter` | experimental | Filtered traces (≤500 blocks); best-effort only. |

## Write — BLOCKED in hosted read-only mode

| Method | Why blocked |
|--------|-------------|
| `eth_sendRawTransaction` | The only documented state-changing method; **never used by default**. |
| `eth_sendTransaction` | Node-signed send; blocked. |
| `eth_signTransaction` | Transaction signing; blocked. |
| `eth_sign` | Arbitrary-data signing; blocked (also undocumented on Pharos). |
| `personal_sign` | Wallet message signing; blocked (no keys held). |
| `eth_signTypedData` / `eth_signTypedData_v4` | EIP-712 signing; blocked. |
| `personal_unlockAccount` | Unlock node account; blocked. |
| `personal_newAccount` / `personal_importRawKey` | Account creation / key import; blocked. |
| `wallet_addEthereumChain` / `wallet_switchEthereumChain` / `wallet_watchAsset` / `wallet_requestPermissions` | Wallet management; blocked. Unknown `wallet_*` / `personal_*` are blocked by default. |

## Unsupported on Pharos — NOT_IMPLEMENTED (never auto-called)

| Method | Notes |
|--------|-------|
| `eth_accounts` | Returns `[]` (node manages no accounts); not relied upon. |
| `eth_coinbase` / `eth_mining` / `eth_hashrate` | Deprecated PoW-era; not used. |
| *(any unknown method)* | Fails closed — never auto-called. |

---

Each matrix entry carries `method`, `classification`, `officialDocsUrl`,
`safehandsStatus`, `riskRelevance`, and `hostedModeBehavior`. Summary counts are
surfaced in `rpcEvidence.methods`. See [`PHAROS_RPC_READ_ONLY.md`](./PHAROS_RPC_READ_ONLY.md)
for how the matrix is enforced and surfaced.

