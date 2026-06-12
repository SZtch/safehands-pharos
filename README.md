<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/MCP_Skill-000000?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Pharos_Atlantic-688689-blueviolet?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Tools-27-orange?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Testnet_Only-SAFE-blue?style=for-the-badge" />
</p>

# SafeHands-Pharos: Transaction Safety Firewall for AI Agents

SafeHands-Pharos is a **Pharos Skill Engine-compatible MCP package** that protects AI agents before they execute payments, token approvals, swaps, x402 paid requests, or contract interactions.

Before an AI agent sends a payment, approves tokens, swaps assets, publishes risk data, or pays an x402 resource, SafeHands runs a policy-based preflight check and returns a deterministic decision:

```text
ALLOW | WARN | BLOCK | REQUIRE_CONFIRMATION | REQUIRE_FUNDING | REQUIRE_TOKEN_REVIEW
```

Every decision includes a risk level, human-readable reasons, required next actions, environment metadata, and structured JSON that agents can parse.

> **Testnet scope:** SafeHands targets **Pharos Atlantic Testnet only**. It is not audited for mainnet and should not be used with mainnet funds.

---

## Why AI Agents Need Transaction Safety Middleware

Autonomous agents can now hold wallets, call APIs, pay x402 resources, approve tokens, and interact on-chain. Generic Web3 tools usually answer: "Can this transaction be sent?" SafeHands answers a more important question first:

> **Should this action be allowed at all?**

Common agent-execution risks:

| Risk | What can go wrong | SafeHands guardrail |
|---|---|---|
| Unlimited approval | Agent approves a malicious spender forever | Blocks unlimited approval by default |
| Wrong chain | Agent signs on mainnet or the wrong testnet | Blocks mainnet and chain ID mismatch |
| Risky x402 URL | Agent pays or fetches SSRF-sensitive endpoints | Blocks localhost/private IPs by default |
| Overspending | Agent pays above configured limits | Blocks payments above limits |
| Unknown token | Agent swaps/approves unverified token | Warns or requires token review |
| Missing signer | Agent tries write action without safe signer | Returns structured signer error |

---

## What SafeHands Is, and What It Is Not

SafeHands is a **Transaction Safety Firewall / Guardrail Skill** for Pharos agents. SafeHands is a guardrail layer before execution, not a generic Web3 toolbox.

It is **not** a generic Web3 toolbox and does not replace Pharos Skill Engine. It complements the Skill Engine by adding a safety layer before execution:

```text
User intent
→ SafeHands preflight
→ ALLOW / WARN / BLOCK
→ Pharos Skill Engine or MCP execution if safe
→ SafeHands risk report
```

### Difference from Reputation Systems

SafeHands is also different from pure reputation systems:

| System type | Main question |
|---|---|
| Agent reputation, such as AgentLeash-style trust systems | "Can I trust this agent?" |
| SafeHands | "Can I trust this action right now?" |

SafeHands can use reputation signals, but its core purpose is **action-level risk gating**.

---

## Pharos Atlantic Testnet Context

Default project configuration:

