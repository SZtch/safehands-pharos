# SafeHands-Pharos Final Audit Report

**Date:** 2026-06-12  
**Reviewer Roles:** Senior TypeScript Backend Engineer, MCP Architect, Pharos Skill Engine Integrator, Web3 Security Auditor, Hackathon Submission Reviewer  
**Repository:** safehands-pharos-main v1.2.0

---

## 1. Executive Summary

SafeHands-Pharos is a **Pharos Skill Engine-compatible MCP package** that acts as a **Transaction Safety Firewall for AI agents**. It provides policy-based preflight checks before payment, token approval, swap, or x402 paid requests, returning `ALLOW`, `WARN`, or `BLOCK` decisions with human-readable risk explanations.

The project builds cleanly, typechecks without errors, passes all 37/37 smoke tests, has zero high-level production vulnerabilities, produces a safe npm tarball, runs a deterministic demo without broadcasting transactions, and includes a complete Pharos Skill Engine adapter.

**One minor fix was applied during this audit:** The `--demo` flag in the compiled entrypoint now uses `setTimeout(() => process.exit(0), 100)` instead of synchronous `process.exit(0)` to prevent a Windows-specific libuv `UV_HANDLE_CLOSING` assertion crash caused by express keep-alive sockets being closed during `process.exit`.

---

## 2. Does the App Work Like I Want?

**Yes.** The app behaves as specified:

| Behavior | Status |
|---|---|
| Preflight returns ALLOW for safe testnet actions | ✅ Verified |
| Preflight returns BLOCK for mainnet actions | ✅ Verified |
| Preflight returns BLOCK for unlimited approvals | ✅ Verified |
| Preflight returns BLOCK for chain ID mismatch | ✅ Verified by code review |
| SSRF-sensitive x402 URLs are blocked | ✅ Verified |
| x402 free endpoints work without private key | ✅ Verified |
| x402 paid endpoint returns structured signer error | ✅ Verified |
| Write tools are disabled by default | ✅ Verified |
| No wallet created on startup/import/install | ✅ Verified |
| Demo runs deterministically without broadcasting | ✅ Verified |
| CLI returns valid JSON envelope | ✅ Verified |
| MCP server starts and registers 27 tools | ✅ Verified |
| npm pack excludes all secrets | ✅ Verified |

---

## 3. Evidence from Code

### Policy Engine — Action Types

