# SafeHands Phase 5 — Final Validation + Submit-Ready Report Prompt

Act as a senior software release manager, Web3 security auditor, TypeScript maintainer, MCP/agent tool reviewer, DevOps reviewer, documentation reviewer, QA lead, and hackathon submission-readiness auditor.

## Repository Context

This repository is **SafeHands / safehands-pharos**, an open-source reusable Pharos Skill for AI agents.

SafeHands is a Pharos Atlantic Testnet-only safety gateway that other AI agents can call before executing on-chain actions such as payments, approvals, swaps, x402 payments, custom contract calls, risk reports, and managed agent wallet checks.

SafeHands should be positioned as:

```txt
An open-source reusable Pharos Skill that gives AI agents a safety gateway before on-chain actions.

Any agent can use preflight and risk tools freely, while managed execution tools are gated by authorization, funding checks, policy limits, and SafeHands risk approval.
```

---

# Current Status Before Phase 5

## Phase 1 — Complete

Core TypeScript/app-layer security fixes are complete.

Expected preserved behavior:

```txt
invalid approve token -> BLOCK / validation error
invalid swap token -> BLOCK / validation error
invalid publish_risk_score -> BLOCK / validation error
invalid x402 amount -> BLOCK / validation error
SSRF / redirect SSRF guarded
strict schema validation
safe_execute must not return false success
```

## Phase 2 — Complete + Deployed

RiskRegistry V2 contract exists, is tested, and deployed.

```txt
Network: Pharos Atlantic Testnet
Chain ID: 688689
RiskRegistry V2 Address: 0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
Owner / Deployer: 0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5
```

RiskRegistry V2 role:

```txt
authorized-agent registry + on-chain risk memory / risk attestation registry
```

## Phase 3 — Complete With Minor Limitations

RiskRegistry V2 is integrated into app/tool layer.

Expected preserved behavior:

```txt
publish_risk_score uses or is prepared to use V2 publishRiskRecord
query_risk_registry uses V2
safehands_risk_report includes V2 information/degrades gracefully
managed execution requires RiskRegistry V2 authorization
preflight/read-only mode does not require authorization
user-signed/env wallet mode does not require authorization by default
```

## Phase 4 — Complete With Minor Limitations

UX/env/policy/docs/package cleanup is complete.

Expected preserved behavior:

```txt
version 1.7.0
29 tools grouped by capability
per-agent policy exists
get_agent_policy and set_agent_policy exist
normal preflight/read-only usage requires no .env, private key, funding, or authorization
large amounts are policy-driven, not blocked by one tiny global limit
hard safety rules cannot be bypassed
README/SKILL/SECURITY/.env.example aligned
```

Known Phase 4 limitations to preserve honestly:

```txt
user-signed/prepared transaction mode is not a full formal handler yet
x402 full idempotency/retry cache is future work
live V2 reads/auto-authorize may not be tested live in deterministic smoke tests
npm audit vulnerabilities may remain from dependencies
daily spend accumulator is not fully per-agent yet
```

---

# Phase 5 Goal

Phase 5 is the final release/submission gate.

Do **not** add large new features.

Do **not** redesign the system.

Do **not** redeploy contracts unless explicitly instructed.

Focus on:

```txt
final validation
final secret scan
final package inspection
final README/SKILL quickstart verification
final demo/reviewer script
final submission-ready report
final limitation honesty
final GitHub/DoraHacks readiness
```

---

# Hard Constraints

Do **not** undo Phase 1–4 fixes.

Do **not** enable mainnet or Pacific.

Do **not** claim mainnet readiness.

Do **not** claim audited production custody.

Do **not** add a large UI/frontend.

Do **not** force normal users to provide private keys.

Do **not** force every user to authorize a wallet.

Do **not** force RiskRegistry authorization for preflight/read-only mode.

Do **not** force RiskRegistry authorization for user-signed/prepared transaction mode.