| Item | Value |
|---|---|
| Environment | `atlantic-testnet` |
| Chain ID | `688689` |
| RPC URL | `https://atlantic.dplabs-internal.com` |
| Explorer | `https://atlantic.pharosscan.xyz/` |
| Mainnet support | `false` |
| RiskRegistry | `0x61962a6c812ee9f57b207e1ea47c19ae70bb7141` |
| Primary Pharos Skill Engine USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` |
| Alternate Circle-referenced USDC | `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` |

The project treats router and pool addresses that are not directly verified from official docs as **project-configured**, not universal canonical values.

### 🧠 Smart Liquidity Fallback
Testnet liquidity is often fragmented or missing. SafeHands includes a **Smart Fallback Engine** within its DODO API integration. 
If an AI agent requests a swap to the primary `USDC` token and the routing engine returns `NO_ROUTE_AVAILABLE`, SafeHands will automatically and silently retry the route query using the `Alternate Circle-referenced USDC` address. This prevents unnecessary transaction failures during live agent demos.

---

## Official Pharos Skill Engine Alignment

- SafeHands follows the official `SKILL.md` + `references` + `assets` structure (found in the `skill/` package directory).
- SafeHands complements Pharos Skill Engine by adding preflight safety checks before write actions.
- Pharos Skill Engine provides general on-chain capabilities.
- SafeHands answers: "Is this action safe to execute?"
- Default network remains Pharos Atlantic Testnet.
- No mainnet readiness is claimed.

---

## Supported Usage Modes

SafeHands supports three usage modes:

1. **Pharos Skill Engine (Recommended for Agents):** Install directly into your AI agent project via GitHub:
   ```bash
   npx skills add SZtch/safehands-pharos
   ```
2. **MCP server usage:** Run directly as a standard MCP server for Claude Desktop, Anvita Flow, etc.
3. **npm/npx CLI usage:** Run manually in the terminal for testing and CI checks.

---

## Quick Start

```bash
npm install
npm run build
npm run test:all
npm run demo
```

Run as MCP server:

```bash
npx safehands-pharos
```

Show CLI help:

```bash
npx safehands-pharos --help
```

Run deterministic demo:

```bash
npx safehands-pharos --demo
```

Run a Skill Engine-compatible CLI call:

```bash
npx safehands-pharos skill safehands_preflight_check --input-json '{"actionType":"approve_token","chainId":688689,"isMainnet":false,"approvalAmount":"max","spender":"0x0000000000000000000000000000000000000001"}'
```

The CLI returns the standard response envelope:

```json
{
  "success": true,
  "data": {
    "decision": "BLOCK",
    "riskLevel": "HIGH",
    "safeToExecute": false,
    "reasons": ["Unlimited approval requested."],
    "requiredActions": ["Use a limited approval amount."],
    "environment": "atlantic-testnet",
    "chainId": 688689,
    "isMainnet": false
  },
  "error": null,
  "timestamp": "2026-06-12T00:00:00.000Z"
}
```

---

## Environment Setup

Copy `.env.example` if you need local configuration:

```bash
cp .env.example .env
```

Safe defaults:

```env
WALLET_MODE=none
WRITE_TOOLS_ENABLED=false
ALLOW_UNLIMITED_APPROVAL=false
ALLOW_LOCAL_X402_FETCH=false
```

Read-only and preflight tools do not require a private key. Write tools require `WRITE_TOOLS_ENABLED=true` and a safe signer source.

### 💾 Agent Wallet Backups
By default, testnet wallets created via `create_agent_wallet` are strictly **In-Memory** and will not persist after the MCP server restarts.
To enable persistent local storage for your AI agent wallets, set the following environment variable:
```env
WALLET_STORE_PATH=./.agents/wallets.json
```
This will securely XOR-obfuscate and save the agent's private key to your local `.agents` folder (which is explicitly ignored by Git to prevent accidental leakage).

---

## MCP Tools: 27 Total

SafeHands currently exposes **27 MCP tools**:

- 17 legacy/core Web3 safety/execution tools
- 3 managed testnet wallet tools
- 7 branded SafeHands guardrail tools

### Branded SafeHands Guardrail Tools

| Tool | Purpose |
|---|---|
| `safehands_preflight_check` | Policy-based ALLOW/WARN/BLOCK check before execution |
| `safehands_safe_execute` | Guarded wrapper around payment, approval, swap, and x402 execution |
| `safehands_wallet_health` | Checks whether an agent wallet is ready to act |
| `safehands_x402_preflight` | Checks URL, payment amount, token, signer, and x402 safety before paying |
| `safehands_risk_report` | Generates a human-readable risk report for demos and judges |
| `explain_risk` | Converts policy results into plain-English explanations |
| `token_registry_status` | Classifies token addresses as canonical, test, custom, unknown, or invalid |

### Core Safety and Execution Tools

| Tool | Type | Purpose |
|---|---|---|
| `assess_risk` | Read / optional write | 5-dimension risk score |
| `check_token_security` | Read | GoPlus token security profile |
| `simulate_transaction` | Read | Dry-run transaction simulation |
| `estimate_gas` | Read | Gas estimate and sufficiency check |
| `execute_swap` | Write | FaroSwap/DODO swap with guardrails |
| `send_payment` | Write | Native PHRS payment |
| `approve_token` | Write | ERC-20 approval with unlimited-approval guard |
| `get_token_price` | Read | Token price data |
| `get_pool_info` | Read | DODO/FaroSwap pool and route info |
| `get_gas_price` | Read | Current gas price |
| `get_wallet_balance` | Read | Wallet balances |
| `check_allowance` | Read | ERC-20 allowance check |
| `get_transaction_status` | Read | Transaction status by hash |
| `get_execution_history` | Read | Wallet transaction history |
| `publish_risk_score` | Write | Publish score to RiskRegistry |
| `query_risk_registry` | Read | Query on-chain risk score |
| `x402_pay_and_fetch` | Write when HTTP 402 | Fetch x402 resources and pay only after a payment challenge |

### Managed Testnet Wallet Tools

| Tool | Purpose |
|---|---|
| `create_agent_wallet` | Explicitly create a managed testnet wallet |
| `get_agent_wallet` | Return public wallet metadata, never private key |
| `get_agent_wallet_balance` | Check managed wallet balances |

---

## Policy Engine Behavior

The reusable policy engine lives at:

```text
src/lib/policy/actionPolicyEngine.ts
```

Supported action types:

```text
send_payment
approve_token
execute_swap
x402_pay_and_fetch
publish_risk_score
custom_contract_call
```

Key guardrails:

- Block mainnet actions.
- Block chain ID mismatch.
- Block unlimited approvals by default.
- Block SSRF-sensitive x402 URLs.
- Block payment above configured limits.
- Block x402 payment above `MAX_X402_PAYMENT_USDC`.
- Block approvals above `MAX_APPROVAL_AMOUNT_USDC` unless consciously configured.
- Warn when a token is custom, non-registry, or token-security provider is unavailable.
- Require confirmation for medium-risk actions.
- Allow low-risk Pharos Atlantic Testnet actions.

---

## x402 Behavior

SafeHands has both x402 client and server behavior:

### Free endpoints

- `GET /supported`
- `GET /health`

These do **not** require a user private key.

### Paid endpoints

- `GET /assess-risk`
- `GET /check-token-security`
- `GET /simulate-transaction`

Expected demo price: `0.001 USDC`.

Client flow:

1. Fetch normally first.
2. If HTTP 200, return `paymentExecuted=false`.
3. If HTTP 402, run SafeHands x402 preflight.
4. Request signer only after HTTP 402.
5. Do not log or return signed payment payloads.

---

## Using SafeHands with Pharos Skill Engine

SafeHands includes a Pharos Skill Engine adapter under:

> **Note:** The canonical publishable Skill package is in `skill/`. The `examples/pharos-skill-engine/` folder is retained as an integration example.

```text
examples/pharos-skill-engine/
├── SKILL.safehands.md
├── references/
│   └── safehands.md
└── assets/
    └── safehands/
        ├── policy-defaults.json
        └── example-actions.json
