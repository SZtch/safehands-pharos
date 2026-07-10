> [!NOTE]
> Pharos Pacific Mainnet (chain `1672`) is the default and live network. Any Atlantic Testnet (`688689`) references below are legacy/secondary context.

# Pharos → SafeHands Implementation Map (Phase 5A)

> [!WARNING]
> **Historical snapshot (Phase 5A) — superseded in places.** Shipped since (code +
> tests): **SPV verification** (`src/lib/pharos/spvVerifier.ts` via `get_spv_proof`;
> §11's `not_implemented` no longer holds) and **live Chainlink Push feed reads**
> (`src/lib/price/priceResolver.ts`; §12's "no Chainlink call" no longer holds — the
> no-overclaim rule still stands for CCIP/cross-chain). Current state:
> [`docs/INDEX.md`](../INDEX.md) · [`AUDIT_REMEDIATION_2026-07.md`](./AUDIT_REMEDIATION_2026-07.md).
> The snapshot below is kept unedited for provenance.

> Maps every Pharos topic to SafeHands implementation status. Audit-only; no code
> changes in this phase. Source of truth = official Pharos docs (fetched live).
> Unconfirmed items = **TO_VERIFY**.
>
> `status` ∈ { **implemented**, **experimental**, **roadmap**, **to_verify**,
> **not_implemented** }. Ecosystem entries follow the overclaim rules: bridge-like /
> cross-chain → `REQUIRE_CONFIRMATION` unless trusted; oracle → evidence only; indexer
> → optional data source (not execution); custody → external awareness (SafeHands holds
> no keys); WASM → experimental/roadmap. SafeHands never claims a live ecosystem
> integration unless code + tests prove it.

---

## 1. Pacific Mainnet
- **officialDocsUrl:** `docs.pharos.xyz/getting-started/network/pacific-mainnet`, `chainlist.org/chain/1672`
- **officialFactSummary:** chainId 1672 (0x688); native PROS; RPC `https://rpc.pharos.xyz`; explorer `https://www.pharosscan.xyz`.
- **currentSafeHandsStatus:** Registered as the **default** network; exact values in `networks.ts`; `executionAllowed:false`.
- **status:** implemented
- **riskRelevance:** Primary network for read-only SafeHands checks; wrong chain config would misroute every check.
- **recommendedSafeHandsBehavior:** Keep mainnet-first read-only; never enable execution by default.
- **implementationFiles:** `src/lib/networks.ts`, `src/lib/config.ts`
- **testFiles:** `scripts/smoke-test.mjs` (network registry / chainId / native-token tests)
- **overclaimRisk:** Do not imply mainnet **execution** is live (it is gated/disabled).

## 2. Atlantic Testnet
- **officialDocsUrl:** `docs.pharos.xyz/getting-started/network/atlantic-testnet`
- **officialFactSummary:** chainId 688689; RPC `https://atlantic.dplabs-internal.com`; WSS `wss://atlantic.dplabs-internal.com`; explorer `https://atlantic.pharosscan.xyz`; rate-limit 500/5m. Native symbol not stated on page.
- **currentSafeHandsStatus:** Registered (native token PROS); used for demo/compat/contract + x402 testing.
- **status:** implemented (native symbol **to_verify** vs official page)
- **riskRelevance:** Testing/compat surface; x402 lives here.
- **recommendedSafeHandsBehavior:** Keep as secondary/testing network; confirm PROS symbol against official source.
- **implementationFiles:** `src/lib/networks.ts`
- **testFiles:** `scripts/smoke-test.mjs`
- **overclaimRisk:** Don't present testnet results as mainnet guarantees.

## 3. JSON-RPC read-only methods
- **officialDocsUrl:** `docs.pharos.xyz/api-and-sdk/json-rpc-methods`
- **officialFactSummary:** Full Ethereum read set: `eth_call/getCode/getBalance/getStorageAt/estimateGas/gasPrice/maxPriorityFeePerGas/feeHistory/getTransactionReceipt/getLogs(≤100blk)/getProof/getAccount/getBlockReceipts`, plus `debug_traceTransaction`, `trace_filter`. `eth_accounts` unsupported.
- **currentSafeHandsStatus:** **Phase 5C** adds a typed method matrix
  (`src/lib/pharos/rpcMethods.ts`) + a guarded read-only adapter (`rpc.ts`). Every live
  read passes a single fail-closed whitelist chokepoint (`assertHostedReadOnlyMethod` →
  `rpc.guarded` in `server.ts`); write/signing/account/unknown methods throw. `eth_getProof`/
  `eth_getAccount`/`eth_feeHistory` classified; `rpcEvidence`/`gasEvidence` surfaced in API + Agent.
- **status:** implemented (reads + whitelist gate) — **Phase 5C**
- **riskRelevance:** All analyzer evidence comes from reads; the gate guarantees no write method is ever called in hosted mode.
- **recommendedSafeHandsBehavior:** Keep the matrix as the single source of truth; keep the gate fail-closed; never add a write method to the read path.
- **implementationFiles:** `src/lib/pharos/{rpcMethods,rpc,rpcEvidence}.ts`, `src/api/server.ts` (`buildReadOnlyAccess` → `rpc.guarded`), `src/api/{routes,response}.ts`, `src/lib/analysis/*`
- **testFiles:** `scripts/smoke-test.mjs` (Phase 5C: whitelist/denylist, gate throws, adapter spy, evidence, no-secrets)
- **overclaimRisk:** None — reads only; SPV verification is not claimed (see §11).

## 4. eth_sendRawTransaction disabled in read-only mode
- **officialDocsUrl:** `docs.pharos.xyz/api-and-sdk/json-rpc-methods`
- **officialFactSummary:** `eth_sendRawTransaction` is the documented write method (legacy/EIP-2930/EIP-1559).
- **currentSafeHandsStatus:** Absent from the SafeHands read path (`analysis/api/agent/pharos`). **Phase 5C** makes it explicit: `eth_sendRawTransaction` (and all signing/wallet/account methods) are `write_blocked` in the method matrix and throw via the fail-closed gate `assertHostedReadOnlyMethod`. Write RPC exists only in gated Phase-1 tools behind default-false gates.
- **status:** implemented (disabled by default; matrix-gate enforced — Phase 5C)
- **riskRelevance:** The core read-only guarantee.
- **recommendedSafeHandsBehavior:** Never call `sendRawTransaction` from analyzers/API/agent; keep gates default-false.
- **implementationFiles:** `src/lib/config.ts` (gates), `src/lib/toolResponse.ts` (`requireWriteToolsEnabled`)
- **testFiles:** `scripts/smoke-test.mjs` ("mainnet execution still disabled", "executionAvailable false")
- **overclaimRisk:** Don't claim execution is impossible in *self-hosted* mode — it is gated, not removed.

## 5. Gas model
- **officialDocsUrl:** `docs.pharos.xyz/getting-started/gas-model`
- **officialFactSummary:** EIP-1559 (base+priority); base fee dynamic per epoch; **recommends a 20% buffer**; charged by `gas_limit` at inclusion; refund tracked but doesn't reduce charge.
- **currentSafeHandsStatus:** `recommendGasWithBuffer` with `DEFAULT_GAS_BUFFER_PCT = 20` — exact match to official guidance.
- **status:** implemented (aligned exactly)
- **riskRelevance:** Under-buffered gas → failed txs; SafeHands recommends the official buffer.
- **recommendedSafeHandsBehavior:** Keep 20% default; optionally surface base/priority via `feeHistory` (5C).
- **implementationFiles:** `src/lib/analysis/gas.ts`, `src/tools/estimateGas.ts`, `src/tools/simulateTransaction.ts`
- **testFiles:** `scripts/smoke-test.mjs` (gas buffer 21000→25200 test)
- **overclaimRisk:** None.

## 6. x402
- **officialDocsUrl:** `docs.pharos.xyz/developer-guide/x402`
- **officialFactSummary:** Documented on Atlantic Testnet (688689); mainnet not mentioned; ERC-20 incl. test USDC `0xE0BE…4ec8` (unofficial); facilitator service, no fixed hosted URL.
- **currentSafeHandsStatus:** `analyzeX402` preflight (URL SSRF + amount + token); testnet-only; `mainnetPaymentSupported:false`; same USDC addr.
- **status:** implemented (preflight) / aligned
- **riskRelevance:** Payment-before-fetch safety for agents.
- **recommendedSafeHandsBehavior:** Keep preflight-only; mainnet payment stays roadmap; never sign/settle.
- **implementationFiles:** `src/lib/analysis/x402.ts`, `src/tools/safehandsX402Preflight.ts`, API `/analyze/x402`
- **testFiles:** `scripts/smoke-test.mjs` (x402 SSRF/over-limit/no-mainnet-claim)
- **overclaimRisk:** Don't claim x402 **mainnet payment** support.

## 7. ZAN RPC / optional RPC providers
- **officialDocsUrl:** `docs.pharos.xyz/tooling-and-infrastructure/rpc/zan`
- **officialFactSummary:** ZAN supports mainnet+testnet; URL `https://api.zan.top/node/v1/pharos/{mainnet|testnet}/{apikey}`; API key required.
- **currentSafeHandsStatus:** `resolveRpcUrl` reads `PHAROS_MAINNET_RPC_URL`/`ZAN_…`/`PHAROS_ZAN_RPC_URL` (alias, **5C**)/`ALCHEMY_…`/`NIRVANA_…` from env (mainnet); no keys hardcoded; public default otherwise. **Phase 5C** adds `resolveRpcProvider` → a **redacted** descriptor (`name`/`configuredViaEnv`/`usingPublicDefault`/`secretsRedacted:true`, **never the URL/key**) surfaced in `rpcEvidence.provider`. See `docs/PHAROS_ZAN_RPC_OPTIONAL.md`.
- **status:** implemented (env-only, redacted — Phase 5C)
- **riskRelevance:** Premium RPC must never leak; SafeHands keeps keys in env and omits them from `/public-config` and `/infra/status` (offline-tested with planted fake ZAN/premium URLs).
- **recommendedSafeHandsBehavior:** Keep env-only; document the ZAN mainnet URL format (5C).
- **implementationFiles:** `src/lib/networks.ts`
- **testFiles:** `scripts/smoke-test.mjs` (public-config no-premium-RPC test)
- **overclaimRisk:** Don't hardcode/ship provider keys.

## 8. Token registry
- **officialDocsUrl:** `docs.pharos.xyz/getting-started/token-registry`
- **officialFactSummary:** Atlantic: USDC `0xcfC8…c1815`, USDT `0xE7E8…82d5`, WBTC, WETH, WPROS. Pacific: WPROS `0x52c4…f0b0`, USDC(Circle) `0xc879…1815`, LINK `0x51e2…fcBE29`, WETH `0x1f4b…56E9`.
- **currentSafeHandsStatus:** **Network-aware (Phase 5B).** Pacific Mainnet registry implemented with the four official tokens (WPROS, Circle USDC, LINK, WETH) in `PACIFIC_MAINNET_TOKEN_REGISTRY`; `analyzeToken` resolves Pacific tokens by symbol/address → `CANONICAL_MAINNET_TOKEN` with `tokenRegistryEvidence` (source `official_docs`). Atlantic path unchanged (USDT + Circle USDC match official). `mainnetRegistryImplemented:true`.
- **status:** implemented (Pacific Mainnet + Atlantic) — **Phase 5B**
- **riskRelevance:** Known Pacific tokens are recognized with evidence; an unknown valid address stays `to_verify` (REQUIRE_CONFIRMATION). Recognition is metadata — a known token never makes a risky approval safe.
- **recommendedSafeHandsBehavior:** Keep registry data exact/`official_docs`; never silently trust a symbol; keep policy independent of token recognition.
- **implementationFiles:** `src/lib/constants.ts` (`PACIFIC_MAINNET_TOKEN_REGISTRY`), `src/lib/analysis/pharosTokens.ts` (`tokenRegistryEvidence`/`lookupPharosToken`), `src/lib/analysis/token.ts`, `src/tools/tokenRegistryStatus.ts`
- **testFiles:** `scripts/smoke-test.mjs` (5B token: WPROS/USDC-by-address/TO_VERIFY/registry-scope tests)
- **overclaimRisk:** Don't claim a programmatic on-chain registry contract — docs present a curated list.

## 9. Canonical contracts
- **officialDocsUrl:** `docs.pharos.xyz/getting-started/canonical-contracts`
- **officialFactSummary:** Permit2/Multicall3/EntryPoint v0.6+v0.7 at standard addrs; **GnosisSafe v1.3.0 `0x69f4…2938`**, **SafeL2 `0xfb1b…91EA`**, **MultiSend v1.3.0 `0x9987…9EDa`**, **CreateX `0xba5Ed…ba5Ed`** (Pacific).
- **currentSafeHandsStatus:** **Per-network recognition (Phase 5B).** The wrong standard-Ethereum Safe/MultiSend addresses were removed. Pharos-official **GnosisSafe `0x69f4…2938`**, **SafeL2 `0xfb1b…91EA`**, **MultiSend `0x9987…9EDa`**, **CreateX `0xba5Ed…ba5Ed`** are recognized on **Pacific Mainnet**; deterministic Permit2/Multicall3/EntryPoint v0.6+v0.7 on **all** networks. `canonicalContractEvidence(address, network)` returns per-network evidence (`name/category/standard/network/chainId/address/source/status/riskRelevance/recommendedSafeHandsBehavior`); `sourceVerified:false` retained.
- **status:** implemented (per-network: Pharos Safe/SafeL2/MultiSend/CreateX + deterministic) — **Phase 5B**
- **riskRelevance:** A real Pharos Safe/MultiSend tx is now recognized by address on Pacific; a known address that isn't recognized on the active network returns no evidence (fail-safe under-recognition, never a false positive). Recognition never bypasses policy.
- **recommendedSafeHandsBehavior:** Keep recognition per-network and `sourceVerified:false`; never auto-allow on recognition alone (deep Safe/Permit2 decode stays experimental).
- **implementationFiles:** `src/lib/analysis/contractIntel.ts` (`CANONICAL_CONTRACTS`/`canonicalContractEvidence`), `src/lib/analysis/evm.ts`, `src/lib/analysis/approval.ts`, `src/lib/analysis/safeTx.ts`
- **testFiles:** `scripts/smoke-test.mjs` (5B canonical: Pharos Safe recognized / no-Ethereum-default / Pacific-only MultiSend / deterministic-both / evidence surfaced via API)
- **overclaimRisk:** Don't assert on-chain deployment/verification — recognition is by address.

## 10. Explorer links
- **officialDocsUrl:** `www.pharosscan.xyz`, `pharos.socialscan.io`, network pages
- **officialFactSummary:** Pacific explorer `https://www.pharosscan.xyz`; Atlantic `https://atlantic.pharosscan.xyz`; SocialScan path **to_verify**.
- **currentSafeHandsStatus:** `explorerLinks()` builds `/address/` + `/tx/` links from the network registry (+ optional SocialScan).
- **status:** implemented (SocialScan path to_verify)
- **riskRelevance:** Lets callers verify subjects; no execution.
- **recommendedSafeHandsBehavior:** Keep link-building read-only; verify SocialScan path.
- **implementationFiles:** `src/api/response.ts` (`explorerLinks`), `src/lib/networks.ts` (`explorerTxBase`)
- **testFiles:** `scripts/smoke-test.mjs` (API payload shape)
- **overclaimRisk:** Don't imply explorer-API source verification unless implemented.

## 11. eth_getProof / SPV
- **officialDocsUrl:** `docs.pharos.xyz/api-and-sdk/eth-getproof-storage-state-verification`
- **officialFactSummary:** Officially supported (EIP-1186 Merkle proofs) for storage/state verification; SPV theory pages exist.
- **currentSafeHandsStatus:** **Phase 5C** classifies `eth_getProof` as
  `experimental_read_only` and surfaces its *availability* as
  `rpcEvidence.capabilities.ethGetProof` (`status:"experimental"`, `readOnly:true`,
  `spvVerification:"not_implemented"`). Proof *verification* is NOT performed.
- **status:** experimental (availability evidence only) / **roadmap** (SPV verification not_implemented)
- **riskRelevance:** Could provide stronger read-only state evidence (e.g., proven balances/storage).
- **recommendedSafeHandsBehavior:** Keep as read-only evidence; implement actual Merkle-proof verification only with code + tests; never an execution path.
- **implementationFiles:** `src/lib/pharos/rpcMethods.ts` (classification), `src/lib/pharos/rpcEvidence.ts` (capability evidence)
- **testFiles:** `scripts/smoke-test.mjs` (Phase 5C: getProof experimental + spv not_implemented)
- **overclaimRisk:** Don't claim full SPV verification — evidence exposes availability only (`spvVerification:"not_implemented"`).

## 12. Chainlink / CCIP / oracle / cross-chain
- **officialDocsUrl:** `docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe`, `…/cross-chain`
- **officialFactSummary:** Chainlink **price feeds deployed** via CRE (11 pairs); cache contract Pacific `0xc71f…424B`, Atlantic `0x5456…3Fa2`; feeds expose `latestAnswer()/latestTimestamp()/getFeedId()`. Cross-chain page names **CCIP** (messaging/transfer).
- **currentSafeHandsStatus:** No oracle/CCIP recognition.
- **status:** roadmap (Pharos-deployed; SafeHands evidence-only)
- **riskRelevance:** Oracle-dependent or CCIP calls carry price/bridge risk.
- **recommendedSafeHandsBehavior:** Oracle dependence → **evidence only**; CCIP/cross-chain calls → `REQUIRE_CONFIRMATION` unless trusted. No live integration.
- **implementationFiles:** *(future, 5D)* `src/lib/analysis/ecosystemEvidence.ts`
- **testFiles:** *(future)* `scripts/smoke-test.mjs`
- **overclaimRisk:** **High** — Chainlink is Pharos-native; SafeHands must not claim a Chainlink integration.

## 13. Goldsky indexing
- **officialDocsUrl:** `docs.pharos.xyz/tooling-and-infrastructure/indexing/goldsky`
- **officialFactSummary:** Subgraphs + Mirror (realtime streaming); network/endpoints not stated (external `goldsky.com/chains/pharos`).
- **currentSafeHandsStatus:** Not used.
- **status:** roadmap (optional data source)
- **riskRelevance:** Could enrich historical evidence; **not** an execution path.
- **recommendedSafeHandsBehavior:** Treat as optional/future read-only data source only.
- **implementationFiles:** *(future)* read-only evidence enrichment
- **testFiles:** *(future)*
- **overclaimRisk:** Don't claim a Goldsky integration; indexing ≠ guardrail logic.

## 14. Wallet infrastructure / custody providers
- **officialDocsUrl:** `docs.pharos.xyz/tooling-and-infrastructure/wallets`
- **officialFactSummary:** Pharos documents **Safe MultiSig** and **Fordefi** (MPC custody).
- **currentSafeHandsStatus:** SafeHands recognizes Safe txs by selector (experimental); holds no keys, no custody.
- **status:** roadmap (external infra awareness)
- **riskRelevance:** Treasury/custody flows (Safe) benefit from pre-sign checks.
- **recommendedSafeHandsBehavior:** External-infrastructure awareness; SafeHands **never custodies keys**; surface pre-sign verdicts to wallet/custody UIs (integration-ready, not integrated).
- **implementationFiles:** `src/lib/analysis/safeTx.ts` (Safe decode); `src/lib/analysis/contractIntel.ts` (Pharos canonical Safe/SafeL2/MultiSend addrs recognized on Pacific — **Phase 5B**)
- **testFiles:** `scripts/smoke-test.mjs` (safeTx tests; 5B canonical Safe recognition)
- **overclaimRisk:** Don't claim a Fordefi/Safe partnership or custody capability.

## 15. EVM compatibility
- **officialDocsUrl:** `docs.pharos.xyz/resources/evm` (to_verify), network/canonical pages
- **officialFactSummary:** Pharos is EVM-compatible (standard JSON-RPC, EVM canonical contracts, EVM refund semantics).
- **currentSafeHandsStatus:** All analyzers operate on EVM calldata/addresses via viem.
- **status:** implemented
- **riskRelevance:** Core assumption of every analyzer.
- **recommendedSafeHandsBehavior:** Keep EVM-standard decoding.
- **implementationFiles:** `src/lib/analysis/*` (viem decode)
- **testFiles:** `scripts/smoke-test.mjs`
- **overclaimRisk:** None.

## 16. WASM interoperability
- **officialDocsUrl:** `docs.pharos.xyz/developer-guide/interoperability/call-evm-from-wasm`
- **officialFactSummary:** **Dora VM** (C++ VM combining EVM + WASM, native interop); Rust/Stylus examples (`execute`/`transfer_eth`/`mint_erc20`) on Devnet/Testnet; mainnet status to_verify.
- **currentSafeHandsStatus:** No WASM-call analysis (EVM-only).
- **status:** experimental / roadmap
- **riskRelevance:** WASM→EVM calls could bypass naive EVM-only assumptions; relevant once analyzed.
- **recommendedSafeHandsBehavior:** Treat WASM-interop calls as **experimental**; unknown WASM-originated calls → `REQUIRE_CONFIRMATION`. No analyzer yet.
- **implementationFiles:** *(future)*
- **testFiles:** *(future)*
- **overclaimRisk:** Don't claim WASM analysis support.

## 17. CCTP (Circle)
- **officialDocsUrl:** `docs.pharos.xyz/tooling-and-infrastructure/cross-chain`
- **officialFactSummary:** Listed as a Pharos cross-chain solution (Circle CCTP); per-network detail to_verify.
- **currentSafeHandsStatus:** No CCTP recognition.
- **status:** roadmap
- **riskRelevance:** Cross-chain USDC transfers carry bridge risk.
- **recommendedSafeHandsBehavior:** Bridge-like/CCTP intent → `REQUIRE_CONFIRMATION` unless trusted. No integration.
- **implementationFiles:** *(future, 5D)* `src/lib/analysis/ecosystemEvidence.ts`
- **testFiles:** *(future)*
- **overclaimRisk:** Don't claim a Circle/CCTP integration.

## 18. LayerZero
- **officialDocsUrl:** `docs.pharos.xyz/tooling-and-infrastructure/cross-chain`
- **officialFactSummary:** Listed as a Pharos cross-chain messaging/bridge solution; detail to_verify.
- **currentSafeHandsStatus:** No LayerZero recognition.
- **status:** roadmap
- **riskRelevance:** Cross-chain messaging carries bridge/relayer risk.
- **recommendedSafeHandsBehavior:** Bridge-like intent → `REQUIRE_CONFIRMATION` unless trusted. No integration.
- **implementationFiles:** *(future, 5D)*
- **testFiles:** *(future)*
- **overclaimRisk:** Don't claim a LayerZero integration.

## 19. LI.FI
- **officialDocsUrl:** *(not named on the official cross-chain page)*
- **officialFactSummary:** **TO_VERIFY** — not found in Pharos official cross-chain docs this session.
- **currentSafeHandsStatus:** None.
- **status:** to_verify (else roadmap)
- **riskRelevance:** Bridge aggregation risk if present.
- **recommendedSafeHandsBehavior:** Until verified, treat any LI.FI-like bridge call as a generic bridge intent → `REQUIRE_CONFIRMATION`. No integration.
- **implementationFiles:** *(future, 5D)*
- **testFiles:** *(future)*
- **overclaimRisk:** **High** — do not list LI.FI as a Pharos/SafeHands integration without official confirmation.

## 20. Jumper
- **officialDocsUrl:** *(not named on the official cross-chain page)*
- **officialFactSummary:** **TO_VERIFY** — not found in Pharos official cross-chain docs this session.
- **currentSafeHandsStatus:** None.
- **status:** to_verify (else roadmap)
- **riskRelevance:** Bridge UI / aggregation risk if present.
- **recommendedSafeHandsBehavior:** Until verified, treat any Jumper-like bridge call as a generic bridge intent → `REQUIRE_CONFIRMATION`. No integration.
- **implementationFiles:** *(future, 5D)*
- **testFiles:** *(future)*
- **overclaimRisk:** **High** — do not list Jumper as a Pharos/SafeHands integration without official confirmation.

---

---

## Phase 5D status — ecosystem entries are now built (awareness, not integration)

The ecosystem rows above (Chainlink, CCIP/CCTP/LayerZero, LI.FI/Jumper, Goldsky,
Safe/Fordefi, Dora VM/WASM) are realized as a read-only evidence layer:
`src/lib/pharos/ecosystem.ts` (registry, official addresses only) and
`src/lib/pharos/ecosystemEvidence.ts` (classifier + escalate-only impact). Test file:
`scripts/smoke-test.mjs` (Phase 11 / 5D block). `implementationFiles`/`testFiles`
above marked *(future, 5D)* for **LI.FI/Jumper** intentionally stay future — both
remain **to_verify** and are handled only as generic cross-chain intents
(`REQUIRE_CONFIRMATION`), never as integrations. See
[`PHAROS_ECOSYSTEM_INTEGRATIONS.md`](../PHAROS_ECOSYSTEM_INTEGRATIONS.md),
[`PHAROS_ECOSYSTEM_EVIDENCE.md`](../PHAROS_ECOSYSTEM_EVIDENCE.md), and
[`PHAROS_IMPLEMENTED_VS_ROADMAP.md`](./PHAROS_IMPLEMENTED_VS_ROADMAP.md).

---

## Phase 5E status — capability flags + final integration audit

The 5A–5D work is consolidated by a final consistency audit (no new features):
honest product **capability flags** (`getCapabilityFlags()`, `src/lib/config.ts`) now
surface on `/infra/status` + `/public-config` — live read/check/analyze, all six evidence
types, `x402PreflightAvailable`, and `railwayReady` are `true`; write/signing/managed-
wallet/custody are `false`. Overclaim + read-only boundary audits **PASS**. SafeHands is a
real **mainnet-first** product (mainnet read/check/analyze live; write/execution gated +
future; execution disabled by default; no custody; no private keys). Demo scripts are
reviewer/dev examples only.

*Ecosystem positioning guardrails:
[`PHAROS_ECOSYSTEM_ALIGNMENT.md`](../PHAROS_ECOSYSTEM_ALIGNMENT.md).*

