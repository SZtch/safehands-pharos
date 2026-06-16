# SafeHands Phase 3 — RiskRegistry V2 Integration + Managed Execution Gate Prompt

Act as a senior TypeScript maintainer, Web3 security engineer, MCP/agent tool reviewer, smart-contract integration engineer, QA lead, and Pharos Atlantic Testnet production-readiness auditor.

## Repository Context

This repository is **SafeHands / safehands-pharos**, an open-source reusable Pharos Skill for AI agents.

SafeHands is a Pharos Atlantic Testnet-only safety gateway that other AI agents can call before executing on-chain actions such as payments, approvals, swaps, x402 payments, custom contract calls, risk reports, and managed agent wallet checks.

## Current Status

Phase 1 is complete:
- Core validation/security fixes passed.
- Invalid approve tokens, invalid swap tokens, invalid `publish_risk_score`, invalid x402 amounts, schema issues, SSRF issues, and false success wrapping were addressed.
- 52/52 smoke tests passed.

Phase 2 is complete:
- `RiskRegistryV2.sol` exists.
- RiskRegistry V2 contract tests passed.
- RiskRegistry V2 was deployed to Pharos Atlantic Testnet.

## Deployed RiskRegistry V2

Use this deployed address:

```txt
Network: Pharos Atlantic Testnet
Chain ID: 688689
RiskRegistry V2 Address: 0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
Owner / Deployer: 0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5
```

If the Phase 2 report still says deployment deferred, update it to reflect that RiskRegistry V2 is deployed.

---

# Phase 3 Goal

Integrate RiskRegistry V2 into the SafeHands app/tool layer.

RiskRegistry V2 must become the real on-chain integration for:

```txt
authorized-agent registry + on-chain risk memory / risk attestation registry
```

Phase 3 must connect the deployed V2 contract to:

- constants/config
- ABI imports
- risk publishing
- risk reporting
- managed wallet authorization checks
- optional operator auto-authorization
- deterministic tests

---

# Hard Constraints

Do **not** undo Phase 1 fixes.

Do **not** redeploy contracts in Phase 3 unless explicitly instructed by the operator.

Do **not** enable mainnet or Pacific.

Do **not** add UI.

Do **not** require normal users to provide private keys.

Do **not** force RiskRegistry authorization for preflight/read-only mode.

Do **not** force RiskRegistry authorization for user-signed/prepared transaction mode.

Do **not** force every SafeHands user to manually authorize a wallet.

Do **not** commit `.env`, private keys, mnemonics, API keys, RPC secrets, owner keys, or real wallet secrets.

Do **not** print or log private keys.

Do **not** put real private keys in README, `.env.example`, reports, screenshots, ZIP artifacts, or generated docs.

Keep SafeHands **Pharos Atlantic Testnet-only**.

---

# Core UX Rule

SafeHands must support layered execution modes.

## 1. Preflight / Read-only Mode

Any agent/user can call preflight and read-only tools without RiskRegistry authorization.

Examples:

```txt
safehands_preflight_check
safehands_x402_preflight
safehands_wallet_health
safehands_risk_report
explain_risk
token_registry_status
query_risk_registry
```

Required behavior:

```txt
No wallet authorization required
No funded wallet required
No private key required
No WRITE_TOOLS_ENABLED required
No managed wallet required
```

## 2. User-signed / Prepared Transaction Mode

SafeHands may validate and prepare a transaction, but the user signs with their own wallet.

Required behavior:

```txt
No RiskRegistry authorization required by default
SafeHands is not the signer
SafeHands only provides decision / risk report / prepared transaction data
```

## 3. Managed Agent Execution Mode

SafeHands-managed agent wallet executes the transaction.

Required behavior:

```txt
RiskRegistry V2 authorization is required once per managed agent wallet
wallet must be funded
policy/preflight must pass
execution only allowed if ALLOW
```

## 4. Advanced Local Env Wallet Mode

Advanced local/self-hosted users may use:

```env
WALLET_MODE=env
PRIVATE_KEY=0xTESTNET_PRIVATE_KEY
WRITE_TOOLS_ENABLED=true
```

Required behavior:

```txt
Still testnet-only
Still preflight/policy-gated
Do not require RiskRegistry authorization by default unless an explicit config flag enables it
Never log or commit private keys
```

---

# 1. Update Constants and Config

Update the app constants/config to include RiskRegistry V2.

Required:

```ts
export const RISK_REGISTRY_V2_ADDRESS = "0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25";
```

Use the repo’s existing constants style.

If `RISK_REGISTRY_ADDRESS` already points to V1, do not silently break compatibility.

Recommended:

```txt
RISK_REGISTRY_ADDRESS = legacy V1 if needed
RISK_REGISTRY_V2_ADDRESS = deployed V2
DEFAULT_RISK_REGISTRY_VERSION = "v2"
```

If `.env.example` includes `RISK_REGISTRY_V2_ADDRESS`, keep it as a placeholder or the public deployed address only. Do not include secrets.

Required defaults or config keys:

```env
RISK_REGISTRY_V2_ADDRESS=0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
REQUIRE_AUTHORIZED_AGENT_FOR_WRITE=true
AUTO_AUTHORIZE_AGENT_WALLET=false
RISK_REGISTRY_OWNER_PRIVATE_KEY=0xOWNER_TESTNET_KEY
```

Important:

- `RISK_REGISTRY_OWNER_PRIVATE_KEY` must be placeholder only in `.env.example`.
- `AUTO_AUTHORIZE_AGENT_WALLET=false` by default.
- `WRITE_TOOLS_ENABLED=false` remains default.

---

# 2. Update ABI / Contract Client

Update contract client code to use V2 ABI for V2 functions.

Required V2 functions to support:

```txt
isAuthorizedAgent(address)
setAuthorizedAgent(address,bool)
publishRiskRecord(...)
getRiskRecord(uint256)
getLatestRiskRecordForWallet(address)
getRiskRecordsForWallet(address)
getRiskRecordByActionHash(bytes32)
isRiskRecordValid(uint256)
```

Use:

```txt
contracts/RiskRegistryV2.json
```

or the generated artifact path used by the repo.

Do not remove V1 ABI unless unused and safe to remove.

---

# 3. Update publish_risk_score Tool to Use V2

Update `publish_risk_score` to publish a V2 risk record.

The V2 contract method should be:

```txt
publishRiskRecord(
  wallet,
  agent,
  actionHash,
  score,
  riskLevel,
  recommendation,
  policyVersion,
  evidenceURI,
  expiresAt
)
```

## Required Input Handling

`publish_risk_score` must require or safely derive:

```txt
walletAddress
agentAddress or signer/managed wallet address
actionHash
score
riskLevel
recommendation
policyVersion
evidenceURI optional
expiresAt optional, 0 allowed
```

Validation requirements:

```txt
walletAddress must be valid non-zero EVM address
agentAddress must be valid non-zero EVM address
actionHash must not be bytes32(0)
score must be 0-100
riskLevel required
recommendation required
policyVersion required
expiresAt = 0 allowed
expiresAt > current time if non-zero
```

## actionHash Recommendation

If an explicit `actionHash` is not provided, create a deterministic hash from relevant action data.

Example concept:

```txt
keccak256(chainId, actionType, walletAddress, target, token, amount, policyVersion)
```

Do not use a weak or random hash for the action attestation.

If deriving `actionHash` is not safe from available input, return validation error instead of publishing.

## Required Behavior

- Use V2 ABI/address.
- Do not call V1 publish method by default.
- Do not publish if validation fails.
- Do not publish if signer is not authorized and not owner/admin.
- Return clear errors:
  - `VALIDATION_ERROR`
  - `RISK_REGISTRY_UNAVAILABLE`
  - `UNAUTHORIZED_PUBLISHER`
  - `CHAIN_MISMATCH`
  - `WRITE_TOOLS_DISABLED`
- Do not leak private key or signer internals.

---

# 4. Update risk_report Tool to Query V2

Update `risk_report` / `safehands_risk_report` to include RiskRegistry V2 information when available.

Required output fields or equivalent:

```json
{
  "riskRegistry": {
    "version": "v2",
    "address": "0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25",
    "walletAddress": "0x...",
    "authorized": true,
    "hasRiskRecord": true,
    "latestRecord": {
      "recordId": "1",
      "score": 20,
      "riskLevel": "LOW",
      "recommendation": "...",
      "policyVersion": "v1",
      "actionHash": "0x...",
      "createdAt": "...",
      "expiresAt": "...",
      "revoked": false,
      "valid": true
    }
  }
}
```

If no on-chain risk record exists, return clearly:

```txt
No on-chain risk record found for this wallet.
```

Do not treat no record as a crash.

If RPC is unavailable, return graceful degraded output:

```txt
RiskRegistry unavailable; local risk evaluation still completed.
```

Do not allow RPC failure to break local preflight/risk logic if the local result can still be produced.

---

# 5. Add Managed Wallet Authorization Check

Add a helper such as:

```txt
checkManagedWalletAuthorization(agentId, walletAddress)
```

or equivalent.

This check must be used only for **managed agent execution mode**.

## Write Actions Requiring Managed Wallet Authorization

When the signer/wallet mode is SafeHands-managed execution and `REQUIRE_AUTHORIZED_AGENT_FOR_WRITE=true`, these actions must require V2 authorization:

```txt
send_payment
approve_token
execute_swap
x402_pay_and_fetch
publish_risk_score
custom_contract_call
```

## Required Behavior

Before executing with a SafeHands-managed wallet:

```txt
1. Ensure agentId is valid
2. Ensure managed wallet exists or is created safely
3. Check RiskRegistry V2 isAuthorizedAgent(walletAddress)
4. If not authorized:
   return REQUIRE_AUTHORIZATION / AGENT_WALLET_NOT_AUTHORIZED
5. If authorized:
   continue funding check
6. If funded:
   continue policy + preflight
7. Execute only if preflight ALLOW
```

## Must Not Apply To

Do not apply this authorization gate to:

```txt
safehands_preflight_check
safehands_x402_preflight
safehands_risk_report
explain_risk
token_registry_status
get_wallet_balance
wallet_health
user-signed/prepared transaction mode
advanced env wallet mode by default
```

---

# 6. Add Optional Operator Auto-Authorization

Add optional operator-only auto-authorization.

Config:

```env
AUTO_AUTHORIZE_AGENT_WALLET=false
RISK_REGISTRY_OWNER_PRIVATE_KEY=0xOWNER_TESTNET_KEY
```

Required behavior:

```txt
if AUTO_AUTHORIZE_AGENT_WALLET=true
and RISK_REGISTRY_OWNER_PRIVATE_KEY exists
and target chainId is 688689
and walletAddress is valid
and wallet is not already authorized
then owner signer calls setAuthorizedAgent(walletAddress, true)
```

Important:

- Default must be false.
- Only testnet.
- Do not auto-authorize without owner key.
- Do not print/log owner private key.
- Do not authorize zero address.
- Do not authorize missing/undefined agent wallet.
- Do not authorize arbitrary user-signed wallets by default.
- Auto-authorize is for managed agent wallet onboarding/demo/operator flow.

Required response fields:

```json
{
  "riskRegistryAuthorized": true,
  "autoAuthorized": true,
  "authorizationTxHash": "0x..."
}
```

If auto-authorization is disabled or unavailable:

```json
{
  "riskRegistryAuthorized": false,
  "requiresAuthorization": true,
  "autoAuthorized": false,
  "authorizationReason": "AUTO_AUTHORIZE_AGENT_WALLET is disabled"
}
```

---

# 7. Add Funding Gate Output

Managed wallet execution must clearly report funding status.

If the wallet is authorized but has no PHRS for gas:

```json
{
  "decision": "REQUIRE_FUNDING",
  "requiresFunding": true,
  "walletAddress": "0x...",
  "network": "Pharos Atlantic Testnet",
  "chainId": 688689
}
```

Funding gate should not apply to read-only/preflight mode.

---

# 8. Preserve Existing Good UX

Normal user/reviewer should still be able to run:

```txt
preflight
risk report
wallet health
x402 preflight
token registry status
demo
```

without:

```txt
private key
funded wallet
RiskRegistry authorization
WRITE_TOOLS_ENABLED=true
manual wallet authorization
```

This is critical for hackathon UX.

---

# 9. Update CLI/MCP Outputs

Where relevant, execution/preflight outputs should distinguish:

```txt
mode: preflight
mode: user_signed
mode: managed_execution
mode: env_wallet
```

or equivalent internal status.

Do not break existing CLI commands.

Add clear error codes:

```txt
AGENT_WALLET_NOT_AUTHORIZED
REQUIRE_AUTHORIZATION
REQUIRE_FUNDING
RISK_REGISTRY_UNAVAILABLE
CHAIN_MISMATCH
WRITE_TOOLS_DISABLED
```

---

# 10. Tests Required

Add deterministic tests for Phase 3.

Avoid requiring real funded wallets or live private keys in unit/smoke tests.

Use mocks/stubs where needed.

Required test cases:

## Constants / ABI

```txt
RiskRegistry V2 address is configured
V2 ABI can encode/decode expected functions
```

## risk_report

```txt
risk_report includes RiskRegistry V2 address/version
risk_report handles no on-chain record gracefully
risk_report handles RPC failure gracefully
risk_report includes authorization status when wallet is provided
```

## publish_risk_score

```txt
publish_risk_score uses V2 method shape
missing actionHash or unsafe derivation -> validation error
score > 100 -> validation error
zero wallet -> validation error
missing policyVersion -> validation error
WRITE_TOOLS_ENABLED=false blocks publish
```

## Managed Authorization Gate

