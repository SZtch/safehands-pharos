> [!NOTE]
> Pharos Pacific Mainnet (chain `1672`) is the default and live network. Any Atlantic Testnet (`688689`) references below are legacy/secondary context.

# SafeHands Phase 2 — Pharos Official Alignment

> Summary-only alignment with official Pharos documentation. This file **does not
> copy** official documentation text — it maps each official topic to how
> SafeHands uses it and labels the current status. Source links are in
> `REFERENCES.md`.
>
> Legend — **Live** · **Supported** (config) · **Experimental** · **Roadmap**

---

## 1. Networks

**SafeHands Phase 2 is mainnet-first for Pharos Pacific.** Pacific Mainnet is the
**primary** network for read-only SafeHands checks; Atlantic Testnet is used **only**
for demo, compatibility, contract testing, and x402 testing.

| Network | Chain ID | Native | Default RPC | Explorer | Role | SafeHands-support status |
|---------|----------|--------|-------------|----------|------|--------------------------|
| **Pharos Pacific (Ocean) Mainnet** | **1672** | **PROS** | `https://rpc.pharos.xyz` | PharosScan | **PRIMARY** — read-only checks | facts **VERIFIED**; read-only SafeHands support **P1 target — mainnet-first**; execution **advanced self-hosted / disabled by default** |
| **Pharos Atlantic Testnet** | **688689** | PROS | `https://atlantic.dplabs-internal.com` | `atlantic.pharosscan.xyz` | demo / compat / contract + x402 testing | **Live / Supported** |

**Boundary:** on mainnet the SafeHands computes decisions from read-only JSON-RPC —
mainnet **read / check / analyze is required** for Phase 2. It does **not** execute,
sign, or custody. Any write/payment on mainnet is gated by the four default-`false`
flags and is an **advanced self-hosted / Roadmap** mode, not a current claim.

> **SafeHands Phase 2 is mainnet-first for Pharos Pacific read-only SafeHands checks.
> Execution, signing, managed wallets, and on-chain publishing are advanced
> self-hosted modes and remain disabled by default.**

---

## 2. JSON-RPC API methods

Pharos is EVM-equivalent, so SafeHands speaks standard JSON-RPC against the active
network's RPC. Method → SafeHands use → status:

| Method | SafeHands use | Status |
|--------|--------------|--------|
| `eth_chainId` | Network guard / mismatch detection | **Live** |
| `eth_blockNumber` | Chain liveness / data freshness | **Live** |
| `eth_getCode` | Contract-vs-EOA, contract intelligence | **Live** |
| `eth_call` | Dry-run / revert reason / decode | **Live** |
| `eth_estimateGas` | Gas preflight & sufficiency | **Live** |
| `eth_getTransactionReceipt` | Existing-tx analysis (status/logs/gas) | **Live** |
| `eth_getProof` | SPV / proof evidence | **Roadmap** (do not claim) |

These methods are **Live capabilities** of the engine (exercised on testnet today).
The calls are network-agnostic; **defaulting them to Pacific Mainnet (`rpc.pharos.xyz`,
1672) is the P1 mainnet-first target** — pointing the client at 1672 or a configured
provider is sufficient.

---

## 3. Token Registry & Canonical Contracts

- **Token Registry:** the SafeHands classifies tokens as canonical / custom /
  unknown per the active network's registry. The current registry (`constants.ts`)
  is **testnet-only**; a **mainnet token list aligned to the official Pharos Token
  Registry** is **Roadmap** for Pacific Mainnet. *(Status: testnet **Live**,
  mainnet **Roadmap**.)*
- **Canonical Contracts** — recognized as *analysis targets* (decode/identify only,
  no execution):

| Contract | SafeHands use | Status |
|----------|--------------|--------|
| Safe / MultiSend | Decode Safe tx & MultiSend batches for treasury review | **Experimental** (read-only decode in `analysis/safeTx.ts`, marked `experimental`) |
| Permit2 | Detect Permit2 approvals (incl. unlimited) | **Experimental** (recognized by canonical address in `analysis/approval.ts`) |
| MultiCall3 | Decode batched calls in `to+calldata` analysis | **Experimental** (recognized by canonical address) |
| ERC-4337 EntryPoint | Recognize userOp/account-abstraction flows | **Experimental** (recognized by canonical address; deep userOp decode = Roadmap) |

