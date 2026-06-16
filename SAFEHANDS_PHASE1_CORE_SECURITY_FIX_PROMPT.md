# SafeHands Phase 1 — Core Security Fix Prompt

Act as a senior TypeScript maintainer, Web3 security engineer, MCP/agent tool reviewer, x402 reviewer, and QA lead.

## Repository Context

This repository is **SafeHands / safehands-pharos**, a reusable Pharos Atlantic Testnet-only Skill for AI agents.

SafeHands is intended to be a safety gateway that other agents can call before executing on-chain actions such as payments, approvals, swaps, x402 payments, custom contract calls, and risk publishing.

## Phase 1 Goal

Fix the remaining **core security P0 issues** in the TypeScript/app layer first.

Do **not** work on RiskRegistry V2 yet.  
Do **not** redeploy contracts in this phase.  
Do **not** add UI.  
Do **not** enable mainnet.  
Do **not** redesign the whole product.

This phase is only for hardening the existing policy, validation, x402, SSRF, schema, safe execution, and smoke tests.

## Important Constraints

- Keep SafeHands **Pharos Atlantic Testnet-only**.
- Mainnet/Pacific execution must remain blocked.
- `WRITE_TOOLS_ENABLED` must remain `false` by default.
- Do not make transaction execution enabled by default.
- Preserve managed wallet UX.
- Preserve existing demo flow if possible.
- Do not remove useful tools.
- Do not make broad architecture changes outside Phase 1 scope.
- Do not change Solidity contracts in this phase.
- Do not deploy a new contract in this phase.

---

# 1. Fix Invalid Approve Token Handling

## Current Problem

This kind of input must never return `ALLOW`:

```json
{
  "actionType": "approve_token",
  "chainId": 688689,
  "approvalAmount": "1",
  "approvalToken": "notaddress",
  "spender": "0x0000000000000000000000000000000000000001"
}
```

## Required Behavior

- Return `BLOCK` or validation error.
- Do not return `ALLOW`.
- Treat token registry status `INVALID_ADDRESS` as a hard failure.
- Validate `approvalToken` / `tokenAddress` as a valid EVM address where applicable.
- Invalid approval token must not be treated as unknown-but-safe.
- Invalid approval token must not silently fall through to `ALLOW`.

## Required Smoke Test

Add or update smoke test:

```txt
approve_token with approvalToken="notaddress" -> BLOCK or validation error
```

---

# 2. Fix Invalid Swap Token Handling

## Current Problem

This kind of input must never return `ALLOW`:

```json
{
  "actionType": "execute_swap",
  "chainId": 688689,
  "amount": "1",
  "tokenIn": "notaddress",
  "tokenOut": "alsoBad"
}
```

## Required Behavior

- Return `BLOCK` or validation error.
- Do not return `ALLOW`.
- Treat token registry status `INVALID_ADDRESS` for `tokenIn` and `tokenOut` as a hard failure.
- Validate `tokenIn` and `tokenOut` as valid EVM addresses where applicable.
- Invalid swap tokens must not fall through to `ALLOW`.

## Required Smoke Test

Add or update smoke test:

```txt
execute_swap with invalid tokenIn/tokenOut -> BLOCK or validation error
```

---

# 3. Fix publish_risk_score Preflight Validation

## Current Problem

This kind of input must never return `ALLOW`:

```json
{
  "actionType": "publish_risk_score",
  "chainId": 688689
}
```

Also, these cases must not return `ALLOW`:

```json
{
  "actionType": "publish_risk_score",
  "chainId": 688689,
  "walletAddress": "0x0000000000000000000000000000000000000000",
  "score": 50,
  "riskLevel": "LOW",
  "recommendation": "Safe"
}
```

```json
{
  "actionType": "publish_risk_score",
  "chainId": 688689,
  "walletAddress": "0x0000000000000000000000000000000000000001",
  "score": 999,
  "riskLevel": "LOW",
  "recommendation": "Safe"
}
```

## Required Behavior

- Return `BLOCK` or validation error.
- Require valid non-zero `walletAddress`.
- Require `score`.
- Require `score` to be between 0 and 100.
- Require non-empty `riskLevel`.
- Require non-empty `recommendation`.
- Missing or invalid `publish_risk_score` fields must never return `ALLOW`.

## Required Smoke Tests

Add or update smoke tests:

```txt
publish_risk_score missing walletAddress/score -> BLOCK or validation error
publish_risk_score score=999 -> BLOCK or validation error
publish_risk_score zero wallet -> BLOCK or validation error
```

---

# 4. Fix safehands_x402_preflight Amount Validation

## Current Problem

These inputs must never return `ALLOW`:

```json
{
  "url": "http://8.8.8.8",
  "paymentAmountUsdc": "abc"
}
```

```json
{
  "url": "http://8.8.8.8",
  "paymentAmountUsdc": "-1"
}
```

