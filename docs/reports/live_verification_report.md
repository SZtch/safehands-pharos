# SafeHands-Pharos — Live Docs & Testnet Verification Report

> **Date:** 2026-06-12  
> **Version:** 1.2.0  

---

## 1. Files Changed

| File | Change |
|------|--------|
| `src/lib/constants.ts` | USDT, WBTC, WETH, WPHRS verification upgraded from `PROJECT_CONFIGURED` → `DOCS_VERIFIED` after confirming against official Pharos Token Registry |
| `src/tools/tokenRegistryStatus.ts` | Handler now reads `verificationStatus` from registry entries directly |
| `src/lib/testRpcLive.ts` | **NEW** — Live RPC verification with structured output |
| `src/lib/testLiveSafehands.ts` | **NEW** — 7-point live CLI verification |
| `src/lib/testX402Live.ts` | **NEW** — x402 behavior verification (local server) |
| `src/lib/testDodoLive.ts` | **NEW** — DODO/FaroSwap live verification with clean skip |
| `package.json` | Added 4 new npm scripts |
| `README.md` | Added Real Testnet Verification section + updated Tests section |
| `OFFICIAL_DOCS_ALIGNMENT_REPORT.md` | **NEW** — Full docs alignment table |

## 2. Official Docs Checked

| Source | Fetched |
|--------|---------|
| https://docs.pharos.xyz/getting-started/network/atlantic-testnet | ✅ |
| https://docs.pharos.xyz/getting-started/token-registry | ✅ |
| https://docs.pharos.xyz/getting-started/canonical-contracts | ✅ |
| https://docs.pharos.xyz/developer-guide/x402 | ✅ |
| https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide | ✅ |
| https://developers.circle.com/stablecoins/usdc-contract-addresses | ✅ |
| https://docs.faroswap.xyz/en/introduction | ❌ HTTP 307 |

## 3. Docs Alignment Summary

- **13 DOCS_VERIFIED** — Environment, Chain ID, RPC, Explorer, Native Token, USDC, USDT, WBTC, WETH, WPHRS, x402 behavior, Skill Engine structure, Testnet scope
- **1 DOCS_DEMO_NON_OFFICIAL** — x402 demo token
- **4 PROJECT_CONFIGURED** — DODO Approve, DODO Route Proxy, Position Manager, RiskRegistry
- **0 CONFLICT**

## 4. Real RPC Test Result

```
npm run test:rpc:live
```

| Check | Result |
|-------|--------|
| RPC reachable | ✅ yes |
| Chain ID | 688689 ✅ match |
| Latest block | 24023029 |
| Wallet balance | SKIPPED_NO_WALLET_ADDRESS |
| **Status** | **PASS** |

## 5. Real SafeHands CLI Check Result

```
npm run test:live:safehands
```

| # | Check | Result |
|---|-------|--------|
| 1 | wallet_health_no_wallet | ✅ PASS |
| 2 | token_registry_canonical_usdc (DOCS_VERIFIED) | ✅ PASS |
| 3 | token_registry_x402_demo (DOCS_DEMO_NON_OFFICIAL) | ✅ PASS |
| 4 | token_registry_usdt_docs_verified | ✅ PASS |
| 5 | preflight_block_unlimited_approval | ✅ PASS |
| 6 | preflight_block_mainnet | ✅ PASS |
| 7 | preflight_allow_testnet | ✅ PASS |
| **Status** | **7/7 PASS** |

## 6. Real x402 Behavior Result

```
npm run test:x402:live
```

**Label: LOCAL_X402_SERVER_DOCS_BEHAVIOR_TEST**

| # | Check | Result |
|---|-------|--------|
| 1 | /supported without private key | ✅ 200 OK |
| 2 | /health without private key | ✅ 200 OK |
| 3 | Paid endpoint without config → structured 503 | ✅ |
| 4 | No crash on missing config | ✅ |
| 5 | x402 token matches docs (USDC on eip155:688689) | ✅ |
| **Status** | **5/5 PASS** |

## 7. DODO/FaroSwap Real Verification Result

```
npm run test:dodo:live
```

| # | Check | Result |
|---|-------|--------|
| 1 | DODO API route check | ⏭️ SKIPPED_MISSING_DODO_API_KEY |
| 2 | DODO Approve address verification | ✅ PROJECT_CONFIGURED |
| 3 | DODO Route Proxy verification | ✅ PROJECT_CONFIGURED |
| **Status** | **2/3 PASS, 1 SKIPPED** |

## 8. Address Metadata Changes

| Token | Before | After | Source |
|-------|--------|-------|--------|
| USDC | DOCS_VERIFIED | DOCS_VERIFIED | Token Registry + Circle |
| TUSDC | DOCS_DEMO_NON_OFFICIAL | DOCS_DEMO_NON_OFFICIAL | x402 docs |
| USDT | (no verificationStatus) | **DOCS_VERIFIED** | Token Registry |
| WBTC | (no verificationStatus) | **DOCS_VERIFIED** | Token Registry |
| WETH | (no verificationStatus) | **DOCS_VERIFIED** | Token Registry |
| WPHRS | (no verificationStatus) | **DOCS_VERIFIED** | Token Registry |
| DODO addresses | PROJECT_CONFIGURED | PROJECT_CONFIGURED | FaroSwap docs unavailable |
| RiskRegistry | PROJECT_CONFIGURED | PROJECT_CONFIGURED | Not in canonical contracts |

## 9. Commands Run and Results

| Command | Exit Code |
|---------|-----------|
| `npm run build` | 0 ✅ |
| `npx tsc -p tsconfig.all.json --pretty false` | 0 ✅ |
| `npm audit --omit=dev --audit-level=high` | 0 ✅ (0 vulnerabilities) |
| `npm pack --dry-run` | 0 ✅ (210 files, 128.4 kB) |
| `npm run test:all` | 0 ✅ (37/37 passed) |
| `npm run demo` | 0 ✅ |
| `npm run test:rpc:live` | 0 ✅ (PASS) |
| `npm run test:live:safehands` | 0 ✅ (7/7) |
| `npm run test:x402:live` | 0 ✅ (5/5) |
| `npm run test:dodo:live` | 0 ✅ (2/3, 1 skipped) |

## 10. Remaining Docs-Unverified Values

| Value | Status | Reason |
|-------|--------|--------|
| DODO Approve Address `0x4Cf3…` | PROJECT_CONFIGURED | FaroSwap docs HTTP 307 |
| DODO Route Proxy `0x8198…` | PROJECT_CONFIGURED | FaroSwap docs HTTP 307 |
| Position Manager `0x1c43…` | PROJECT_CONFIGURED | FaroSwap docs HTTP 307 |
| RiskRegistry `0x71fc…` | PROJECT_CONFIGURED | Custom project deployment |

## 11. Real Transactions Broadcast

**None.** Zero transactions were signed or broadcast during this verification pass. All tests are read-only RPC calls, deterministic preflight policy checks, or local server behavior tests.

## 12. Final Status

**Status: Ready for DoraHacks Phase 1 submission with real docs/live verification**

All 13 docs-verifiable values match official Pharos documentation. Live RPC confirms chain ID 688689 and block production. 37 smoke tests + 7 CLI checks + 5 x402 checks pass. DODO skips cleanly. Zero vulnerabilities. No overclaimed addresses.