All 6 action types are defined as a union type in [actionPolicyEngine.ts:L19-25](file:///c:/Users/Administrator/Desktop/safehands-pharos-main/src/lib/policy/actionPolicyEngine.ts#L19-L25):

```typescript
export type SafeHandsActionType =
  | "send_payment"
  | "approve_token"
  | "execute_swap"
  | "x402_pay_and_fetch"
  | "publish_risk_score"
  | "custom_contract_call";
```

### Policy Engine — Decisions

All 6 decisions are defined in [actionPolicyEngine.ts:L27-33](file:///c:/Users/Administrator/Desktop/safehands-pharos-main/src/lib/policy/actionPolicyEngine.ts#L27-L33):

```typescript
export type PolicyDecision =
  | "ALLOW"
  | "WARN"
  | "BLOCK"
  | "REQUIRE_CONFIRMATION"
  | "REQUIRE_FUNDING"
  | "REQUIRE_TOKEN_REVIEW";
```

### Policy Engine — Risk Levels

All 5 risk levels are defined in [actionPolicyEngine.ts:L35](file:///c:/Users/Administrator/Desktop/safehands-pharos-main/src/lib/policy/actionPolicyEngine.ts#L35):

```typescript
export type PolicyRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
```

### Policy Rule Implementation Evidence

| Rule | File | Line(s) | Implementation |
|---|---|---|---|
| Block mainnet actions | `actionPolicyEngine.ts` | 162-166 | `if (isMainnet)` → `pushCheck("fail", ...)` |
| Block chain ID mismatch | `actionPolicyEngine.ts` | 168-172 | `if (chainId !== CHAIN_ID)` → `pushCheck("fail", ...)` |
| Block unlimited approval by default | `actionPolicyEngine.ts` | 198-209 | `isUnlimitedApprovalAmount()` check, blocked unless `allowUnlimitedApproval === true` |
| Block SSRF-sensitive x402 URLs | `actionPolicyEngine.ts` | 118-134 | `isSuspiciousUrl()` blocks localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, ::1 |
| Block payment above configured limit | `actionPolicyEngine.ts` | 184-196 | `amount > MAX_TX_AMOUNT_PHRS` → fail |
| Block x402 payment above MAX_X402_PAYMENT_USDC | `actionPolicyEngine.ts` | 231-236 | `payment > MAX_X402_PAYMENT_USDC` → fail |
| Block approval above MAX_APPROVAL_AMOUNT_USDC | `actionPolicyEngine.ts` | 203-208 | `approvalAmount > MAX_APPROVAL_AMOUNT_USDC` → fail |
| Warn if token security provider unavailable | `actionPolicyEngine.ts` | 257-258 | `tokenSecurityStatus === "unavailable"` → warn |
| Warn if token is custom/non-registry | `actionPolicyEngine.ts` | 254-256 | `tokenRegistryStatus === "CUSTOM_NON_REGISTRY"` → warn |
| Warn if recipient/spender is unverified | `actionPolicyEngine.ts` | 193-194, 212-213 | `recipientVerified === false` or `spenderVerified === false` → warn |
| Require confirmation for medium-risk | `actionPolicyEngine.ts` | 149 | `if (riskLevel === "MEDIUM") return "REQUIRE_CONFIRMATION"` |
| Allow low-risk Pharos Atlantic Testnet action | `actionPolicyEngine.ts` | 151 | `return "ALLOW"` when all checks pass |

### SSRF Implementation

Full SSRF protection is in [http.ts:L85-145](file:///c:/Users/Administrator/Desktop/safehands-pharos-main/src/lib/http.ts#L85-L145):
- IPv4 CIDR checks for `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`
- IPv6 checks for `::1`, `fc`, `fd`, `fe80:`, `::ffff:127.*`, `::ffff:10.*`, `::ffff:192.168.*`
- DNS resolution check to prevent TOCTOU bypass

### Private Key Isolation

`process.env.PRIVATE_KEY` appears in exactly **one** file outside test code: [signer/index.ts](file:///c:/Users/Administrator/Desktop/safehands-pharos-main/src/lib/signer/index.ts). No tool handler reads it directly.

### x402 Payment Header Redaction

In [x402PayAndFetch.ts:L155-159](file:///c:/Users/Administrator/Desktop/safehands-pharos-main/src/tools/x402PayAndFetch.ts#L155-L159), the `PAYMENT-RESPONSE` header is explicitly redacted:
```typescript
paymentDetails: paymentResponseHeader
  ? { headerRedacted: true, note: "PAYMENT-RESPONSE header was present but intentionally not exposed..." }
  : null,
```

---

## 4. Evidence from Commands

| Command | Result | Exit Code |
|---|---|---|
| `npm ci` | 139 packages installed, audited 140 | 0 |
| `npm run build` | `tsc` compiled cleanly | 0 |
| `npx tsc -p tsconfig.all.json --pretty false` | No errors | 0 |
| `npm run test:all` | **37/37 smoke checks passed** | 0 |
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** | 0 |
| `npm pack --dry-run` | 194 files, 120.7 kB package | 0 |
| `npm run demo` | Full 10-step demo completed | 0 |
| `node dist/index.js --help` | Full branded help output | 0 |
| `node dist/index.js --demo` | Full demo, clean exit | 0 |
| `node dist/index.js skill safehands_wallet_health --input-json '{}'` | Valid JSON, `NOT_READY` status | 0 |
| `node dist/index.js skill token_registry_status --input-json '...'` | `CANONICAL_TESTNET_TOKEN`, `DOCS_VERIFIED` | 0 |
| `node dist/index.js skill safehands_preflight_check --input-json '...'` (unlimited approval) | `BLOCK`, `HIGH` risk | 0 |
| `node dist/index.js` (MCP server) | Started on stdio, registered 27 tools | Ran successfully |

---

## 5. Official Docs Alignment Table

| Item | Project Value | Official Docs Value | Status | Notes |
|---|---|---|---|---|
| Pharos environment | `atlantic-testnet` | `atlantic-testnet` | DOCS_VERIFIED | Matches Pharos Hardhat guide |
| Chain ID | `688689` | `688689` | DOCS_VERIFIED | Matches Pharos Hardhat guide |
| RPC URL | `https://atlantic.dplabs-internal.com` | `https://atlantic.dplabs-internal.com` | DOCS_VERIFIED | Matches Pharos Hardhat guide |
| Primary USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` | Pharos Skill Engine `tokens.json` | DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE | Skill Engine canonical USDC |
| Alternate USDC (Circle) | `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` | Circle Pharos Testnet USDC | CIRCLE_REFERENCED_USDC | Matches Circle USDC contract address docs but not Skill Engine primary |
| x402 free endpoint behavior | No private key required for `/supported`, `/health` | Pharos x402 docs | DOCS_VERIFIED | Code and demo confirm free endpoints work without signer |
| x402 paid endpoint behavior | Returns structured `X402_PAYMENT_REQUIRED` error when signer is absent | Expected x402 protocol behavior | DOCS_VERIFIED | Correctly returns `NO_SIGNER_AVAILABLE` |
| Skill Engine structure | `SKILL.safehands.md`, `references/`, `assets/` | Pharos Skill Engine guide structure | DOCS_VERIFIED | Follows expected skill package layout |
| FaroSwap/DODO router addresses | `0x4Cf...`, `0x819...` | Not independently verified from official Pharos docs | PROJECT_CONFIGURED | Labeled as project constants in code; used only when DODO_API_KEY is set |
| USDT address | `0xE7E8...` | Not independently verified | PROJECT_CONFIGURED | Labeled `TODO verify against official docs` in source |
| WBTC/WETH/WPHRS addresses | Various | Not independently verified | PROJECT_CONFIGURED | Labeled `TODO verify against official docs` in source |
| RiskRegistry address | `0x71fc...` | Project-deployed contract | PROJECT_CONFIGURED | Deployed by project; not a Pharos official contract |
| Testnet-only disclaimer | Present in README, SECURITY, HACKATHON_SUBMISSION, CLI help | N/A | DOCS_VERIFIED | Clearly stated in all relevant docs |
| Mainnet support | Not claimed | N/A | DOCS_VERIFIED | `IS_MAINNET = false` hardcoded; all docs say testnet-only |

> [!NOTE]
> No CONFLICT status found. FaroSwap/DODO router addresses and some token addresses are honestly labeled as `PROJECT_CONFIGURED` in the source code with TODO notes for future verification.

---

## 6. MCP Status

| Check | Result |
|---|---|
| MCP server starts | ✅ Yes |
| Registered tools count | **27** (7 SafeHands branded + 17 core/legacy + 3 managed wallet) |
| SafeHands branded tools present | ✅ All 7: `safehands_preflight_check`, `safehands_safe_execute`, `safehands_wallet_health`, `safehands_x402_preflight`, `safehands_risk_report`, `explain_risk`, `token_registry_status` |
| Startup side effects | Only stderr warning about write tools being disabled |
| Wallet created on startup | ✅ No |
| Private key required on startup | ✅ No |

---

## 7. CLI Status

| CLI Command | Result |
|---|---|
| `--help` | ✅ Shows branded help text with all 7 SafeHands tools, 20 other tools, testnet config, x402 behavior, safety defaults, and examples |
| `--demo` | ✅ Runs all 10 demo sections deterministically with clean exit (code 0) |
| `skill safehands_wallet_health --input-json '{}'` | ✅ Returns valid JSON: `NOT_READY` status, no private key required |
| `skill token_registry_status --input-json '...'` | ✅ Returns `CANONICAL_TESTNET_TOKEN` with `DOCS_VERIFIED` |
| `skill safehands_preflight_check --input-json '...'` (unlimited) | ✅ Returns `BLOCK`, `HIGH` risk, `"Unlimited approval requested."` |
| Invalid JSON input | ✅ Returns `INVALID_INPUT_JSON` structured error |
| Unknown tool name | ✅ Returns `UNKNOWN_SKILL_TOOL` structured error |

---

## 8. Skill Engine Adapter Status

### Structure

```
examples/pharos-skill-engine/
├── SKILL.safehands.md          ✅ 86 lines, complete
├── references/
│   └── safehands.md            ✅ 346 lines, complete
└── assets/
    └── safehands/
        ├── policy-defaults.json ✅ 12 lines, matches .env.example
        └── example-actions.json ✅ 50 lines, 7 example actions
```

### Agent Usability Assessment

| Question | Answer |
|---|---|
| Can an AI agent understand when to use SafeHands? | ✅ Yes — "When to use" and "When not to use" sections are clear |
| Can an AI agent know which CLI command to run? | ✅ Yes — Command templates with full `npx` syntax in every reference section |
| Can an AI agent parse the response? | ✅ Yes — Output parsing tables for every tool with field-by-field meaning |
| Are BLOCK/WARN/ALLOW behaviors explained? | ✅ Yes — Agent guidelines in SKILL.md (10 rules) and per-tool sections |
| Are error-handling steps explained? | ✅ Yes — Error tables with code, meaning, and agent action for each tool |

### SKILL.safehands.md Content Verification

| Required Section | Present |
|---|---|
| Skill name | ✅ `safehands-guard` |
| Description | ✅ "Transaction Safety Firewall / Guardrail Skill" |
| When to use | ✅ 4 use cases listed |
| When not to use | ✅ Clear boundary with Pharos Skill Engine |
| Capability index | ✅ 6 capabilities with reference links |
| Pharos Atlantic Testnet context | ✅ Table with env, chain ID, mainnet=false |
| Safety disclaimer | ✅ "not audited for mainnet production use" |
| Agent behavior guidelines | ✅ 10 rules |
| Link to references | ✅ `references/safehands.md` |

---

## 9. Security Status

| Check | Result |
|---|---|
| No `.env` included in repo or package | ✅ |
| No `wallet-store.json` included | ✅ |
| No private keys included | ✅ |
| No `*.pem` or `*.key` included | ✅ |
| No logs included | ✅ |
| No `node_modules` in npm package | ✅ |
| Private key only through SignerProvider | ✅ Only in `src/lib/signer/index.ts` |
| No direct `process.env.PRIVATE_KEY` outside signer | ✅ Verified by grep and smoke test |
| Write tools disabled by default | ✅ `WRITE_TOOLS_ENABLED=false` in `.env.example` |
| Unlimited approval disabled by default | ✅ `ALLOW_UNLIMITED_APPROVAL=false` in `.env.example` |
| No wallet created on import/startup | ✅ Explicit `create_agent_wallet` only |
| x402 signed payloads not logged | ✅ `headerRedacted: true` in response |
| Managed wallet labeled testnet-grade | ✅ In SECURITY.md and README |
| Mainnet support not claimed | ✅ All docs say testnet-only |
| `.env.example` has no secret-looking values | ✅ All keys are empty or safe defaults |
| `npm pack --dry-run` excludes all unsafe files | ✅ 194 clean files, 0 unsafe |

---

## 10. Gaps or Overclaims

### Honest Gaps

1. **Live RPC dependency.** `safehands_wallet_health` requires a live Pharos Atlantic Testnet RPC connection to read balances. When RPC is unavailable, it returns `DEGRADED` status — this is correct behavior, not a bug.

2. **DODO API dependency.** `get_token_price` requires `DODO_API_KEY` and a live DODO API. Without it, the smoke test correctly accepts `DODO_API_AUTH_REQUIRED` as a valid failure. Price data is unavailable without external API configuration.

3. **No mocked unit test suite.** All testing uses live tool handlers against real (or absent) services. A formal mocked provider test suite would improve long-term maintainability but is not a blocker for hackathon submission.

4. **Some token addresses are PROJECT_CONFIGURED.** USDT, WBTC, WETH, WPHRS, and FaroSwap/DODO router addresses are project constants without independent verification from official Pharos docs. This is honestly labeled in the source code.

5. **Demo `--demo` output includes MCP stderr.** When run as `node dist/index.js --demo`, the stderr shows the MCP write-tools-disabled warning before the process exits. This is cosmetic only — the demo completes successfully and exits with code 0.

### No Overclaims Found

- The project does not claim mainnet readiness.
- The project does not claim production-grade custody.
- The project does not claim formal audit status.
- Token addresses are labeled with their verification status.

---

## 11. Required Fixes Before Submission

**None.** All validation commands pass. The one fix applied during this audit (the `setTimeout` for clean demo exit on Windows) is already committed to the source.

---

## 12. Optional Improvements After Submission

1. **Mocked provider unit tests.** Add a formal test framework (vitest/jest) with mocked RPC/DODO/GoPlus providers.
2. **KMS/Vault integration.** Replace managed wallet local storage with proper KMS for any post-hackathon custody use.
3. **Verify DODO/FaroSwap router addresses.** Cross-reference against official Pharos or DODO documentation when available.
4. **Suppress MCP stderr during `--demo`.** Redirect MCP initialization warnings to avoid cosmetic noise in demo output.
5. **Daily spend accounting.** The config value `MAX_DAILY_SPEND_USD` exists but tracking is not persisted in this MVP.

---

## 13. Final Status

**Status: Ready for DoraHacks Phase 1 submission**

All validation criteria are met:
- ✅ Build passes
- ✅ TypeScript strict typecheck passes
- ✅ 37/37 smoke tests pass
- ✅ 0 high-level production vulnerabilities
- ✅ Demo runs deterministically without transactions
- ✅ npm pack is secret-safe
- ✅ MCP server starts with 27 registered tools
- ✅ CLI returns valid JSON envelope
- ✅ Pharos Skill Engine adapter is complete and agent-usable
- ✅ All security checks pass
- ✅ No overclaims found
