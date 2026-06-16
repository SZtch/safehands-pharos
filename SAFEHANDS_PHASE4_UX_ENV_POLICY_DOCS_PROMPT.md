# SafeHands Phase 4 — UX, Env, Policy, CLI/MCP, Docs, and Package Cleanup Prompt

Act as a senior TypeScript maintainer, Web3 product UX reviewer, MCP/agent tool reviewer, DevOps reviewer, documentation reviewer, QA lead, and Pharos hackathon submission-readiness auditor.

## Repository Context

This repository is **SafeHands / safehands-pharos**, an open-source reusable Pharos Skill for AI agents.

SafeHands is a Pharos Atlantic Testnet-only safety gateway that other AI agents can call before executing on-chain actions such as:

- payments
- approvals
- swaps
- x402 payments
- custom contract calls
- risk reports
- managed agent wallet checks

## Current Status

Phase 1 is complete:
- Core app-layer security validation is fixed.
- Invalid approval tokens, invalid swap tokens, invalid `publish_risk_score`, invalid x402 amounts, SSRF, strict schema, and `safe_execute` false-success issues were addressed.
- Smoke tests passed.

Phase 2 is complete:
- `RiskRegistryV2.sol` was created and tested.
- RiskRegistry V2 was deployed on Pharos Atlantic Testnet.

Phase 3 is complete with minor limitations:
- RiskRegistry V2 is integrated into app/tool layer.
- `publish_risk_score`, `query_risk_registry`, and `safehands_risk_report` use V2.
- Managed execution is gated by RiskRegistry V2 authorization.
- Preflight/read-only mode does not require authorization.
- User-signed/env wallet mode does not require RiskRegistry authorization by default.
- Per-agent policy customization is deferred to this phase.

## Deployed RiskRegistry V2

Use this deployed address:

```txt
Network: Pharos Atlantic Testnet
Chain ID: 688689
RiskRegistry V2 Address: 0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
Owner / Deployer: 0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5
```

---

# Phase 4 Goal

Make SafeHands easy to use, easy to review, and clearly reusable as a Pharos Skill.

Phase 4 focuses on:

```txt
UX cleanup
env/default config cleanup
per-agent policy customization
CLI/MCP tool clarity
docs alignment
package/version cleanup
x402/idempotency documentation
final hackathon positioning
```

This phase should make SafeHands feel like a polished reusable Skill, not a pile of tools.

---

# Hard Constraints

Do **not** undo Phase 1 fixes.

Do **not** undo Phase 2 contract artifacts.

Do **not** undo Phase 3 RiskRegistry V2 integration.

Do **not** redeploy contracts in Phase 4.

Do **not** enable mainnet or Pacific.

Do **not** add a big UI/frontend.

Do **not** force normal users to provide private keys.

Do **not** force every user to authorize a wallet.

Do **not** force RiskRegistry authorization for preflight/read-only mode.

Do **not** force RiskRegistry authorization for user-signed/prepared transaction mode.

Do **not** commit `.env`, private keys, mnemonics, API keys, RPC secrets, owner keys, or real wallet secrets.

Do **not** print or log private keys.

Do **not** put real private keys in README, `.env.example`, reports, screenshots, ZIP artifacts, or generated docs.

Keep SafeHands **Pharos Atlantic Testnet-only**.

---

# 1. Final Product Positioning

Update docs and tool descriptions to consistently position SafeHands as:

```txt
SafeHands is an open-source reusable Pharos Skill that gives AI agents a safety gateway before on-chain actions.

Any agent can use its preflight and risk tools freely, while managed execution tools are gated by authorization, funding checks, policy limits, and SafeHands risk approval.
```

Avoid claiming:

```txt
mainnet-ready
production custody
audited mainnet wallet
unrestricted execution
all users must authorize wallet
```

Use the correct wording:

```txt
Pharos Atlantic Testnet-only
production-inspired safety architecture
not audited for mainnet custody
mainnet/Pacific blocked by design
```

---

# 2. Execution Mode UX Cleanup