Do **not** commit `.env`, private keys, mnemonics, API keys, RPC secrets, owner keys, local wallet secrets, or screenshots containing secrets.

Do **not** print or log private keys.

Do **not** put real private keys in README, `.env.example`, reports, screenshots, ZIP artifacts, prompt docs, or generated docs.

Keep SafeHands **Pharos Atlantic Testnet-only**.

---

# 1. Final Repository Sanity Review

Review the repository for final submission consistency.

Check:

```txt
package.json
package-lock.json
README.md
SKILL.md if present
skill/SKILL.md if present
.agents/skill/safehands/SKILL.md if present
SECURITY.md
DEMO.md / EXAMPLES.md if present
.env.example
contracts/RiskRegistryV2.sol
contracts/RiskRegistryV2.json
docs/reports/*.md
scripts/*
src/*
```

Required consistency:

```txt
version = 1.7.0 or intentionally documented current final version
tool count = 29 if docs say 29
RiskRegistry V2 address = 0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
chainId = 688689
network = Pharos Atlantic Testnet
mainnet/Pacific blocked
WRITE_TOOLS_ENABLED=false default
AUTO_AUTHORIZE_AGENT_WALLET=false default
normal preflight requires no private key
managed execution requires authorization
env wallet mode is advanced local testnet only
```

Do not overclaim:

```txt
mainnet-ready
audited
production custody
fully trustless production wallet custody
all x402 idempotency/replay risks fully solved
full per-agent daily spend accumulation if not implemented
formal prepared-transaction handler if not implemented
```

---

# 2. Final Commands to Run

Run the final full validation suite.

Required:

```bash
npm ci
npm run build
npm test
npm run demo
npm run test:contracts
npm run test:all
npm pack --dry-run
```

If any command fails, fix only the minimum necessary issue and rerun.

Do not claim a command passed unless it was actually run.

Record exact results in the final report.

---

# 3. Final Security / Secret Hygiene Checks

Run these checks from the repo root.

```bash
git status
git ls-files | grep -E '(^|/)\.env$' || true
find . -name ".env" -not -path "./node_modules/*" -not -path "./.git/*" -print || true
grep -R "PRIVATE_KEY=" -n . --exclude-dir=node_modules --exclude-dir=.git || true
grep -R "RISK_REGISTRY_OWNER_PRIVATE_KEY=0x[0-9a-fA-F]" -n . --exclude-dir=node_modules --exclude-dir=.git || true
grep -R "0x[a-fA-F0-9]\{64\}" -n . --exclude-dir=node_modules --exclude-dir=.git || true
grep -R "mnemonic" -n . --exclude-dir=node_modules --exclude-dir=.git || true
grep -R "seed phrase" -n . --exclude-dir=node_modules --exclude-dir=.git || true
```

Interpretation rules:

```txt
.env existing locally is okay only if not tracked and not packaged.
.env.example placeholders are okay.
Contract bytecode in artifacts may contain long hex and is okay.
Real private keys are not okay.
Real mnemonics/seed phrases are not okay.
Prompt docs containing placeholder text are okay.
```

If there are suspicious findings, investigate and remove secrets before final report.

---

# 4. Final Package Inspection

Run:

```bash
npm pack --dry-run
```

Verify included:

```txt
dist/
contracts/RiskRegistryV2.sol
contracts/RiskRegistryV2.json
README.md
SECURITY.md
SKILL.md or .agents/skill/safehands/SKILL.md
docs/reports/SAFEHANDS_FINAL_SUBMIT_READY_REPORT.md after it is created
package.json
package-lock.json
```

Verify not included:

```txt
.env
private keys
local wallet storage
node_modules
screenshots with secrets
temporary logs
```

If needed, update `files` in `package.json` or `.npmignore` safely.

---

# 5. Final Reviewer Quickstart

Create or update a concise reviewer quickstart section in README or a separate doc.

Suggested file:

```txt
docs/REVIEWER_QUICKSTART.md
```

The quickstart should show a reviewer how to run SafeHands safely without private keys:

```bash
npm ci
npm run build
npm test
npm run demo
```

Also include example read/preflight commands that do not require `.env` or private keys.

Must clarify:

```txt
Preflight/read-only mode does not require a private key.
Execution requires WRITE_TOOLS_ENABLED=true and proper testnet configuration.
Managed execution requires RiskRegistry V2 authorization.
```

---

# 6. Final Demo Script

Create or update a concise demo script.

Suggested file:

```txt
docs/SAFEHANDS_REVIEWER_DEMO_SCRIPT.md
```

The demo script should include:

```txt
1. Project one-liner
2. Why SafeHands matters for AI agents
3. Execution modes
4. RiskRegistry V2 deployed address
5. Demo command list
6. Expected outputs:
   - safe small testnet preflight -> ALLOW
   - mainnet chainId -> BLOCK
   - invalid token -> BLOCK
   - unlimited approval -> BLOCK
   - x402 SSRF / invalid amount -> BLOCK
   - risk report -> local + V2 section/graceful result
   - policy advanced can allow 1000 PHRS swap while conservative blocks
7. Limitations / honesty
```

Do not include private keys.

---

# 7. Optional Live Read-Only V2 Check

If safe and easy, run a read-only live RPC check against RiskRegistry V2.

This must not require private keys.

Example objective:

```txt
Read isAuthorizedAgent for a sample wallet
Confirm chainId 688689
Confirm V2 contract address responds
```

If no script exists, you may add a small read-only script such as:

```txt
scripts/check-risk-registry-v2-live.ts
```

Requirements:

```txt
No private key required
No write transaction
No auto-authorize
No secret logging
Graceful failure if RPC unavailable
```

If live RPC check is not run, document it honestly as not run.

Do not block final submission solely because optional live read check could not run.

---

# 8. Final README/SKILL Submission Wording

Ensure final docs use this wording or equivalent:

```txt
SafeHands is an open-source reusable Pharos Skill that gives AI agents a safety gateway before on-chain actions.

Any agent can use SafeHands preflight and risk tools freely. Execution tools are reusable but intentionally gated by WRITE_TOOLS_ENABLED, RiskRegistry V2 authorization for managed wallets, funding checks, per-agent policy limits, and preflight approval.
```

Include RiskRegistry V2:

```txt
RiskRegistry V2:
Network: Pharos Atlantic Testnet
Chain ID: 688689
Address: 0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
```

Include limitations:

```txt
Pharos Atlantic Testnet-only
Mainnet/Pacific blocked by design
Not audited for mainnet custody
User-signed prepared transaction output is future enhancement if not implemented
Full x402 idempotency cache is future hardening if not implemented
Per-agent daily spend accumulation is future hardening if not implemented
```

---

# 9. Final DoraHacks / Hackathon Submission Text

Create a submission text file:

```txt
docs/DORAHACKS_SUBMISSION_TEXT.md
```

Include:

## Project Name

```txt
SafeHands
```

## One-liner

```txt
Reusable safety Skill for Pharos AI agents before on-chain execution.
```

## Short Description

A concise 3–5 sentence description.

## Long Description

A polished description explaining:
- problem
- solution
- reusable Skill concept
- execution modes
- RiskRegistry V2
- x402 safety
- testnet-only safety scope

## Key Features

Bullet list.

## RiskRegistry V2

Include address/network/chainId.

## Tech Stack

```txt
TypeScript
Node.js
MCP-style tools
Solidity
Hardhat
Pharos Atlantic Testnet
x402 safety flow
RiskRegistry V2
```

## Links Placeholder

```txt
Repository: [PASTE_GITHUB_LINK]
Demo Video: [PASTE_DEMO_VIDEO_LINK]
Package/NPM: [PASTE_IF_AVAILABLE]
```

Do not include false claims.

---

# 10. Final Submit-Ready Report

Create:

```txt
docs/reports/SAFEHANDS_FINAL_SUBMIT_READY_REPORT.md
```

