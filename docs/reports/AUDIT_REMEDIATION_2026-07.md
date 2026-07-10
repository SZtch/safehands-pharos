# SafeHands — Full Repository Audit + Remediation (2026-07)

> **Date:** 2026-07-10 · **Base commit:** `944c7d6` · **Posture:** Pharos Pacific Mainnet (chainId 1672), read-only gateway.
> This is the portable, in-repo record of the July 2026 read-only audit and the remediation that followed — the full, self-contained detail.

**Scope:** entire repo at commit `944c7d6`. ~50 direct file reads + 2 sub-audits (Anvita drift, test reality).

> **Remediation applied & verified.** All High/Medium/Low findings were fixed. Full gate green: `tsc --noEmit` (src + `tsconfig.test.json`) clean, **341 tests pass / 0 fail** (72 suites, incl. two new suites), `build` clean, `package:anvita` builds, **25 Hardhat contract tests pass**, `sync:anvita:check` clean (now incl. engine-consistency gate), `demo` exits 0. No contract changes were needed (see Q4). Fix details are folded into each finding; §18 lists what shipped.
>
> **One new finding surfaced during remediation:** writing the SSRF test suite (M3) exposed a **real latent SSRF gap** — IPv6-literal hosts (`http://[::1]/`, `http://[fc00::1]/`) bypassed `isBlockedIp` because `URL.hostname` keeps the brackets (so `net.isIP` returned 0 → fell through to DNS), and IPv4-mapped IPv6 in canonical hex form (`::ffff:7f00:1`, which is what `URL` produces) slipped the dotted-decimal string prefixes entirely. Fixed by bracket-stripping + extracting the embedded IPv4 and running the authoritative IPv4 CIDR table (this also fixes audit L6's `::ffff:172.2` public-space over-block). Logged as **H4** below.

---

## 1. Executive verdict: **CONDITIONALLY PRODUCTION-READY** (findings since remediated)

The read-only checkpoint core is **real, not a bolt-on**: live Chainlink prices via `eth_call` with heartbeat-staleness + bounded degraded cache (`src/lib/price/priceResolver.ts`), live GoPlus with fail-closed schema-drift handling (`src/tools/checkTokenSecurity.ts`), a genuine DNS-pinned SSRF layer (`src/lib/http.ts`), trustless on-chain Merkle inclusion through the contract's own `verifyRiskRecord` view (`src/lib/riskInclusion.ts`), a disciplined evidence-cited registry with CI drift-guard (`src/data/ecosystemRegistry.data.ts` + `scripts/sync-anvita-assets.ts --check`), and honest `NOT_CONFIGURED` gating on every absent provider. No name-only-allow anti-pattern exists; `allow_eligible` requires VERIFIED + verified contracts + citations.

**The conditions (all now remediated):** one subsystem — the DODO/FaroSwap swap layer — was testnet-origin and (a) mildly **relaxed** risk via hardcoded "known" trust and (b) presented degraded liquidity analysis as if it were a live check. Plus: one output bug (`getPoolInfo` isMainnet), one baked-in false claim (`agentEnrich` says GoPlus doesn't index Pharos), an unguarded DA fetch, and material test gaps (SSRF layer and risk engine untested). None fabricated an ALLOW, none touched custody; all were fixed.

---

## 2. Critical findings

**None.** No path fabricates a safety verdict from nothing, no mock data is presented as live on a default read path, no custody/signing exists outside the triple-env-gated write path (`WRITE_TOOLS_ENABLED` + `SAFE_EXECUTE_ENABLED` + `MANAGED_WALLET_ENABLED` + signer + registry authorization), and BLOCK verdicts cannot be downgraded (escalate-only aggregation in `src/lib/policy/actionPolicyEngine.ts`).

## 3. High findings

**H1 — DODO testnet-provenance addresses treated as trusted on mainnet (trust-model violation).**
- `src/lib/constants.ts` hardcoded `DODO_APPROVE_ADDRESS`, `DODO_ROUTE_PROXY_ADDRESS` with **no provenance comment** — unlike every registry entry, which cites evidence.
- `src/lib/analysis/approval.ts` labeled these "known" spenders on **all** networks, including mainnet — a risk-relaxing signal.
- `src/lib/riskEngine.ts` hardcoded counterparty trust score **5** ("Swap routed through DODO protocol (known)") for these addresses.
- This contradicted the repo's own discipline: the ecosystem registry keeps DODO/FaroSwap **UNVERIFIED**, and `src/lib/analysis/contractIntel.ts` deliberately **excludes** DODO from canonical metadata. Not attacker-controllable (fixed addresses) and cannot flip BLOCK→ALLOW, but "known spender" was unearned reassurance on mainnet.
> **Fixed:** trust is now registry-driven via `addressTrustEvidence()` (see §18); DODO constants carry a RESTRICTION-ONLY provenance comment.

**H2 — `approveToken` fabricated verification.** `src/tools/approveToken.ts` defaulted `spender: DODO_APPROVE_ADDRESS` and stamped `spenderVerified: true` — a literal, not a lookup. This invented exactly the caller-claim the truth model forbids, for a testnet address, on default mainnet config. Sat inside the env-gated write path (hosted read-only deployments never reach it), but the flag is a safety attestation surfaced to callers.
> **Fixed:** explicit `spender` now required; `spenderVerified` derives from `addressTrustEvidence`.

**H3 — Swap risk analysis was NOT_CONFIGURED-in-fact on mainnet but presented as live.** `src/lib/dodoApi.ts` header said "Pharos **Atlantic Testnet**"; it was called with mainnet `CHAIN_ID` by default. Failed quote fetches → `scoreLiquidity` returned 70 with "Failed to fetch liquidity data" → degraded + caution floor, **never block**, slippage equally blind. The marketed swap-risk feature ran degraded while emitting a normal-looking scored verdict.
> **Fixed:** `dodoApi.ts` now gates on `dodoApiSupportedChainIds()` and throws `DodoNotConfiguredError` (`SWAP_LIQUIDITY_NOT_CONFIGURED`) before any fetch on an unlisted chain; `getPoolInfo` applies the same gate. `riskEngine` distinguishes structural not-configured (`swapProviderNotConfigured` + "permanent configuration state" degraded reason) from transient failure, and every swap consumer (`executeSwap`, `estimateGas`, `simulateTransaction`, `paidRoutes`, `x402Server`) surfaces the structured code. **Default set = `[688689, 1672]`** — the operator confirmed the DODO API serves Pharos Pacific Mainnet, so mainnet swaps work out-of-the-box; the H1 registry-driven trust change still applies. Any *other* chain fails closed; overridable via `DODO_API_SUPPORTED_CHAIN_IDS`. The audit's original assumption that 1672 was unsupported was wrong per operator evidence — the value of the fix is the honest structured error + registry-driven trust, not disabling mainnet.

**H4 (found during remediation) — IPv6-literal + IPv4-mapped SSRF bypass in `src/lib/http.ts`.** `isBlockedIp`/`resolveSafeFetchTarget` used `URL.hostname` directly, which keeps IPv6 brackets (`[::1]`) → `net.isIP` returns 0 → the address skipped the blocklist and fell through to DNS (accidental fail-closed via `ENOTFOUND`, platform-dependent). IPv4-mapped IPv6 in canonical hex (`::ffff:7f00:1`) also evaded the dotted-decimal string prefixes.
> **Fixed:** `normalizeHostname()` strips brackets before IP checks; `mappedIpv4()` extracts the embedded IPv4 from both dotted and hex `::ffff:` forms and runs the authoritative IPv4 CIDR table (unparseable `::ffff:*` fails closed). Also resolves audit **L6**. Pinned by 83 cases in `test/http-ssrf.test.ts`.

## 4. Medium findings

**M1 — `getPoolInfo` wrong network flag.** `src/tools/getPoolInfo.ts` hardcoded `isMainnet: false` on the success path (the no-route branch correctly used `IS_MAINNET`). *Fixed → `IS_MAINNET`.*

**M2 — Baked-in false claim about GoPlus.** `src/agent/agentEnrich.ts` emitted "GoPlus does not index Pharos" while `src/tools/checkTokenSecurity.ts` does live GoPlus lookups. *Fixed → corrected the enrichment note.*

**M3 — SSRF layer untested.** `src/lib/http.ts` (CIDR blocklist, DNS-pinned lookup, redirect re-validation) had **zero tests** — the security boundary for every outbound fetch. *Fixed → new `test/http-ssrf.test.ts` (83 cases); surfaced H4.*

**M4 — Risk engine untested behaviorally.** `riskEngine.assessRisk` had no behavioral tests. Also untested: `userSignedBroadcaster`, `managedExecution`, `attestationPublisher`, `spvVerifier`; `SafeHandsGuardianAgent` only in non-gating live-smoke. *Fixed → new `test/risk-engine.test.ts` (hermetic); write-path modules remain deferred.*

**M5 — Hosted Anvita engine is a separate, weaker risk model.** `anvita/safehands/scripts/safehands-engine.js` is a reimplementation, not a port. Gaps vs TS: no calldata decoding, no denylist, no spend-cap policy, narrower SSRF ranges; only `health` validated chainId; block threshold ≥70 vs TS >80. *Partially addressed → per-command `eth_chainId` validation + drift guards added (§18); the duplicated-model debt remains open.*

**M6 — DA batch fetch bypassed the SSRF-safe layer.** `src/lib/riskInclusion.ts` used bare `fetch(dataURI)` on an operator-controlled URL read from chain. *Fixed → routed through `http.ts`.*

**M7 — Triple-USDC provenance conflict.** `src/lib/constants.ts` had three USDC addresses with inconsistent "Circle" provenance. *Fixed → one evidenced canonical (0xC879…, dual-sourced Pharos docs + Circle page); 0xcfC8… relabeled Circle testnet.*

**M8 — Test env-pollution.** `x402-daily-cap.test.ts` and `registry-failclosed.test.ts` mutated `process.env` without restore. *Fixed → snapshot/restore added.*

## 5. Low findings

- **L1** MCP `get_token_price` description said "DODO liquidity quotes"; impl is Chainlink. *Fixed.*
- **L2** `agentEnrich.ts` imported unused `NO_RISK_SCORE`; the constants comment was stale. *Fixed → import + sentinel removed.*
- **L3** Dead code: `guardianOperator.ts` (whole module), 3 `agentRuntime.ts` exports. *Fixed → deleted/pruned.*
- **L4** Legacy `SAFEHANDS_RISK_REGISTRY_ADDRESS` aliased both registry and attestation to one address. *Fixed → no longer aliases the attestation contract.*
- **L5** `riskRegistryAvailable` required the attester key, so read-only deployments under-reported keyless read verification. *Fixed → split into `riskRegistryReadAvailable` (keyless) vs `riskRegistryPublishAvailable`; old flag kept as deprecated alias.*
- **L6** `http.ts` `::ffff:172.2` prefix over-matched public 172.2.0.0/16. *Fixed as part of H4.*
- **L7** `actionPolicyEngine.isSuspiciousUrl` misses IPv4-mapped-IPv6 / hex / octal literals — defense-in-depth heuristic only; real fetches guarded by `http.ts`, and the hosted skill never fetches user URLs. *Left as-is (heuristic; real guard is `http.ts`).*
- **L8** Anvita engine: UA literal drift, `evidenceSources[].verifiedAt` null, ABI files outside drift check. *Fixed → `ENGINE_VERSION` single-sourced + drift-checked; ABI/selector coverage added.*
- **L9** `x402-server` (standalone local-facilitator demo) holds custody by design — clearly separated from the zero-custody `x402Gate`; keep the caveat loud in docs.

## 6. Mock / stub / placeholder inventory

| Item | Location | Verdict |
|---|---|---|
| `spenderVerified: true` literal | `src/tools/approveToken.ts` | **Fabricated claim** (H2) — the only true "mock presented as signal" found; now fixed |
| Network-boundary mocks in tests | `test/*` | Legitimate (confined to fetch/RPC boundary; `mainnet-integration.test.ts` is hermetic — name overstates, content honest) |
| Awareness registry "roadmap"/"to_verify" | `src/lib/pharos/ecosystem.ts` | Honest AWARENESS_ONLY, clearly labeled — not mock |
| Provider-gated tools (Goldsky, pool info, exec history) | TS + Anvita | Honest `*_NOT_CONFIGURED` structured errors — model behavior, not stubs |

No demo JSON, no canned verdicts, no fake balances (`getWalletBalance` reports mainnet USDT `supported:false` rather than inventing a number).

## 7. Dead code inventory (partial — sweep agent failed; reconstructed manually)

- `src/agent/guardianOperator.ts` — entire module, zero consumers. *Deleted.*
- `src/agent/agentRuntime.ts` — `describeObligation`, `runScenario`, `GuardianAgentLike` unused; `obligationFor` + `CallerObligation` are live. *Dead exports pruned.*
- `src/agent/agentEnrich.ts` — dead `NO_RISK_SCORE` import. *Removed.*
- A `knip`/`ts-prune` pass is still recommended to finish the sweep.

## 8. Hardcode inventory

| Hardcode | Location | Assessment |
|---|---|---|
| DODO approve/route-proxy/position-manager addresses, no provenance | `src/lib/constants.ts` | **Was bad (H1)** → provenance comment + restriction-only role |
| DODO counterparty score 5 | `src/lib/riskEngine.ts` | **Was bad (H1)** → registry-driven |
| `spenderVerified: true` | `src/tools/approveToken.ts` | **Was bad (H2)** → registry-derived |
| `isMainnet: false` | `src/tools/getPoolInfo.ts` | **Was a bug (M1)** → `IS_MAINNET` |
| "GoPlus does not index Pharos" | `src/agent/agentEnrich.ts` | **Was a stale falsehood (M2)** → corrected |
| Triple USDC addresses | `src/lib/constants.ts` | **Was conflicted (M7)** → one evidenced canonical |
| UA `"SafeHands/2.3.0"` | Anvita engine | **Was drift-prone (L8)** → `ENGINE_VERSION` single-sourced + drift-checked |
| Baked Pacific registry/attestation defaults | `constants.ts` | **Good** — chainId-guarded, fail-closed off-1672, env-overridable |

## 9. Live-data wiring inventory (per-feature classification)

| Feature | Classification | Evidence |
|---|---|---|
| Token price (Chainlink Push via `eth_call`) | **LIVE_READ_ONLY** | `priceResolver.ts` — heartbeat staleness, bounded degraded cache, `rpc_degraded_cache` honesty |
| GoPlus token security | **LIVE_READ_ONLY** | `checkTokenSecurity.ts` — null on schema drift → never scores unreadable-as-safe |
| RPC reads (balance/gas/tx-status/simulate/SPV) | **LIVE_READ_ONLY** | `rpcMethods.ts` whitelist, fail-closed on unknown/`wallet_`/`personal_` |
| Registry Merkle inclusion + attestation reads | **LIVE_READ_ONLY** | trustless `verifyRiskRecord` on-chain view; root-mismatch fails loudly |
| Ecosystem registry | **STATIC_VERIFIED** | citations per entry; `validateEcosystemRegistry` gates; CI drift check |
| Pharos ecosystem awareness (CCIP/LayerZero/…) | **AWARENESS_ONLY** | statuses `roadmap`/`to_verify`, never risk-relaxing |
| Goldsky subgraph / execution history / pool info | **NOT_CONFIGURED** | honest structured errors both TS and Anvita |
| Swap route/liquidity/slippage (DODO API) | **LIVE_READ_ONLY on supported chains** | was H3 (mislabeled); now gated + operator-confirmed for 1672 |
| Wallet balance (mainnet USDT) | Honest `supported:false` | `getWalletBalance.ts` |

## 10. UX / output issues (all addressed)

1. `get_token_price` MCP description contradicted behavior (L1) → fixed.
2. Enrichment text asserted a falsehood about GoPlus (M2) → fixed.
3. Mainnet pool info claimed `isMainnet:false` (M1) → fixed.
4. "Failed to fetch liquidity data" read as transient (H3) → now a structured not-configured code.
5. `capabilities.riskRegistryAvailable:false` under-claimed keyless verification (L5) → split read/publish flags.
6. Anvita `evidenceSources[].verifiedAt: null` (L8) → addressed.
7. Strong overall: SKILL.md output discipline (never invent a cell), structured error shapes, `included` roll-up in `verifyRiskInclusion`.

## 11. Anvita vs TS/API/MCP drift

- Hosted engine = separate risk model by policy (port read-path verdict logic only). Concrete drift: no calldata decoding, no denylist, no spend caps, narrower SSRF → hosted verdicts are systematically weaker. **Open debt.**
- Block threshold: hosted ≥70 vs TS >80 — documented divergence.
- `chainId:1672` now validated per-command (was stamped unconditionally except `health`).
- Asset sync covers the 5 JSONs **and now** ABI files + engine selectors + `ENGINE_VERSION` (new consistency gate).
- MCP: 33 tools; API schemas + CLI aligned.

## 12. Smart contracts — usefulness + gaps

**Both contracts are useful and production-appropriate for the current read-only mission.**

- `SafeHandsRegistry.sol`: Merkle risk-root anchor + operator/agent authorization + trustless `verifyRiskRecord` view (double-hashed leaf, sorted pairs — matches `merkleBatcher.ts`). `Ownable2Step`, renounce disabled, operator-gated `commitRiskRoot`.
- `SafeHandsAttestation.sol`: immutable append-only ledger, dual replay guard, reads operator auth from Registry.

**Gaps (acceptable now, matter later):** `reputationOf` is operator-attested (a rogue operator can inflate reputation — keep documented); no per-record revocation (expiry only); no pause/circuit-breaker; no on-chain verdict-freshness enforcement; root history not consumable by clients.

## 13. Future write-readiness — the five questions

**Q1. Is the current SafeHands design good?** Yes. Layered truth model (registry → intel → engine → policy → surfaces), fail-closed at every provider boundary, escalate-only aggregation, one policy engine behind three surfaces, zero-custody default with triple-gated writes, registry-as-single-source with CI drift guard. Two structural debts remain (duplicated Anvita risk model; risk-engine vs policy-engine overlap).

**Q2. Compatible with future Anvita write support?** Yes. The decision contract already anticipates it (`PREPARE_ONLY`; `agentRuntime.OBLIGATION_CONTRACT`). The hosted skill should stay verdict-only (Anvita Flow: hosted name immutable, no unpublish — custody there is irreversible reputationally); writes belong in the operator backend behind the env gates. Write support is additive.

**Q3. Are the current contracts still useful?** Yes — as the on-chain memory/anchor layer. `verifyRiskRecord` is already consumed trustlessly by the read path.

**Q4. Update contracts now or after write-gating finalizes?** **After.** No finding required a contract change; all fixes were TS/asset-level. Contracts are orthogonal to write-gating, so v2 ships alongside without migration. Redeploying now would burn the verified addresses for zero benefit.

**Q5. What would a write-gating contract v2 need?**
1. **Intent tickets**: approved-intent hash → one-shot, expiring, nonce-bound execution ticket.
2. **Verdict freshness**: on-chain `maxAge`/`expiresAt` enforcement at execution time (registry already stores `expiresAt`).
3. **Per-agent spend caps + allowance ceilings** with time-windowed accounting.
4. **Scoped delegation / session keys** (ERC-4337/7715-style).
5. **Revocation + timelock** on operator/agent authz changes; **pause/circuit-breaker**.
6. **Policy commitment**: bind executions to `policyVersionHash` (already in the leaf schema).
7. **Event surface** for real-time monitoring of gated executions and denials.

## 14. Test gaps

1. `http.ts` SSRF layer — **fixed** (M3 → `test/http-ssrf.test.ts`).
2. `riskEngine.assessRisk` — **fixed** (M4 → `test/risk-engine.test.ts`).
3. Write-path modules (`userSignedBroadcaster`, `managedExecution`, `attestationPublisher`, `spvVerifier`) — **still deferred**.
4. `SafeHandsGuardianAgent` — only non-gating live-smoke.
5. Env pollution (M8) — **fixed**.
6. Positive: contracts have real Hardhat tests in CI; `mainnet-integration.test.ts` is hermetic; mocks confined to network boundary; asset-drift test wired.

## 15. Docs / claim gaps (all addressed)

- `dodoApi.ts` header (H3) → corrected. `index.ts` tool description (L1) → corrected. `agentEnrich.ts` GoPlus falsehood (M2) → corrected. `constants.ts` stale `NO_RISK_SCORE` comment (L2) → removed. Anvita engine docstring (M5) → chainId validation added. README/SKILL.md otherwise verified honest.

## 16. Recommended fix order (as executed)

H1 → H2 → H3 → M1 → M2/L2 → M6 → L1 → M3/M4/M8 → L3 → M5/L8 → M7 → L4/L5, then H4 (surfaced by the M3 test work). All completed; verification gate green.

## 17. Files changed

`src/lib/ecosystemRegistry.ts` (new `addressTrustEvidence`) · `src/lib/constants.ts` · `src/lib/analysis/approval.ts` · `src/lib/analysis/calldata.ts` · `src/lib/riskEngine.ts` · `src/tools/approveToken.ts` · `src/tools/executeSwap.ts` · `src/tools/getPoolInfo.ts` · `src/tools/estimateGas.ts` · `src/tools/simulateTransaction.ts` · `src/tools/checkAllowance.ts` · `src/agent/agentEnrich.ts` · `src/lib/riskInclusion.ts` · `src/lib/http.ts` · `src/index.ts` · `src/lib/dodoApi.ts` · `src/lib/config.ts` · `src/lib/pharos/attestationPublisher.ts` · `src/api/paidRoutes.ts` · `src/x402Server.ts` · `src/data/ecosystemRegistry.data.ts` · `anvita/safehands/scripts/safehands-engine.js` · `scripts/sync-anvita-assets.ts` · `src/agent/guardianOperator.ts` (deleted) · `src/agent/agentRuntime.ts` (pruned) · `src/agent/index.ts` · new `test/http-ssrf.test.ts`, `test/risk-engine.test.ts` · env-restore in `test/x402-daily-cap.test.ts`, `test/registry-failclosed.test.ts` · `package.json` (test list) · `test/anvita-asset-sync.test.ts`.

**Contracts: no changes (see Q4).**

## 18. What shipped (remediation record)

All fixes are TypeScript / asset / engine-level — **no `.sol` changes**. Verified green: typecheck (src + test), 341 tests, build, Hardhat contracts (25), `sync:anvita:check` (+ new engine-consistency gate), `package:anvita`, `demo`.

**New central primitive:** `addressTrustEvidence(address, chainId)` in `src/lib/ecosystemRegistry.ts` — the single sanctioned way risk logic derives spender/counterparty trust. `recognized` ≠ `verifiedCanonical`; a registry entry for a different chainId yields no recognition (testnet never carries to mainnet). Hardcoded "known address" maps outside the registry are gone.

- **H1** — `approval.ts` + `calldata.ts` `classifySpender`/`classifyKnown` now registry-driven; unverified matches labeled "recognition only" and never relax risk. `riskEngine.scoreCounterparty` derives swap-router trust from the registry (no more unconditional score 5). DODO constants carry a RESTRICTION-ONLY provenance comment.
- **H2** — `approveToken` requires an explicit `spender`; `spenderVerified` comes from `addressTrustEvidence` (never a literal); result surfaces `spenderRegistryEvidence`. `executeSwap`'s inline approval does the same (allowlist membership is containment, not verification).
- **H3** — `DodoNotConfiguredError` / `dodoApiSupportedChainIds()` gate (default `[688689, 1672]` — mainnet confirmed working by the operator); structural `swapProviderNotConfigured` plumbed through the risk engine and every swap consumer. Nothing about DODO was deleted — swaps still route through it; only the fake "known/verified" trust was removed and unverified chains now fail closed.
- **H4** — `http.ts` `normalizeHostname()` + `mappedIpv4()` SSRF hardening (also fixes L6).
- **M1** `getPoolInfo` `isMainnet: IS_MAINNET`. **M2/L2** agentEnrich GoPlus falsehood corrected; dead `NO_RISK_SCORE` removed. **M5/L8** engine validates `eth_chainId` on the first read of every command; `ENGINE_VERSION` UA single-sourced; `verifyAnvitaEngineConsistency()` cross-checks ABI methods + selectors + version, wired into the sync check and `anvita-asset-sync.test.ts`. **M6** DA fetch routed through the SSRF-safe layer. **M7** USDC provenance dual-evidenced; `0xcfC8…` relabeled Circle *testnet*. **M8** env snapshot/restore in the two polluting tests.
- **L1** MCP `get_token_price` description → Chainlink. **L3** `guardianOperator.ts` deleted; dead `agentRuntime` exports pruned. **L4** legacy `SAFEHANDS_RISK_REGISTRY_ADDRESS` no longer aliases the attestation contract. **L5** capability flags split into `riskRegistryReadAvailable` (keyless) vs `riskRegistryPublishAvailable`; old flag kept as a deprecated alias.
- **Tests** — new `test/http-ssrf.test.ts` (83 cases) and `test/risk-engine.test.ts` (7 cases, hermetic JSON-RPC), both registered in `package.json`.

**Deferred (not blocking):** write-path module tests (`userSignedBroadcaster`/`managedExecution`/`attestationPublisher`/`spvVerifier`) and a `knip`/`ts-prune` sweep to finish the partial dead-code inventory — recommended follow-ups, no correctness risk in the read-only posture.

**Open architectural debts (design-level, not bugs):** (1) the Anvita hosted engine is a duplicated, weaker risk model — ideally share/port the verdict logic; (2) the numeric `riskEngine` and deterministic `actionPolicyEngine` overlap muddily — ideally make the policy engine the sole ALLOW/BLOCK decider and the risk score advisory-only.