Docs, README, SKILL.md, and CLI/MCP descriptions must clearly explain these modes:

## A. Preflight / Read-only Mode

```txt
No wallet authorization required
No private key required
No funded wallet required
No WRITE_TOOLS_ENABLED required
Best for agent safety checks and reviewer demo
```

Examples:
- `safehands_preflight_check`
- `safehands_x402_preflight`
- `safehands_risk_report`
- `safehands_wallet_health`
- `token_registry_status`
- `explain_risk`
- `query_risk_registry`

## B. User-signed / Prepared Transaction Mode

```txt
SafeHands validates and explains risk
User signs externally with their own wallet
No RiskRegistry authorization required by default
No hosted backend should ask users to paste private keys
```

If this mode is not fully implemented as a separate handler, document honestly:

```txt
Currently SafeHands provides preflight decisions and transaction safety context for user-signed flows; formal prepared-transaction output is roadmap / future enhancement.
```

Do not overclaim.

## C. Managed Agent Execution Mode

```txt
SafeHands-managed wallet executes
RiskRegistry V2 authorization required once per managed wallet
Wallet must be funded with PHRS testnet
Preflight/policy must ALLOW
WRITE_TOOLS_ENABLED must be true for execution
```

## D. Advanced Local Env Wallet Mode

```env
WALLET_MODE=env
PRIVATE_KEY=0xTESTNET_PRIVATE_KEY
WRITE_TOOLS_ENABLED=true
```

Document as:

```txt
Advanced local/self-hosted testnet mode only
Not default UX
Not for hosted backend user key collection
Still preflight/policy-gated
RiskRegistry authorization not required by default unless explicitly configured
```

## E. Operator/Demo Mode

```env
AUTO_AUTHORIZE_AGENT_WALLET=true
RISK_REGISTRY_OWNER_PRIVATE_KEY=0xOWNER_TESTNET_KEY
```

Document as:

```txt
Operator-only
Testnet-only
Never commit owner key
Used for managed wallet onboarding/demo
```

---

# 3. Env and Defaults Cleanup

The project should work in safe read/preflight mode without the user filling a complicated `.env`.

## Required Safe Defaults

Add or confirm safe fallback defaults in code/config:

```env
PHAROS_ENVIRONMENT=atlantic-testnet
PHAROS_CHAIN_ID=688689
PHAROS_RPC_URL=https://atlantic.dplabs-internal.com
WALLET_MODE=managed-testnet
AUTO_CREATE_AGENT_WALLET=true
REQUIRE_AUTHORIZED_AGENT_FOR_WRITE=true
WRITE_TOOLS_ENABLED=false
AUTO_AUTHORIZE_AGENT_WALLET=false
RISK_REGISTRY_V2_ADDRESS=0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
```

Important:
- `WRITE_TOOLS_ENABLED=false` must remain default.
- `AUTO_AUTHORIZE_AGENT_WALLET=false` must remain default.
- `RISK_REGISTRY_OWNER_PRIVATE_KEY` must not have a real value in examples.
- `.env.example` should use placeholders only for secrets.
- Normal preflight/read-only usage should not require `.env`.

## `.env.example` Cleanup

`.env.example` must clearly separate:

### Safe public/default values

```env
PHAROS_ENVIRONMENT=atlantic-testnet
PHAROS_CHAIN_ID=688689
PHAROS_RPC_URL=https://atlantic.dplabs-internal.com
RISK_REGISTRY_V2_ADDRESS=0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
WRITE_TOOLS_ENABLED=false
WALLET_MODE=managed-testnet
AUTO_CREATE_AGENT_WALLET=true
REQUIRE_AUTHORIZED_AGENT_FOR_WRITE=true
AUTO_AUTHORIZE_AGENT_WALLET=false
```

### Advanced local/self-hosted execution only

```env
# WALLET_MODE=env
# PRIVATE_KEY=0xTESTNET_PRIVATE_KEY_ONLY
# WRITE_TOOLS_ENABLED=true
```

### Operator-only managed wallet authorization