The report must include:

## SafeHands Final Submit-Ready Report

### 1. Final Verdict

Use one:

```txt
SUBMIT READY
SUBMIT READY WITH MINOR LIMITATIONS
NOT SUBMIT READY
```

Use `SUBMIT READY WITH MINOR LIMITATIONS` if remaining limitations are real but non-blocking.

### 2. Executive Summary

Summarize SafeHands in 1–3 paragraphs.

### 3. Hackathon Fit

Explain why SafeHands fits Phase 1 Skill Hackathon:
- reusable Skill
- other agents can call it
- safety gateway
- x402/payment/on-chain action safety
- RiskRegistry V2 as on-chain trust/risk memory

### 4. Final Architecture

Document:
- app/tool layer
- RiskRegistry V2
- execution modes
- per-agent policy
- x402 safety
- managed wallet safety

### 5. Deployed Contract

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

### 6. Security Controls

Include:
- mainnet/Pacific blocking
- chainId guard
- strict validation
- SSRF / redirect SSRF
- x402 amount/challenge safety
- unlimited approval blocking
- RiskRegistry V2 authorization for managed execution
- funding gate
- per-agent policy
- private key handling
- no default write execution

### 7. Reusable Skill Capabilities

Group tools into:

```txt
1. Safety Preflight
2. Wallet + Agent Authorization
3. Risk Scoring + RiskRegistry
4. Payment + x402 Safety
5. Swap + Approval Safety
6. Simulation + Monitoring
```

### 8. Test Results

Include exact command results:
- `npm ci`
- `npm run build`
- `npm test`
- `npm run demo`
- `npm run test:contracts`
- `npm run test:all`
- `npm pack --dry-run`
- security/hygiene checks

### 9. Package Inspection

Summarize npm pack content and size if available.

### 10. Reviewer Quickstart

Add short commands for reviewer.

### 11. Remaining Known Limitations

Be honest:
- user-signed prepared tx formal handler if not implemented
- x402 full idempotency cache if not implemented
- live V2 read/auto-authorize if not run
- npm audit vulnerabilities if remaining
- per-agent daily spend accumulator if not fully implemented
- testnet-only
- not audited for mainnet custody

### 12. Submission Checklist

Include checklist:

```txt
README updated
SKILL.md updated
SECURITY.md updated
RiskRegistry V2 deployed
RiskRegistry V2 address documented
tests pass
demo passes
pack passes
no secrets committed
mainnet blocked
DoraHacks text created
```

### 13. Final Verdict Explanation

Explain why final verdict was chosen.

---

# 11. Commands After Report Creation

After creating final report and submission text, rerun at least:

```bash
npm run build
npm test
npm run demo
npm run test:contracts
npm run test:all
npm pack --dry-run
```

Because docs/package files may have changed.

---

# 12. Final Response After Work

After Phase 5 is complete, print:

1. Files changed.
2. Exact commands run.
3. Build/test/demo/contract/pack results.
4. Security/secret scan results.
5. Final report path.
6. DoraHacks submission text path.
7. Reviewer quickstart/demo script path.
8. Remaining known limitations.
9. Final verdict.
10. Confirm no contract redeploy.
11. Confirm no mainnet/Pacific enablement.
12. Confirm no private keys/secrets committed.
13. Confirm normal preflight/read-only usage requires no `.env`, private key, or authorization.
14. Confirm managed execution remains gated by RiskRegistry V2 authorization.

---

# 13. Acceptance Criteria

Phase 5 is acceptable if:

```txt
all required commands are run and pass, or failures are honestly documented
final secret scan is completed
npm pack contents are inspected
final README/SKILL wording is aligned
reviewer quickstart exists
demo script exists
DoraHacks submission text exists
final submit-ready report exists
RiskRegistry V2 address is documented
mainnet/Pacific remains blocked
no secrets are committed
normal preflight/read-only UX remains easy
managed execution remains gated
known limitations are honest
no big new feature scope creep is introduced
```