Addresses must come from official Pharos canonical-contract docs at integration
time; none are hardcoded for mainnet in Phase 0.

---

## 4. Gas model

The SafeHands performs **read-only gas preflight** (`eth_estimateGas` + gas price)
to flag insufficient funds and abnormal cost before an action. It aligns with the
Pharos gas model by reading live values rather than assuming fixed costs. *(Status:
**Live**, read-only.)*

---

## 5. x402

x402 is chain-agnostic and supported on Pharos for ERC-20 payments. SafeHands:

| Capability | Status |
|------------|--------|
| x402 **preflight** — URL SSRF guard, amount limit, token allowlist, challenge parse | **Live** |
| x402 paid advanced checks (testnet, self-hosted facilitator) | **Supported** (config) |
| x402 **mainnet payment** with production asset/facilitator | **Roadmap** (not claimed) |

The SafeHands's value is validating a 402 challenge **before** any signature — it
does not require holding payment keys to do preflight.

---

## 6. RPC infrastructure

| Provider | SafeHands use | Status |
|----------|--------------|--------|
| Default Pharos RPC (`rpc.pharos.xyz` mainnet / Atlantic testnet RPC) | Primary read-only endpoint | **Live** |
| ZAN RPC | Optional provider via env | **Supported** |
| Alchemy RPC | Optional provider via env | **Supported** |
| Nirvana RPC | Optional provider via env | **Supported** |

Multiple comma-separated endpoints already fail over in `pharosClient.ts`
(`PHAROS_RPC_URLS`). **Premium/keyed URLs are read from env only and are never
hardcoded or committed.**

---

## 7. Explorers

| Explorer | SafeHands use | Status |
|----------|--------------|--------|
| PharosScan (testnet `atlantic.pharosscan.xyz`) | Address/tx deep links | **Live** (testnet) |
| PharosScan (mainnet `www.pharosscan.xyz`) | Address/tx deep links for 1672 | **VERIFIED** host; link building is **P1** (mainnet-first) |
| SocialScan (Pharos, `pharos.socialscan.io`) | Alternate explorer links | **VERIFIED** public explorer |

Explorer base URLs are configuration, resolved per network from the registry.

---

## 8. SPV / proof evidence

`eth_getProof`-based SPV / proof evidence is **Roadmap**. SafeHands must **not**
claim SPV verification until it is implemented and tested.

---

## 9. Status summary by topic

| Official topic | Status |
|----------------|--------|
| Pacific Mainnet 1672 / PROS — network facts/config | **VERIFIED** |
| Pacific Mainnet 1672 / PROS — read-only SafeHands checks | **P1 target — mainnet-first** |
| Pacific Mainnet — execution / signing / managed wallet / publish | **Advanced self-hosted / disabled by default / Roadmap** |
| Atlantic Testnet 688689 (demo / compat / contract + x402 testing) | **Live / Supported** |
| JSON-RPC read methods (chainId/blockNumber/getCode/call/estimateGas/receipt) — capability | **Live** (default mainnet wiring = P1) |
| `eth_getProof` / SPV | **Roadmap** |
| Token Registry (testnet) | **Live** |
| Token Registry (mainnet) | **Roadmap** |
| Canonical contracts: Safe/MultiSend, Permit2, MultiCall3 | **Experimental** (read-only recognition/decode in `src/lib/analysis/`) |
| Canonical contracts: ERC-4337 EntryPoint | **Experimental** (address recognition; deep userOp decode = Roadmap) |
| Gas model preflight | **Live** |
| x402 preflight | **Live** |
| x402 mainnet payment | **Roadmap** |
| RPC infra: default / ZAN / Alchemy / Nirvana | **Live / Supported** |
| Explorers: PharosScan / SocialScan-Hemera | **Live (testnet) / Supported** |

*Cross-references:* `PHAROS_ECOSYSTEM_ALIGNMENT.md` · `REFERENCES.md`