```txt
managed execution with unauthorized wallet -> REQUIRE_AUTHORIZATION / AGENT_WALLET_NOT_AUTHORIZED
managed execution with authorized but unfunded wallet -> REQUIRE_FUNDING
managed execution with authorized + funded + preflight ALLOW -> reaches execution path
preflight/read-only does not require authorization
user-signed/prepared mode does not require authorization
env wallet mode does not require RiskRegistry authorization by default
```

## Auto-Authorization

```txt
AUTO_AUTHORIZE_AGENT_WALLET=false -> does not auto-authorize
AUTO_AUTHORIZE_AGENT_WALLET=true but no owner key -> does not auto-authorize, returns clear reason
AUTO_AUTHORIZE_AGENT_WALLET=true with owner key -> calls setAuthorizedAgent in mocked/stubbed test
zero wallet is never auto-authorized
```

## Regression

```txt
Phase 1 invalid approve token still blocked
Phase 1 invalid swap token still blocked
Phase 1 publish_risk_score invalid still blocked
Phase 1 x402 invalid amount still blocked
mainnet chainId=1 still blocked
unlimited approval still blocked
x402 SSRF still blocked
demo still passes
```

---

# 11. Commands to Run

Run:

```bash
npm run build
npm test
npm run demo
npm run test:contracts
npm run test:all
npm pack --dry-run
```

If live read-only RPC checks are available and safe, optionally run them against Pharos Atlantic Testnet.

Do not claim a command passed unless it was actually run.

Do not require live private keys for deterministic tests.

---

# 12. Phase 3 Report Requirement

Create:

```txt
docs/reports/SAFEHANDS_PHASE3_RISKREGISTRY_V2_INTEGRATION_REPORT.md
```

The report must include:

## SafeHands Phase 3 RiskRegistry V2 Integration Report

### 1. Executive Summary

Explain V2 is now integrated into the app/tool layer.

### 2. Scope

Mention:
- constants/config update
- ABI update
- risk publishing update
- risk report query update
- managed wallet authorization gate
- optional operator auto-authorization
- funding gate output
- no mainnet enablement
- no UI

### 3. Deployed Contract

Include:

```txt
RiskRegistry V2 address:
0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25

Owner/deployer:
0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5

Network:
Pharos Atlantic Testnet

Chain ID:
688689
```

### 4. Execution Modes

Document clearly:

```txt
Preflight/read-only: no RiskRegistry authorization required
User-signed/prepared transaction: no RiskRegistry authorization required
Managed agent execution: RiskRegistry authorization required
Advanced env wallet: no RiskRegistry authorization by default unless explicitly configured
Operator/demo: optional auto-authorize
```

### 5. Files Changed

Use table format:

| File | Purpose |
|---|---|
| `src/...` | ... |

### 6. Security Controls

Include:
- V2 address and chain guard
- authorization gate for managed execution
- no authorization requirement for preflight/user-signed
- funding gate
- auto-authorize default false
- no private key logging
- Phase 1 regression preserved

### 7. Tests

List commands and results exactly.

### 8. Remaining Known Limitations

Be honest.

Mention if:
- auto-authorization was only mocked/tested
- live contract read was not run
- user-signed prepared tx mode is documented but not fully implemented yet
- policy-per-agent customization is Phase 4

### 9. Phase 4 Handoff

List:
- UX/env defaults
- per-agent policy customization
- CLI/MCP documentation cleanup
- README/SKILL.md updates
- package/version cleanup
- final x402/idempotency docs/tests

### 10. Phase 3 Verdict

Use one:

```txt
PHASE 3 COMPLETE
PHASE 3 COMPLETE WITH MINOR LIMITATIONS
PHASE 3 NOT COMPLETE
```

---

# 13. Final Response After Work

After patching, testing, and creating the report, print:

1. Files changed.
2. Exact commands run.
3. Build/test/demo/contract/pack results.
4. Phase 3 report path.
5. Remaining known limitations.
6. Confirm RiskRegistry V2 address used.
7. Confirm no mainnet/Pacific enablement.
8. Confirm no private keys were committed or logged.
9. Confirm preflight/user-signed modes do not require RiskRegistry authorization.
10. Confirm managed execution requires RiskRegistry authorization.

---

# 14. Acceptance Criteria

Phase 3 is acceptable if:

```txt
RiskRegistry V2 address is configured
V2 ABI/client is used by app tools
publish_risk_score uses or is prepared to use V2 publishRiskRecord
risk_report can query V2 / degrade gracefully
managed wallet execution has authorization gate
preflight/read-only mode does not require authorization
user-signed mode does not require authorization
env wallet mode does not require authorization by default
optional auto-authorize is safe and default false
funding gate output is clear
Phase 1 security tests still pass
Phase 2 contract tests still pass
no secrets committed
mainnet/Pacific remains blocked
Phase 3 report exists
```
