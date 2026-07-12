> [!NOTE]
> Pharos Pacific Mainnet (chain `1672`) is the default and live network. Any Atlantic Testnet (`688689`) references below are legacy/secondary context.

# SafeHands: References

> **Provenance:** this catalog was assembled during the Phase 2/5 audits and keeps that
> era's status labels (some in-repo values in §6 are testnet-era; live mainnet contract
> addresses and the canonical registry live in `src/data/ecosystemRegistry.data.ts` and
> `docs/CANONICAL_CONTRACTS.md`). Official-source links remain valid.
>
> **Phase 5A audit:** official Pharos docs were re-verified live; see the
> per-topic [`PHAROS_IMPLEMENTATION_MAP.md`](./archive/PHAROS_IMPLEMENTATION_MAP.md) (archived snapshot).
>
> Curated source links only. **No large official documentation text is copied
> here**: each entry is a link plus a one-line purpose and a verification status.
>
> **Verification legend:**
> - **VERIFIED**: confirmed during this audit (web search / official docs / repo / project owner).
> - **TO-VERIFY**: expected/likely; confirm the exact URL at integration time.
> - **TESTNET-ONLY**: an Atlantic-testnet value in the current repo; not a mainnet claim.

> **SafeHands Phase 2 is mainnet-first for Pharos Pacific read-only SafeHands checks.
> Execution, signing, managed wallets, and on-chain publishing are advanced
> self-hosted modes and remain disabled by default.** Pharos Pacific Mainnet network
> facts below (chain 1672, PROS, `rpc.pharos.xyz`) are **VERIFIED**; Atlantic Testnet
> is for demo, compatibility, contract testing, and x402 testing only.

---

## 1. Pharos official documentation

| Link | Purpose | Status |
|------|---------|--------|
| https://www.pharos.xyz/ | Project home (fastest EVM L1; RWA / cross-chain) | VERIFIED |
| https://docs.pharos.xyz/ | Developer docs home | VERIFIED |
| https://docs.pharos.xyz/api-and-sdk/json-rpc-methods | JSON-RPC API methods | VERIFIED |
| https://docs.pharos.xyz/developer-guide/x402 | x402 on Pharos | VERIFIED |
| https://docs.pharos.xyz/developer-guide/interoperability | Interoperability | VERIFIED |
| https://docs.pharos.xyz/resources/evm | EVM equivalence notes | VERIFIED |
| https://docs.pharos.xyz/tooling-and-infrastructure/rpc/zan | ZAN RPC provider | VERIFIED |
| https://docs.pharos.xyz/tooling-and-infrastructure/oracles | Oracles | VERIFIED |
| https://docs.pharosnetwork.xyz/network-overview/pharos-networks | Network overview (chains) | VERIFIED |
| https://docs.pharos.xyz/ → Canonical Contracts | Canonical contract addresses | TO-VERIFY (exact path) |
| https://docs.pharos.xyz/ → Token Registry | Token registry | TO-VERIFY (exact path) |
| https://docs.pharos.xyz/ → Gas Model | Gas model | TO-VERIFY (exact path) |
| https://docs.pharos.xyz/ → RPC infrastructure | RPC infra (default / Alchemy / Nirvana) | TO-VERIFY (exact path) |
| https://github.com/PharosNetwork/examples/tree/main/skills/x402-pharos | Official x402 skill example | VERIFIED |

---

## 2. Networks & chain metadata

| Item | Value | Status |
|------|-------|--------|
| Pharos Pacific (Ocean) Mainnet | Chain ID **1672**, native **PROS** | VERIFIED |
| Mainnet default RPC | `https://rpc.pharos.xyz` | VERIFIED |
| Chainlist (mainnet) | https://chainlist.org/chain/1672 | VERIFIED |
| Pharos Atlantic Testnet | Chain ID **688689**, native PROS | VERIFIED |
| Testnet RPC (in repo) | `https://atlantic.dplabs-internal.com` | TESTNET-ONLY |

---

## 3. Explorers

| Explorer | Link | Status |
|----------|------|--------|
| PharosScan (testnet) | https://atlantic.pharosscan.xyz/ | VERIFIED |
| PharosScan (mainnet) | https://www.pharosscan.xyz | VERIFIED |
| SocialScan (Pharos) | https://pharos.socialscan.io | VERIFIED (public explorer) |
| Explorer **verification API** endpoints (per explorer) | confirm per provider | TO-VERIFY |

---

## 4. RPC providers

| Provider | Note | Status |
|----------|------|--------|
| Default Pharos RPC | `rpc.pharos.xyz` (mainnet) / Atlantic RPC (testnet) | VERIFIED |
| ZAN RPC | https://docs.pharos.xyz/tooling-and-infrastructure/rpc/zan | VERIFIED |
| Alchemy RPC | configurable via env | TO-VERIFY |
| Nirvana RPC | configurable via env | TO-VERIFY |

> Premium/keyed RPC URLs are read from environment variables only and are **never
> hardcoded or committed**.

---

## 5. Standards & canonical components

| Standard | Reference | Status |
|----------|-----------|--------|
| x402 payments | https://docs.pharos.xyz/developer-guide/x402 (+ PharosNetwork examples) | VERIFIED |
| Safe (Smart Account) / MultiSend | https://docs.safe.global/ | TO-VERIFY (Pharos addresses) |
| Permit2 | https://github.com/Uniswap/permit2 | TO-VERIFY (Pharos deployment) |
| MultiCall3 | https://github.com/mds1/multicall | TO-VERIFY (Pharos deployment) |
| ERC-4337 EntryPoint | https://eips.ethereum.org/EIPS/eip-4337 | TO-VERIFY (Pharos deployment) |
| EAS (attestations) | https://attest.org/ | TO-VERIFY |
| Circle CCTP / USDC | https://developers.circle.com/stablecoins | TO-VERIFY (Pharos support) |

