# SafeHands — Pharos Read-Only RPC (Phase 5C)

> How SafeHands talks to Pharos JSON-RPC. **SafeHands uses Pharos read-only RPC
> methods for SafeHands checks. Hosted mode blocks write RPC methods.
> `eth_sendRawTransaction` is not used by default.** Read-only by construction; no
> signer, wallet, or private key exists in this path.
>
> Status legend: **IMPLEMENTED** · **EXPERIMENTAL** · **ROADMAP** · **TO_VERIFY** ·
> **NOT_IMPLEMENTED**. Source of truth: official Pharos JSON-RPC docs
> (`docs.pharos.xyz/api-and-sdk/json-rpc-methods`, re-verified live 2026-06-27).

---

## 1. The single whitelist chokepoint

Every live read in the SafeHands path passes one fail-closed gate before any network
I/O:

- **`src/lib/pharos/rpcMethods.ts`** — the method matrix (single source of truth) and
  `assertHostedReadOnlyMethod(method)`. Read methods pass; **write / signing / account /
  unknown methods throw** (`RpcMethodBlockedError`).
- **`src/lib/pharos/rpc.ts`** — `PharosReadOnlyRpc`. `request()` / `tryRequest()` /
  `guarded()` all call the gate **first**, so a blocked method never reaches the
  transport. The transport is injectable (tests) and defaults to a fetch JSON-RPC POST
  whose URL is resolved from env only.
- **`src/api/server.ts`** `buildReadOnlyAccess()` — the live HTTP read access
  (`eth_getCode` / `eth_estimateGas` / `eth_gasPrice` / `eth_getTransactionReceipt`) is
  wrapped in `rpc.guarded(...)`, so every live read passes the whitelist at runtime.

**Status: IMPLEMENTED** (offline tests prove the gate blocks writes without calling the
transport; see `scripts/smoke-test.mjs` Phase 5C).

## 2. What is allowed vs blocked

- **Read-only (allowed):** `eth_chainId`, `eth_blockNumber`, `eth_call`,
  `eth_estimateGas`, `eth_getCode`, `eth_getBalance`, `eth_gasPrice`,
  `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_getTransactionByHash`,
  `eth_getTransactionReceipt`, `eth_getLogs`, `eth_getAccount`, `eth_getStorageAt`,
  `eth_getBlockByNumber`, `eth_getBlockReceipts`, … (full list in
  [`PHAROS_RPC_METHOD_MATRIX.md`](./PHAROS_RPC_METHOD_MATRIX.md)).
- **Experimental read-only:** `eth_getProof` (see §3), `debug_traceTransaction`,
  `trace_filter` — attempted best-effort, with graceful fallback.
- **Write — BLOCKED in hosted mode:** `eth_sendRawTransaction` (the only documented
  write method), `eth_sendTransaction`, `eth_sign`, `personal_sign`,
  `eth_signTransaction`, `eth_signTypedData*`, `wallet_*`, and account
  create/import/unlock. **Never called.**
- **Unsupported / never auto-called:** `eth_accounts` (returns `[]` on Pharos),
  deprecated PoW methods, and any unknown method (fails closed).

## 3. eth_getProof / SPV

`eth_getProof` (EIP-1186 account/storage Merkle proof) is **officially supported** by
Pharos and classified **read-only (experimental)**. SafeHands exposes its
*availability* as `rpcEvidence.capabilities.ethGetProof`:

```
{ method: "eth_getProof", status: "experimental", readOnly: true, spvVerification: "not_implemented" }
```

**SPV verification is NOT implemented** — SafeHands does not currently verify Merkle
proofs. This is **EXPERIMENTAL / ROADMAP**; it is exposed as read-only evidence only,
never as an execution capability. (Full SPV would be a future phase with code + tests.)

## 4. Fee / gas evidence

`gasEvidence` (and the gas analyzer details) surface read-only fee/gas method
capability deterministically (offline-safe):

```
{ gasBufferPct: 20, feeDataAvailable, feeHistoryAvailable, priorityFeeAvailable, estimateGasAvailable, fallbackUsed }
```

`gasBufferPct = 20` matches the official Pharos gas-model guidance. `fallbackUsed` is
true when no live estimator is supplied (the offline default). **Status: IMPLEMENTED.**

## 5. Evidence in responses

API and Agent responses carry (additively, without changing existing fields):

- `rpcEvidence` — provider (redacted), method-matrix counts, `writeBlocked` list,
  `eth_getProof`/fee capabilities, `readOnly`, `executionAvailable`, `network`/`chainId`.
- `gasEvidence` — the gas/fee capability descriptor above.
- `pharosEvidence` — alias of `rpcEvidence`.

Surfaced on `GET /infra/status`, `GET /public-config`, `POST /guardian/check`,
`POST /analyze/{tx,contract,approval,safe,x402}`, and (inside `evidence`)
`POST /agent/check` + `POST /agent/a2a/check`. **Evidence is metadata — it never
relaxes a SafeHands decision** (a known method/provider does not make a risky action
safe).

## 6. Read-only boundary

`readOnly: true` and `executionAvailable: false` are preserved by default. There is no
`eth_sendRawTransaction` path, no signer, no wallet, and no key handling in
`src/lib/pharos/*` or `src/api/*` (offline source-scan test enforces this). Premium/keyed
RPC URLs (incl. ZAN) are read from env only and **never** exposed — see
[`PHAROS_ZAN_RPC_OPTIONAL.md`](./PHAROS_ZAN_RPC_OPTIONAL.md).