```

The reference files teach the Skill Engine how to call SafeHands through terminal commands such as:

```bash
npx safehands-pharos skill safehands_preflight_check --input-json '<json>'
npx safehands-pharos skill safehands_x402_preflight --input-json '<json>'
npx safehands-pharos skill safehands_wallet_health --input-json '{}'
npx safehands-pharos skill token_registry_status --input-json '{"tokenAddress":"0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8"}'
```

Use SafeHands before Pharos Skill Engine performs write actions. SafeHands complements the Skill Engine and should not be treated as a replacement.

---

## Security Guardrails

SafeHands defaults to defensive behavior:

- `WRITE_TOOLS_ENABLED=false` by default.
- `WALLET_MODE=none` by default.
- No wallet is created on install, import, or startup.
- Managed wallets are created only through `create_agent_wallet`.
- Private keys are never returned in MCP or CLI responses.
- Private keys and payment proofs are not logged.
- Unlimited approvals are blocked unless explicitly allowed.
- SSRF-sensitive x402 URLs are blocked unless local testing is explicitly enabled.
- Mainnet actions are blocked.
- External API failures return structured errors rather than crashing tool calls.

---

## Demo

Run:

```bash
npm run demo
```

or:

```bash
npx safehands-pharos --demo
```

The default demo is deterministic and non-destructive. It shows wallet health, allowed preflight, blocked approval, token registry status, x402 preflight, free x402 endpoint behavior, paid x402 without signer, SSRF blocking, write-tool blocking, and a human-readable risk explanation.

---

## Real Testnet Verification

SafeHands includes live verification commands that test against real Pharos Atlantic Testnet infrastructure:

| Command | What it does | Requires |
|---------|-------------|----------|
| `npm run test:rpc:live` | Reads chain ID, block number, optional wallet balance from live RPC | Network access |
| `npm run test:live:safehands` | Runs 7 CLI safety checks against built dist (no broadcast) | Built dist |
| `npm run test:x402:live` | Tests x402 free/paid endpoint behavior locally | Nothing |
| `npm run test:dodo:live` | Tests DODO API route if `DODO_API_KEY` set; skips cleanly if not | `DODO_API_KEY` (optional) |

**Important distinctions:**

1. **Live RPC checks** (`test:rpc`, `test:rpc:live`) connect to the real Pharos Atlantic Testnet RPC and read chain ID + block number.
2. **Live CLI checks** (`test:live:safehands`) run real CLI invocations against built dist, testing policy decisions deterministically.
3. **x402 behavior checks** (`test:x402:live`) use a **local test server** labeled `LOCAL_X402_SERVER_DOCS_BEHAVIOR_TEST`. They do not connect to a remote Pharos x402 endpoint.
4. **DODO checks** (`test:dodo:live`) performs live read-only DODO/FaroSwap checks when `DODO_API_KEY` is configured. The public API key can be provided through an environment variable. The key is not required for the normal deterministic demo. A missing key results in a clean skip. A live API pass does not automatically make router addresses docs-verified.
5. **Smoke tests** (`test:all`) are deterministic and do not require network connectivity (except DODO/RPC-dependent tools, which degrade gracefully).
6. **Address verification statuses** (DOCS_VERIFIED, DOCS_DEMO_NON_OFFICIAL, PROJECT_CONFIGURED) are sourced from `docs/reports/OFFICIAL_DOCS_ALIGNMENT_REPORT.md`.
7. **No real transactions are broadcast by default.** Write tools require explicit `WRITE_TOOLS_ENABLED=true`.

---

## Tests and Validation

```bash
npm ci
npm run build
npx tsc -p tsconfig.all.json --pretty false
npm run test:all                # 43-point smoke test suite
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