> Canonical contract **addresses** for Pharos mainnet are taken from the official
> Pharos canonical-contracts page; the bundled, cited set lives in the canonical
> ecosystem registry (`src/data/ecosystemRegistry.data.ts`) and is documented in
> [`CANONICAL_CONTRACTS.md`](./CANONICAL_CONTRACTS.md).

---

## 6. In-repo references (current testnet values)

From `src/lib/constants.ts` `docsSource` fields and existing config; all
**TESTNET-ONLY** unless noted:

| Item | Value | Status |
|------|-------|--------|
| SafeHandsRegistry (testnet) | `0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25` | TESTNET-ONLY |
| USDC (Pharos Skill Engine list) | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` | TESTNET-ONLY |
| USDC (Circle-referenced) | `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` | TESTNET-ONLY |
| USDT / WBTC / WETH / WPROS (testnet) | see `constants.ts` `TOKEN_REGISTRY` | TESTNET-ONLY |
| DODO / FaroSwap router & proxy | see `constants.ts` `DODO_*` | TESTNET-ONLY |
| Pharos token registry doc (cited in repo) | https://docs.pharos.xyz/getting-started/token-registry | TO-VERIFY |
| Hardhat guide (cited in repo) | https://docs.pharosnetwork.xyz/developer-guide/hardhat/write-your-first-nft | VERIFIED |
| Circle USDC addresses (cited in repo) | https://developers.circle.com/stablecoins/usdc-contract-addresses | TO-VERIFY |

---

## 6b. Pharos ecosystem (Phase 5D: awareness, not integration)

| Link | Purpose | Status |
|------|---------|--------|
| https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe | Chainlink price feeds (CRE); oracle awareness | VERIFIED |
| https://docs.pharos.xyz/tooling-and-infrastructure/cross-chain | Cross-chain (CCIP / CCTP / LayerZero) awareness | VERIFIED |
| https://docs.pharos.xyz/tooling-and-infrastructure/indexing/goldsky | Goldsky indexing (Subgraphs / Mirror) awareness | VERIFIED |
| https://docs.pharos.xyz/tooling-and-infrastructure/wallets | Wallets / custody (Safe MultiSig, Fordefi) awareness | VERIFIED |
| https://docs.pharos.xyz/developer-guide/interoperability/call-evm-from-wasm | EVM ↔ WASM interop (Dora VM); experimental | VERIFIED |
| LI.FI / Jumper | Cross-chain aggregators; **not named** on the official cross-chain page | TO-VERIFY |

> Ecosystem layer doc: [`PHAROS_ECOSYSTEM_EVIDENCE.md`](./PHAROS_ECOSYSTEM_EVIDENCE.md)
> (awareness registry + classifier; historical snapshot in
> [`PHAROS_IMPLEMENTED_VS_ROADMAP.md`](./archive/PHAROS_IMPLEMENTED_VS_ROADMAP.md)). SafeHands is
> **ecosystem-aware, not directly integrated**; evidence is escalate-only and never
> bypasses policy, custodies keys, or calls an external API. LI.FI/Jumper are **TO-VERIFY**.

---

## 7. How references are used

- **Alignment** decisions and labels: `archive/PHAROS_OFFICIAL_ALIGNMENT.md` (historical snapshot).
- **Ecosystem** positioning and overclaim guardrails: `archive/PHAROS_ECOSYSTEM_ALIGNMENT.md` (historical snapshot);
  the current evidence layer: `PHAROS_ECOSYSTEM_EVIDENCE.md` (historical split:
  `archive/PHAROS_IMPLEMENTED_VS_ROADMAP.md`).
- **Final integration posture** (Phase 5E: capability flags, evidence matrix, safety
  boundary, self-host readiness; the `railwayReady` capability flag): SafeHands is a real
  **mainnet-first** read/check/analyze product; write/execution is gated and a future
  phase (disabled by default); no custody, no private keys; demo scripts are reviewer/dev
  examples only.
- **Optional self-host of the reference backend** (Phase 6: read-only): `PRODUCTION_BACKEND.md`
  (build/start, env matrix, health check, Docker option, endpoint matrix + request-safety);
  the read-only curl smoke set now lives in `SAFEHANDS_REVIEWER_DEMO_SCRIPT.md`. `npm start`
  runs the compiled read-only SafeHands API on `0.0.0.0:$PORT`; no private keys, no custody, no
  signing/sending in self-host mode. This is an optional developer/reviewer reference deploy,
  not the production service; the hosted agent is being published to Anvita Flow (https://flow.anvita.xyz/home) (Agent Carnival Phase 2).
- **Observability + public activity API** (Phase 7: read-only):
  `OBSERVABILITY_AND_ACTIVITY.md` covers request IDs, ephemeral-host-safe structured logging
  (stdout only, no persistent volume), the
  sanitized in-memory activity feed (`GET /activity/summary`, `/activity/recent`), public
  metrics (`GET /metrics/public`), and the optional API-key foundation (open by default;
  paid endpoints use the x402 `/paid/*` gate; env-gated, off until `X402_PAY_TO` +
  `X402_FACILITATOR_URL` are configured). No DB, no external
  API; self-host mode stays read-only.
- Mainnet addresses and exact doc paths marked **TO-VERIFY** must be confirmed
  against official Pharos docs **before** any mainnet code path is enabled.

*Cross-references (archived snapshots):* `archive/PHAROS_OFFICIAL_ALIGNMENT.md` · `archive/PHAROS_ECOSYSTEM_ALIGNMENT.md`