## Required Behavior

- Return `BLOCK` or validation error.
- Do not return `ALLOW`.
- Reuse shared positive amount validation.
- Reject:
  - negative values
  - zero
  - `abc`
  - `NaN`
  - `Infinity`
  - empty string
  - `null`
  - `undefined`

## Required Smoke Tests

Add or update smoke tests:

```txt
safehands_x402_preflight paymentAmountUsdc="abc" -> BLOCK or validation error
safehands_x402_preflight paymentAmountUsdc="-1" -> BLOCK or validation error
```

---

# 5. Create or Reuse Shared Validation Helpers

Create or improve shared validation helpers for security-sensitive values.

Recommended helpers:

```txt
validatePositiveAmount
parsePositiveAmountOrFail
isValidNonZeroAddress
validateTokenAddress
validateRequiredString
```

## Requirements

- Amount validation must be consistent across:
  - `safehands_preflight_check`
  - `send_payment`
  - `approve_token`
  - `execute_swap`
  - `safehands_x402_preflight`
  - `x402_pay_and_fetch`
  - `assess_risk`
  - `simulate_transaction`
  - `publish_risk_score`

- Address validation must be consistent across:
  - `recipient`
  - `toAddress`
  - `spender`
  - `walletAddress`
  - `tokenAddress`
  - `approvalToken`
  - `tokenIn`
  - `tokenOut`
  - `targetContract`
  - `paymentTokenAddress`

- Internal validation errors must not be misclassified as RPC/API failures.

---

# 6. Harden x402 Paid Challenge Validation

Review and harden:

```txt
src/tools/x402PayAndFetch.ts
```

## Required Behavior

- Do not pay an unvalidated or unparsable HTTP 402 challenge.
- If HTTP 402 is returned but the payment challenge cannot be parsed or validated, return `BLOCK` / validation error and do not call paid fetch.
- Validate the actual challenge amount is less than or equal to `maxPaymentUsdc` / effective x402 policy limit.
- Validate expected Pharos Atlantic network / chainId `688689`.
- Validate expected payment token/asset allowlist.
- Do not silently ignore challenge parse errors.
- Do not continue to payment if challenge parsing fails.
- Do not trust only user-provided `maxPaymentUsdc`.
- The server challenge must be validated before payment.

## Required Smoke or Unit Coverage

If practical, add deterministic tests for:
- malformed x402 challenge -> block/error
- challenge amount above max -> block/error
- challenge network mismatch -> block/error
- challenge token mismatch -> block/error

If full network tests are not practical, isolate challenge parsing/validation into a testable helper and test that helper.

---

# 7. Harden SSRF and Redirect SSRF Protection

SSRF protection must be consistent across x402-specific tools and general preflight.

## Required Blocking

Block at least:

```txt
localhost
127.0.0.0/8
0.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1
fc00::/7
fe80::/10
metadata IPs
suspicious local/private host formats
```

## Redirect SSRF Requirement

- Initial URL validation is not enough.
- Paid fetch must not follow redirects into private/internal/local targets.
- Use `redirect: "manual"` or an equivalent safe flow.
- Validate every redirect `Location` before following it.
- Do not let `wrapFetchWithPayment(fetch, client)` bypass redirect SSRF checks.

## Required Smoke Tests

Add or update smoke tests:

```txt
x402 localhost/private IP -> BLOCK
x402 169.254.169.254 -> BLOCK
x402 IPv6 local/link-local -> BLOCK
```

---

# 8. Enforce Strict Schemas for Security-Sensitive Tools

For security-sensitive schemas, unknown fields must not be silently ignored.

## Required Behavior

This kind of input should return validation error or clear unknown field warning if the real field is `spender`:

```json
{
  "actionType": "approve_token",
  "chainId": 688689,
  "approvalAmount": "1",
  "approvalToken": "0x0000000000000000000000000000000000000001",
  "spenderAddress": "0x0000000000000000000000000000000000000002"
}
```

## Requirements

- Use `.strict()` where appropriate.
- Do not break intended UX.
- Security-sensitive tools should not silently ignore wrong fields.
- At minimum, `safehands_preflight_check` must catch wrong/unknown fields.

## Required Smoke Test

Add or update smoke test:

```txt
approve_token with spenderAddress instead of spender -> validation error or unknown field warning
```

---

# 9. Fix safehands_safe_execute False Success

## Current Problem Class

`safehands_safe_execute` must not return a top-level success/executed state if the underlying handler failed.

This bad state must never happen:

```json
{
  "success": true,
  "executed": true,
  "executionResult": {
    "success": false
  }
}
```

## Required Behavior

- If underlying `send_payment`, `approve_token`, `execute_swap`, `x402_pay_and_fetch`, or other execution handler returns `success:false`, then `safehands_safe_execute` must also return failure or `executed:false`.
- Preserve useful error information from the underlying handler.
- Do not hide execution failure behind a successful wrapper.