Live verification (requires network):

```bash
npm run test:rpc                # Basic RPC connectivity
npm run test:rpc:live           # Full live RPC verification with structured output
npm run test:live:safehands     # 7 CLI safety checks (read-only)
npm run test:x402:live          # x402 behavior checks (local server)
npm run test:dodo:live          # DODO API check (requires DODO_API_KEY, skips if missing)
```

`test:rpc` and `test:rpc:live` depend on DNS/network access to Pharos RPC and may fail in restricted environments. This should be reported honestly as a provider/network limitation, not hidden.

---

## Known Limitations and TODOs

- Testnet-only, not audited for mainnet use.
- Managed wallet storage is testnet-grade unless a real KMS/Vault is integrated.
- DODO/FaroSwap router addresses are project-configured unless official docs confirm them.
- GoPlus/DODO/FaroSwap availability depends on external services and API limits.
- `npm audit` for production dependencies is clean; full dev audit may report dev-only dependency issues depending on upstream packages.
- Formal unit tests with mocked RPC/DODO/GoPlus providers would improve long-term maintainability.

---

## Hackathon Summary

**Project name:** SafeHands-Pharos: Transaction Safety Firewall for AI Agents

**Short description:** SafeHands-Pharos is a Pharos Skill Engine-compatible MCP package that protects AI agents before they execute payments, token approvals, swaps, or x402 paid requests by returning ALLOW, WARN, or BLOCK decisions with human-readable risk explanations.