```env
# AUTO_AUTHORIZE_AGENT_WALLET=true
# RISK_REGISTRY_OWNER_PRIVATE_KEY=0xOWNER_TESTNET_PRIVATE_KEY_ONLY
```

Add warning comments:
- never paste private keys into hosted backends
- never commit `.env`
- testnet-only

---

# 4. Per-Agent Policy Customization

SafeHands must not force one tiny global hardcoded limit for every user/agent.

Implement or formalize per-agent policy customization.

## Policy Principle

Use this hierarchy:

```txt
1. Hard safety rules
   Cannot be overridden.

2. Backend/operator defaults
   Safe fallback if no policy exists.

3. User/agent policy
   Defines the agent's own limits/profile.

4. Runtime request
   The actual action/amount/recipient/token.

5. SafeHands decision
   ALLOW / BLOCK / REQUIRE_CONFIRMATION / REQUIRE_AUTHORIZATION / REQUIRE_FUNDING
```

## Hard Safety Rules

These must not be bypassable by user policy:

```txt
mainnet/Pacific blocked
chainId mismatch blocked
invalid amount blocked
zero address blocked
invalid token blocked
SSRF/redirect SSRF blocked
unlimited approval blocked by default
unsafe x402 challenge blocked
unauthorized managed wallet execution blocked
```

## Policy Profiles

Add or document profiles:

```txt
conservative
balanced
advanced
custom
```

Example defaults:

```json
{
  "profile": "balanced",
  "limits": {
    "maxPaymentPHRS": "1",
    "maxSwapPHRS": "10",
    "maxDailySpendPHRS": "25",
    "maxX402PaymentUSDC": "0.1",
    "maxApprovalUSDC": "50"
  },
  "flags": {
    "allowUnknownTokens": false,
    "allowCustomContractCalls": false,
    "requireConfirmationAboveRisk": "MEDIUM"
  }
}
```

For an advanced agent, allow higher limits if explicitly configured:

```json
{
  "profile": "advanced",
  "limits": {
    "maxSwapPHRS": "1000",
    "maxDailySpendPHRS": "5000"
  }
}
```

Important:
- Large amounts like `1000 PHRS` should not be automatically blocked just because a small backend default exists.
- Large amounts should be evaluated against that agent's policy.
- If an agent has no policy, use the safe default policy.
- Do not let prompt/runtime injection silently increase policy limits.
- Raising policy limits should require explicit saved policy config or operator-approved configuration.

## Suggested Storage

If the repo does not already have this, implement minimal file-based policy storage:

```txt
.agents/policies/default.json
.agents/policies/{agentId}.json
```

or an equivalent repo-appropriate local storage path.

Avoid storing secrets here.

## Suggested Tools / CLI

If appropriate, add simple CLI/tool support:

```txt
get_agent_policy
set_agent_policy
```

or document policy files if adding tools would be too large.

If adding MCP tools, ensure schemas are strict and tests are deterministic.

---

# 5. CLI/MCP UX Cleanup

Update CLI/MCP descriptions and help output so a reviewer immediately understands:

```txt
What each tool does
Which mode it belongs to
Whether it can execute transactions
Whether it needs WRITE_TOOLS_ENABLED
Whether it needs managed wallet authorization
Whether it needs funding
```

## Required Tool Grouping in Docs

Group tools into capabilities:

```txt
1. Safety Preflight
2. Wallet + Agent Authorization
3. Risk Scoring + RiskRegistry
4. Payment + x402 Safety
5. Swap + Approval Safety
6. Simulation + Monitoring
```

## Public Reusable Tools

Mark as public/reusable read/preflight tools:

```txt
safehands_preflight_check
safehands_x402_preflight
safehands_risk_report
safehands_wallet_health
explain_risk
token_registry_status
query_risk_registry
```

## Reusable But Gated Execution Tools

Mark as reusable but gated:

```txt
send_payment
approve_token
execute_swap
x402_pay_and_fetch
publish_risk_score
custom_contract_call
safehands_safe_execute
```

Required wording:

```txt
Execution tools are reusable, but intentionally gated behind WRITE_TOOLS_ENABLED, managed wallet authorization where applicable, funding checks, policy limits, and preflight approval.
```

---

# 6. x402 UX and Idempotency Docs/Tests

SafeHands x402 should be described as:

```txt
SafeHands makes x402 safer for autonomous agents by validating HTTP 402 payment requirements before signing or settling any payment.
```

Document:

```txt
safehands_x402_preflight = no payment, no authorization
x402_pay_and_fetch = gated execution
user-signed x402 = no RiskRegistry authorization by default
managed-wallet x402 = RiskRegistry authorization required
```

## Required Safety Checks

Docs/tests should mention:

```txt
SSRF / redirect SSRF
valid positive amount
challenge parse/validation
Pharos Atlantic network
allowlisted payment token
policy limit
idempotency / replay awareness
```

If idempotency is not fully implemented, document honestly:

```txt
x402 payment idempotency/replay hardening is documented and partially guarded by policy/preflight; full paymentId/requestHash retry cache is a future hardening item.
```

Do not claim full idempotency if not implemented.

---

# 7. README / SKILL.md / Docs Alignment

Update all relevant docs so they do not contradict each other.

Check and align:

```txt
README.md
SKILL.md
skill/SKILL.md
.agents/skill/safehands/SKILL.md
SECURITY.md
EXAMPLES.md if present
docs/reports/*.md
package.json description/version
```

Required docs content:

```txt
SafeHands is reusable Pharos Skill
Pharos Atlantic Testnet-only
RiskRegistry V2 deployed address
execution modes
authorization only for managed execution
preflight/user-signed no authorization
advanced env wallet mode
operator auto-authorize mode
per-agent policy
x402 safety model
how to run demo
how to run tests
how to pack
submission-ready quickstart
```

Remove or correct:
- ghost docs references
- old V1-only contract references as active default
- claims that all users must authorize
- claims that mainnet/Pacific is supported
- stale package names/versions
- stale tool counts if changed

---

# 8. Package and Version Cleanup

Decide and apply appropriate version bump.

Recommended:

```txt
1.7.0
```

because Phase 3/4 added V2 integration and UX/policy cleanup.

Update consistently:

```txt
package.json
package-lock.json
README if version is shown
SKILL.md files if version is shown
reports if version is shown
```

Run:

```bash
npm pack --dry-run
```

Check that important files are included:
- `dist/`
- `contracts/RiskRegistryV2.sol`
- `contracts/RiskRegistryV2.json`
- `SKILL.md`
- `skill/SKILL.md` if used
- `.agents/skill/safehands/SKILL.md` if used
- `README.md`
- `SECURITY.md`
- key docs/reports

Do not include:
- `.env`
- private keys
- local wallet files
- node_modules
- screenshots with secrets

---

# 9. Security Hygiene Check

Run secret/hygiene checks.

Suggested commands:

```bash
git status
git ls-files | grep -E '(^|/)\.env$' || true
grep -R "PRIVATE_KEY=" -n . --exclude-dir=node_modules --exclude-dir=.git || true
grep -R "RISK_REGISTRY_OWNER_PRIVATE_KEY=0x[0-9a-fA-F]" -n . --exclude-dir=node_modules --exclude-dir=.git || true
grep -R "0x[a-fA-F0-9]\{64\}" -n . --exclude-dir=node_modules --exclude-dir=.git || true
```

Important:
- `.env.example` placeholders are okay.
- Real private keys are not okay.
- Contract addresses are okay.
- Do not print secrets in reports.

---

# 10. Tests Required

Add/update deterministic tests for Phase 4.

Required test coverage:

```txt
default env config works for preflight without .env
WRITE_TOOLS_ENABLED defaults false
AUTO_AUTHORIZE_AGENT_WALLET defaults false
RiskRegistry V2 address defaults correctly
preflight does not require authorization
user-signed mode/docs do not imply authorization
managed execution still requires authorization
env wallet mode does not require RiskRegistry authorization by default
agent policy default loads
agent custom policy loads
large swap amount is evaluated against agent policy, not one tiny global default
hard safety rules still override custom policy
x402 invalid amount still blocked
x402 SSRF still blocked
mainnet chainId still blocked
unlimited approval still blocked
demo still passes
```