## Required Smoke Test

Add or update smoke test:

```txt
safehands_safe_execute underlying failed -> success:false or executed:false
```

---

# 10. Keep Existing Good Behavior

Do not regress existing expected behavior.

These should still work:

```txt
mainnet chainId=1 -> BLOCK
send_payment missing amount -> BLOCK or validation error
send_payment amount=-1 -> BLOCK or validation error
send_payment amount=abc -> BLOCK or validation error
send_payment zero recipient -> BLOCK or validation error
approve unlimited/max -> BLOCK
x402 localhost/private IP -> BLOCK
custom_contract_call empty -> BLOCK or REQUIRE_CONFIRMATION
create_agent_wallet without agentId -> validation error
safe small Atlantic testnet payment preflight -> ALLOW
```

---

# 11. Phase 1 Smoke Test Requirements

Add or update smoke tests so the Phase 1 blocker list is covered.

Required smoke cases:

```txt
approve_token with approvalToken="notaddress" -> BLOCK or validation error
execute_swap with invalid tokenIn/tokenOut -> BLOCK or validation error
publish_risk_score missing walletAddress/score -> BLOCK or validation error
publish_risk_score score=999 -> BLOCK or validation error
publish_risk_score zero wallet -> BLOCK or validation error
safehands_x402_preflight paymentAmountUsdc="abc" -> BLOCK or validation error
safehands_x402_preflight paymentAmountUsdc="-1" -> BLOCK or validation error
safehands_safe_execute underlying failed -> success:false or executed:false
approve_token with spenderAddress instead of spender -> validation error or unknown field warning
mainnet chainId=1 -> BLOCK
unlimited/max approval -> BLOCK
x402 localhost/private IP -> BLOCK
x402 169.254.169.254 -> BLOCK
custom_contract_call empty -> BLOCK or REQUIRE_CONFIRMATION
safe small Atlantic testnet payment preflight -> ALLOW
```

Tests must be deterministic and must not require:
- real private keys
- real funded wallet
- mainnet
- external paid APIs
- non-deterministic network dependency

---

# 12. Commands to Run

After patching, run:

```bash
npm ci
npm run build
npm test
npm run demo
npm run test:all
npm pack --dry-run
```

If some script does not exist, add or update it only if appropriate for the repo.

Expected scripts:
- `npm test` should run deterministic smoke tests.
- `npm run test:all` should run build + tests + demo if already used by the repo.

Do not claim a command passed unless it was actually run.

---

# 13. Phase 1 Report Requirement

After completing fixes and validation commands, create a Phase 1 report at:

```txt
docs/reports/SAFEHANDS_PHASE1_CORE_SECURITY_FIX_REPORT.md
```

If `docs/reports` does not exist, create it.

The report must include:

## SafeHands Phase 1 Core Security Fix Report

### 1. Executive Summary
Briefly explain what was fixed in Phase 1.

### 2. Scope
List the Phase 1 scope:
- invalid token blocking
- invalid swap token blocking
- publish_risk_score validation
- x402 amount validation
- x402 challenge hardening
- SSRF / redirect SSRF
- strict schema validation
- safe_execute failure propagation
- smoke tests

### 3. Files Changed
Use table format:

| File | Purpose |
|---|---|
| `src/...` | ... |

### 4. Security Fixes
For each fix, include:
- previous issue
- fix applied
- expected behavior after fix

Required subsections:
- Invalid approve token blocking
- Invalid swap token blocking
- publish_risk_score validation
- safehands_x402_preflight amount validation
- x402 paid challenge validation
- SSRF / redirect SSRF protection
- Strict schema validation
- safehands_safe_execute failure propagation

### 5. Test Results
Include exact commands run and whether they passed:
- `npm ci`
- `npm run build`
- `npm test`
- `npm run demo`
- `npm run test:all`
- `npm pack --dry-run`

Do not claim PASS for commands not actually run.

### 6. Remaining Known Limitations
Mention only real remaining limitations.
Do not invent issues.
Do not claim mainnet readiness.
Mention that RiskRegistry V2 and authorization-gate redesign are Phase 2/3, not Phase 1, if not implemented yet.

### 7. Phase 1 Verdict
Use one:
- `PHASE 1 COMPLETE`
- `PHASE 1 COMPLETE WITH MINOR LIMITATIONS`
- `PHASE 1 NOT COMPLETE`

Explain briefly.

---

# 14. Final Response After Work

After patching, testing, and creating the Phase 1 report, print:

1. Files changed.
2. Exact commands run.
3. Build/test/demo/pack results.
4. Phase 1 report path.
5. Remaining known limitations, if any.
6. Confirm that no contract redeploy was performed in Phase 1.

Expected: no contract redeploy in Phase 1.
