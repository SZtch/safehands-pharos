# SafeHands Pharos JSON-RPC: Read-Only Access, Method Matrix & Optional Providers

> How SafeHands talks to Pharos JSON-RPC. **SafeHands uses Pharos read-only RPC
> methods for SafeHands checks. Hosted mode blocks write RPC methods.
> `eth_sendRawTransaction` is not used by default.** Read-only by construction; no
> signer, wallet, or private key exists in this path.
>
> Source of truth in code: **`src/lib/pharos/rpcMethods.ts`** (`RPC_METHOD_MATRIX`).
> Grounded in the official Pharos JSON-RPC docs
> (`docs.pharos.xyz/api-and-sdk/json-rpc-methods`).
> Status legend: **IMPLEMENTED** · **EXPERIMENTAL** · **ROADMAP** · **TO_VERIFY** ·
> **NOT_IMPLEMENTED**.
>
> *(This document consolidates the former `PHAROS_RPC_READ_ONLY.md`,
> `PHAROS_RPC_METHOD_MATRIX.md`, and `PHAROS_ZAN_RPC_OPTIONAL.md`.)*

---

## 1. The single whitelist chokepoint

Every live read in the SafeHands path passes one fail-closed gate before any network
I/O:

- **`src/lib/pharos/rpcMethods.ts`**: the method matrix (single source of truth) and
  `assertHostedReadOnlyMethod(method)`. Read methods pass; **write / signing / account /
  unknown methods throw** (`RpcMethodBlockedError`).
- **`src/lib/pharos/rpc.ts`**: `PharosReadOnlyRpc`. `request()` / `tryRequest()` /
  `guarded()` all call the gate **first**, so a blocked method never reaches the
  transport. The transport is injectable (tests) and defaults to a fetch JSON-RPC POST
  whose URL is resolved from env only.
- **`src/api/server.ts`** `buildReadOnlyAccess()`: the live HTTP read access
  (`eth_getCode` / `eth_estimateGas` / `eth_gasPrice` / `eth_getTransactionReceipt`) is
  wrapped in `rpc.guarded(...)`, so every live read passes the whitelist at runtime.

**Status: IMPLEMENTED** (offline tests prove the gate blocks writes without calling the
transport).

## 2. Method matrix

**Classifications:** `read_only` (allowed) · `experimental_read_only` (allowed,
best-effort/graceful fallback) · `write_blocked` (BLOCKED in hosted mode) ·
`unsupported` (not on Pharos / never auto-called) · `to_verify` (unconfirmed;
blocked by default). Unknown methods fail closed (blocked).

### Read-only (allowed in hosted mode): IMPLEMENTED

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
| `eth_getAccount` | Account details (balance/nonce); officially supported. |
| `eth_syncing` / `net_version` / `web3_clientVersion` | Node/network metadata. |

### Experimental read-only: EXPERIMENTAL

| Method | Status | Notes |
|--------|--------|-------|
| `eth_getProof` | experimental | EIP-1186 account/storage Merkle proof; officially supported by Pharos. See §3. |
| `debug_traceTransaction` | experimental | Heavy execution trace; best-effort only. |
| `trace_filter` | experimental | Filtered traces (≤500 blocks); best-effort only. |

### Write: BLOCKED in hosted read-only mode

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

### Unsupported on Pharos: NOT_IMPLEMENTED (never auto-called)

| Method | Notes |
|--------|-------|
| `eth_accounts` | Returns `[]` (node manages no accounts); not relied upon. |
| `eth_coinbase` / `eth_mining` / `eth_hashrate` | Deprecated PoW-era; not used. |
| *(any unknown method)* | Fails closed; never auto-called. |

Each matrix entry carries `method`, `classification`, `officialDocsUrl`,
`safehandsStatus`, `riskRelevance`, and `hostedModeBehavior`. Summary counts are
surfaced in `rpcEvidence.methods`.

## 3. eth_getProof / SPV: inclusion verification is live

`eth_getProof` (EIP-1186 account/storage Merkle proof) is **officially supported** by
Pharos and classified read-only (experimental at the RPC-availability level: not every
endpoint serves it, and SafeHands degrades gracefully with `NOT_SUPPORTED` when absent).

**Verification shipped.** SafeHands now verifies proofs rather than merely exposing
availability:

