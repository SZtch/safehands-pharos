> [!NOTE]
> Pharos Pacific Mainnet (chain `1672`) is the default and live network. Any Atlantic Testnet (`688689`) references below are legacy/secondary context.

# Pharos Ecosystem — SafeHands Awareness Registry (Phase 5D)

> **Awareness, not integration.** SafeHands is *ecosystem-aware*: it recognizes Pharos
> ecosystem providers and uses that recognition as **evidence** to explain risk. It
> does **not** integrate with, call, hold keys for, or settle through any provider
> below. `implemented` is used **only** where SafeHands has code **and** tests; anything
> SafeHands merely recognizes is `roadmap` / `experimental` / `to_verify`.
>
> Source of truth: official Pharos docs (Phase 5A, re-verified live 2026-06-27) and
> the registry in `src/lib/pharos/ecosystem.ts`. **No contract address is invented** —
> only official addresses from the audit are listed.
>
> Status legend: **implemented** · **experimental** · **roadmap** · **to_verify** ·
> **not_implemented**.

---

## 1. Hard boundary (applies to every entry)

- SafeHands is **ecosystem-aware, not directly integrated**.
- Ecosystem evidence is **additive and escalate-only**. It may *raise* a decision
  (cross-chain / WASM-interop → `REQUIRE_CONFIRMATION`) but it can **never** relax one,
  bypass policy, or make a risky action safe. An unlimited approval to an unknown
  spender stays **BLOCK** regardless of any ecosystem hint.
- SafeHands **does not custody keys**, never creates/imports/exports/manages private
  keys, and does **not sign or send** in hosted/read-only mode.
- SafeHands does **not** call any external ecosystem API by default and requires **no**
  Chainlink / Goldsky / LayerZero / CCTP / LI.FI / Jumper API keys.

---

## 2. Registry

| Provider | Category | Status | Source | SafeHands behavior |
|----------|----------|--------|--------|--------------------|
| Chainlink Price Feeds (CRE) | oracle | roadmap | official_docs | Recognize the Pharos-native price-feed cache by official address — **evidence only**. No Chainlink call; no oracle analyzer. |
| Chainlink CCIP | cross_chain | roadmap | official_docs | Bridge-like → `REQUIRE_CONFIRMATION` unless trusted. No CCIP call. |
| Circle CCTP | cross_chain | roadmap | official_docs | Bridge-like → `REQUIRE_CONFIRMATION` unless trusted. No CCTP call. |
| LayerZero | cross_chain | roadmap | official_docs | Bridge-like → `REQUIRE_CONFIRMATION` unless trusted. No LayerZero call. |
| **LI.FI** | cross_chain | **to_verify** | **to_verify** | **Not named** on the official Pharos cross-chain page (Phase 5A). Treated as a generic cross-chain intent → `REQUIRE_CONFIRMATION`. **No integration.** |
| **Jumper** | cross_chain | **to_verify** | **to_verify** | **Not named** officially. Generic cross-chain intent → `REQUIRE_CONFIRMATION`. **No integration.** |
| Goldsky | indexing | roadmap | official_docs | Optional future read-only data source (Subgraphs/Mirror). **No live indexing; no API key.** |
| Safe (Safe MultiSig) | wallet_infrastructure | experimental | official_docs | Recognize canonical Safe/SafeL2 (Phase 5B) + decode Safe/MultiSend (experimental). **Holds no keys, never co-signs, never custodies.** |
| Fordefi | custody_infrastructure | roadmap | official_docs | External MPC-custody **awareness only**. SafeHands holds no keys. |
| Dora VM (EVM ↔ WASM interop) | evm_wasm_interop | experimental | official_docs | EVM analysis is implemented; EVM↔WASM interop is experimental (testnet examples; mainnet TO_VERIFY). WASM-interop intent → `REQUIRE_CONFIRMATION`. **No WASM analyzer.** |
| x402 payments | payment | implemented | official_docs | Route to the existing x402 preflight analyzer. Testnet-only; mainnet payment **not** supported. **Never signs/settles.** |
| ZAN RPC | rpc_provider | implemented | official_docs | Optional read-only RPC provider (Phase 5C). Env-only; URL/key never exposed (redacted name only). |
| Public Pharos RPC | rpc_provider | implemented | official_docs | Default hosted read-only RPC; read methods only (Phase 5C whitelist). No keys. |

### Official addresses (from the Phase 5A audit — none invented)

| Provider | Network | chainId | Address |
|----------|---------|---------|---------|
| Chainlink price-feed cache | pacific-mainnet | 1672 | `0xc71f7d98d3d9a000Fdfe307fBdb9d94AbD56424B` |
| Chainlink price-feed cache | atlantic-testnet | 688689 | `0x5456fD07A1622d33969f833d52aA5AD2c68C3Fa2` |

No other ecosystem provider has an official address in the audit, so none is listed.

---

## 3. What is NOT claimed

- ❌ No live Chainlink oracle integration (price-feed recognition is evidence only).
- ❌ No live cross-chain integration (CCIP/CCTP/LayerZero are awareness/roadmap).
- ❌ LI.FI / Jumper are **TO_VERIFY** — not listed as Pharos/SafeHands integrations.
- ❌ No live Goldsky indexing (no API key, no live queries).
- ❌ No custody/key management (Safe/Fordefi are external awareness).
- ❌ No WASM analyzer (EVM↔WASM interop is experimental/roadmap).
- ❌ No x402 mainnet payment; SafeHands never signs or settles.

See [`PHAROS_ECOSYSTEM_EVIDENCE.md`](./PHAROS_ECOSYSTEM_EVIDENCE.md) for how this
registry becomes per-request evidence, and
[`PHAROS_IMPLEMENTED_VS_ROADMAP.md`](./reports/PHAROS_IMPLEMENTED_VS_ROADMAP.md) for the
implemented/experimental/roadmap split.