If docs-only changes are made for some items, add smoke checks where practical.

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

Also run security/hygiene grep checks from section 9.

Do not claim a command passed unless it was actually run.

Do not run `npm audit fix --force` unless you are certain it will not break the project. If audit issues remain, document them honestly in the report.

---

# 12. Phase 4 Report Requirement

Create:

```txt
docs/reports/SAFEHANDS_PHASE4_UX_ENV_POLICY_DOCS_REPORT.md
```

The report must include:

## SafeHands Phase 4 UX / Env / Policy / Docs Report

### 1. Executive Summary

Explain that Phase 4 polished SafeHands as a reusable Pharos Skill.

### 2. Scope

Mention:
- UX mode documentation
- env/default cleanup
- per-agent policy customization
- CLI/MCP clarity
- docs alignment
- x402/idempotency documentation
- package/version cleanup
- no contract redeploy
- no mainnet enablement

### 3. Execution Modes

Document:
- preflight/read-only
- user-signed/prepared
- managed execution
- env wallet
- operator/demo

### 4. Env / Secret Handling

Explain:
- normal user does not need private key
- hosted backend must not collect private keys
- advanced local mode can use testnet private key
- owner key is operator-only
- no secrets committed

### 5. Policy System

Explain:
- hard safety rules
- default policy
- per-agent policy
- large amount handling
- example `1000 PHRS` swap policy
- prompt injection protection around policy increases

### 6. Files Changed

Use table format:

| File | Purpose |
|---|---|
| `src/...` | ... |

### 7. Docs Updated

List docs updated:
- README
- SKILL.md files
- SECURITY.md
- EXAMPLES.md
- package metadata
- any report updates

### 8. Test Results

List exact commands and results:
- `npm run build`
- `npm test`
- `npm run demo`
- `npm run test:contracts`
- `npm run test:all`
- `npm pack --dry-run`
- security/hygiene checks

### 9. Remaining Known Limitations

Be honest.

Mention if:
- user-signed prepared transaction mode is still documentation/roadmap
- x402 full idempotency cache is future work
- npm audit vulnerabilities remain
- live V2 read/auto-authorize tests are not run

### 10. Phase 5 Handoff

List what remains for final phase:
- final full validation
- final submission report
- final ZIP/package review
- final README/SKILL quickstart check
- final secret scan
- final reviewer demo script

### 11. Phase 4 Verdict

Use one:

```txt
PHASE 4 COMPLETE
PHASE 4 COMPLETE WITH MINOR LIMITATIONS
PHASE 4 NOT COMPLETE
```

---

# 13. Final Response After Work

After patching, testing, and creating the report, print:

1. Files changed.
2. Exact commands run.
3. Build/test/demo/contract/pack results.
4. Security/hygiene check results.
5. Phase 4 report path.
6. Remaining known limitations.
7. Confirm no contract redeploy.
8. Confirm no mainnet/Pacific enablement.
9. Confirm no private keys were committed.
10. Confirm normal users do not need `.env` or private keys for preflight/read-only usage.
11. Confirm managed execution still requires authorization.

---

# 14. Acceptance Criteria

Phase 4 is acceptable if:

```txt
SafeHands positioning is clear as reusable Pharos Skill
execution modes are documented correctly
normal preflight UX does not require env/private key/authorization
advanced local private key mode is documented safely
hosted backend private key collection is explicitly discouraged
RiskRegistry authorization is only for managed execution
per-agent policy customization exists or is clearly documented with tests where implemented
large amounts can be policy-driven, not blocked by one tiny hardcoded default
hard safety rules still cannot be bypassed
x402 safety model is documented
README/SKILL/docs are aligned
package/version metadata is consistent
npm build/test/demo/contracts/test:all/pack pass
security/hygiene checks show no committed secrets
mainnet/Pacific remains blocked
Phase 4 report exists
```