- `src/lib/pharos/spvVerifier.ts` verifies `eth_getProof` account/storage proofs and
  rejects fake-slot redirection (behavioral coverage in `test/spv-verifier.test.ts`);
- `src/lib/riskInclusion.ts` + the keyless `verify_risk_inclusion` tool perform
  trustless Merkle-inclusion verification of risk records against the on-chain
  `SafeHandsRegistry` root (`test/risk-inclusion.test.ts`);
- the hosted engine exposes raw proofs via `get_spv_proof` (never fabricates one when
  the endpoint lacks the method).

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

- `rpcEvidence`: provider (redacted), method-matrix counts, `writeBlocked` list,
  `eth_getProof`/fee capabilities, `readOnly`, `executionAvailable`, `network`/`chainId`.
- `gasEvidence`: the gas/fee capability descriptor above.
- `pharosEvidence`: alias of `rpcEvidence`.

Surfaced on `GET /infra/status`, `GET /public-config`, `POST /guardian/check`,
`POST /analyze/{tx,contract,approval,safe,x402}`, and (inside `evidence`)
`POST /agent/check` + `POST /agent/a2a/check`. **Evidence is metadata: it never
relaxes a SafeHands decision** (a known method/provider does not make a risky action
safe).

## 6. Optional premium providers (ZAN / Alchemy / Nirvana): env-only

**ZAN RPC is optional and never required.** The hosted default uses the public Pharos
RPC. If ZAN (or another provider) env vars are set, SafeHands uses them for read-only
calls, but **secrets are never exposed through public config**. SafeHands holds no
keys and never hardcodes a premium/keyed URL.

ZAN supports Pharos mainnet + testnet. Official URL format (API key required):

```
https://api.zan.top/node/v1/pharos/{mainnet|testnet}/{apikey}
```

RPC URL resolution precedence (mainnet) in `src/lib/networks.ts` `resolveRpcUrl`:

1. `PHAROS_MAINNET_RPC_URL`
2. `ZAN_PHAROS_MAINNET_RPC_URL` or `PHAROS_ZAN_RPC_URL` *(alias)*
3. `ALCHEMY_PHAROS_MAINNET_RPC_URL`
4. `NIRVANA_PHAROS_MAINNET_RPC_URL`
5. the public, key-free default RPC (`https://rpc.pharos.xyz`)

(Atlantic: `PHAROS_ATLANTIC_RPC_URL` → public default.) An optional
`PHAROS_RPC_PROVIDER` label may name a custom provider for evidence purposes only.
Multiple comma-separated endpoints fail over in `pharosClient.ts` (`PHAROS_RPC_URLS`).

### Secrets are never exposed: IMPLEMENTED

Public/status responses include only a **redacted** provider descriptor
(`resolveRpcProvider` → `rpcEvidence.provider`):

```
provider: { name: "zan" | "alchemy" | "nirvana" | "custom" | "pharos-public",
            configuredViaEnv: boolean, usingPublicDefault: boolean, secretsRedacted: true }
```

- The **URL and API key are never included** in any payload.
- `GET /public-config` still emits only the hardcoded **public** default RPC
  (`network.defaultRpcUrl`), never `resolveRpcUrl()`/env values.
- Offline tests plant a fake premium RPC URL **and** a fake ZAN URL and assert neither
  appears in `/public-config`, `/infra/status`, `/guardian/check`, or agent payloads.

### Defaults & live checks

- **Hosted default:** public Pharos RPC; ZAN is not required.
- **Live read-only checks** are off by default. Enable with
  `SAFEHANDS_LIVE_MAINNET_CHECK=true` plus a dedicated
  `SAFEHANDS_LIVE_MAINNET_RPC_URL` (kept separate from planted test env). The optional
  live check asserts `eth_chainId === 1672` via the read-only adapter.

### Hard rules

Do not hardcode premium RPC keys. Do not expose env secrets. ZAN/Alchemy/Nirvana are
optional read-only providers; they add **no** execution, signing, wallet, or key
capability. The read-only method whitelist applies regardless of provider.

## 7. Read-only boundary

`readOnly: true` and `executionAvailable: false` are preserved by default in hosted
mode. There is no `eth_sendRawTransaction` path, no signer, no wallet, and no key
handling in `src/lib/pharos/*` or `src/api/*` (offline source-scan test enforces
this). The opt-in write/broadcast paths live elsewhere, behind the default-`false`
gate stack, and are never reachable from the hosted read-only surface.
