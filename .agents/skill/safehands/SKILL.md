name: safehands
version: 1.3.0
description: Transaction Safety Firewall for Pharos agents. 27 tools (17 legacy/core + 3 managed wallet + 7 guardrail) that preflight, assess, simulate, and gate payments, token approvals, swaps, and x402 paid requests before execution.
author: "SZtch"
chain: pharos
tags: [execution, safety, defi, swap, payment, risk, registry, middleware, composable, x402]
categories: [safety, execution, defi, intelligence]
---

# SafeHands

> *"Before an AI agent acts on-chain, SafeHands checks whether the action is safe."*

SafeHands is **risk intelligence middleware** for the Pharos AI Agent economy. It sits between agent intent and on-chain execution, providing a 27-tool safety layer that any agent can compose into their workflow. Every payment, transfer, approval, swap, and x402 paid request can flow through a policy-based preflight before touching the chain.

SafeHands is not an agent and does not replace Pharos Skill Engine — it is the safety layer other agents can depend on.

---

## Tools (27)

### Core Safety — Assess before you execute

| Tool | Description |
|------|-------------|
| `assess_risk` | 5-dimension risk score (0–100) for any swap or transfer. Auto-publishes to on-chain RiskRegistry when `autoPublish=true` and SignerProvider is configured. |
| `check_token_security` | Check token contract security (honeypot check, tax checks, mint privileges) via GoPlus Security API. |
| `simulate_transaction` | Dry run via eth_call — zero gas. Returns expected output, gas estimate, and revert reasons before committing. |
| `estimate_gas` | Pre-execution gas cost in PHRS and USD. Checks whether the wallet has sufficient funds for gas + value. |

### Execution — Act with guardrails

| Tool | Description |
|------|-------------|
| `execute_swap` | Swap tokens via FaroSwap (DODO) with built-in risk gate. Automatically blocks if risk score exceeds 80. |
| `send_payment` | Native PHRS transfer with risk assessment, address validation, balance checks, and high-exposure warnings. Blocks if risk score exceeds 80. |
| `approve_token` | ERC-20 approval for DODO router. Supports exact amounts or unlimited ("max") approval. |

### Market Intelligence — Know before you trade

| Tool | Description |
|------|-------------|
| `get_token_price` | Real-time PHRS, USDC, USDT prices derived from DODO liquidity quotes on Pharos. |
| `get_pool_info` | DODO pool data for any token pair — price ratio, price impact, and fees. |
| `get_gas_price` | Current Pharos gas price with trend classification (low/normal/high) and cost estimates. |

### Wallet & History — Observe the full picture

| Tool | Description |
|------|-------------|
| `get_wallet_balance` | PHRS, USDC, USDT balances for any wallet with total USD estimate. |
| `check_allowance` | Check ERC-20 allowance granted to DODO router. Reports whether approval is needed before a swap. |
| `get_transaction_status` | Look up any transaction by hash — status, block number, gas used, explorer link. |
| `get_execution_history` | On-chain audit trail for any wallet. Categorizes activity as swaps, transfers, or other. |

### On-Chain Risk Registry — Share risk intelligence across agents

| Tool | Description |
|------|-------------|
| `publish_risk_score` | Run risk assessment and publish the result to the on-chain RiskRegistry smart contract. |
| `query_risk_registry` | Read any wallet's published risk score from the registry. Read-only — no SignerProvider signer needed. |

### x402 Payments — Composable micro-payment gating

| Tool | Description |
|------|-------------|
| `x402_pay_and_fetch` | Fetch resources from an HTTP x402 payment-gated server. Automatically handles HTTP 402 payment challenge by signing a payment payload and completing the fetch. |

### SafeHands Guardrail Tools — Policy-first agent firewall

| Tool | Description |
|------|-------------|
| `safehands_preflight_check` | Policy-based preflight for payments, approvals, swaps, x402 payments, registry publishing, and custom contract calls. Returns `ALLOW`, `WARN`, `BLOCK`, `REQUIRE_CONFIRMATION`, `REQUIRE_FUNDING`, or `REQUIRE_TOKEN_REVIEW`. |
| `safehands_safe_execute` | Guarded wrapper that runs preflight first and executes only when the action is allowed, write tools are enabled, and explicit runtime confirmation is provided. |
| `safehands_wallet_health` | Checks signer availability, wallet mode, PHRS/USDC readiness, gas readiness, x402 readiness, chain ID, and testnet safety posture. |
| `safehands_x402_preflight` | Validates URL/SSRF safety, x402 payment amount, payment token, signer readiness, and Pharos Atlantic policy before signing. |
| `safehands_risk_report` | Audit-friendly human-readable report explaining why an action was allowed, warned, blocked, or requires confirmation. |
| `explain_risk` | Converts a policy decision and reasons into a concise human-readable explanation. |
| `token_registry_status` | Classifies exact token input as canonical testnet token, demo/test liquidity token, custom, unknown, or invalid. |

---

## Composability

SafeHands is designed as a **building block**, not a standalone application. Other skills and agents compose SafeHands into their workflows by calling its tools as middleware.

### Read-only tools (safe for any agent, no key needed)
`check_token_security` · `simulate_transaction` · `estimate_gas` · `get_token_price` · `get_pool_info` · `get_gas_price` · `get_wallet_balance` · `check_allowance` · `get_transaction_status` · `get_execution_history` · `query_risk_registry`

### Read+Write tool (read without key, auto-publishes with key)
`assess_risk` — returns risk score without a key; if `autoPublish=true` and SignerProvider is configured, also publishes the result to the on-chain RiskRegistry.

### Write tools (require a SignerProvider signer)
`execute_swap` · `send_payment` · `approve_token` · `publish_risk_score` · `x402_pay_and_fetch`

### How Phase 2 agents compose with SafeHands

```
┌─────────────────────────────────────────────────────┐
│  Phase 2 Agent (DeFi bot, payment agent, etc.)      │
│                                                     │
│  1. Call assess_risk → get risk score               │
│  2. Call simulate_transaction → dry run             │
│  3. If safe → call execute_swap or send_payment     │
│  4. Call get_transaction_status → confirm result    │
│  5. Call query_risk_registry → check counterparty   │
└─────────────────────────────────────────────────────┘
```

Any agent (including those built with **Anvita Flow**) that performs on-chain actions on Pharos can import SafeHands as its safety layer. The agent handles user intent and strategy; SafeHands handles risk gating and execution.

### Cross-agent risk intelligence

The RiskRegistry contract (`0x61962a6c812ee9f57b207e1ea47c19ae70bb7141`) enables agents to share risk assessments:

- **Agent A** publishes a risk score for a wallet via `publish_risk_score`
- **Agent B** queries that score via `query_risk_registry` before interacting with the same wallet
- No API keys, no centralized service — purely on-chain, permissionless

---

## Usage Examples

**Example 1 — Pre-trade safety check:**
```
User: "Swap 100 PHRS to USDC"
Agent: → assess_risk(swap, PHRS, USDC, 100, wallet)
     → Score 12/100, low risk, proceed
     → simulate_transaction(swap, PHRS, USDC, 100)
     → Would succeed, ~166 USDC out
     → execute_swap(PHRS, USDC, 100, wallet, SignerProvider)
     → ✅ TX confirmed
```

**Example 2 — Risk-gated payment:**
```
User: "Send 500 PHRS to 0xabc..."
Agent: → assess_risk(transfer, 500, toAddress=0xabc)
     → Score 85/100, critical, BLOCKED
     → "This transfer uses 95% of your wallet. Reduce amount or confirm override."
```

**Example 3 — Portfolio check before action:**
```
User: "What's in my wallet?"
Agent: → get_wallet_balance(wallet) → PHRS=19.4, USDC=0.85, USDT=0
     → get_token_price(PHRS) → $1.66
     → "Your portfolio: $32.21 USD across 3 tokens"
```

**Example 4 — Cross-agent reputation lookup:**
```
Agent B: → query_risk_registry(0xsuspicious...)
       → Score 92, critical, block
       → "This wallet was flagged high-risk by another agent. Refusing to interact."
```

---

## Safety Model

1. **Risk-first execution** — every write tool (`execute_swap`, `send_payment`) internally calls `assess_risk` before proceeding.
2. **Automatic blocking** — actions scoring above 80 are prevented. No override without explicit `bypassRiskCheck`.
3. **Transient keys** — write tools request signatures through SignerProvider; SignerProvider signers are never returned or logged.
4. **Simulation before commitment** — `simulate_transaction` lets agents verify outcomes at zero cost before committing gas.
5. **On-chain audit** — all risk scores can be published to the RiskRegistry, creating a permanent, verifiable record.

---

## On-Chain Registry

**Contract:** `0x61962a6c812ee9f57b207e1ea47c19ae70bb7141`
**Chain:** Pharos Atlantic Testnet (688689)

The RiskRegistry is a Solidity smart contract deployed on Pharos that stores risk assessments on-chain. Any agent can publish. Any agent can query. No API keys, no centralized infrastructure.

When `assess_risk` is called with `autoPublish=true` plus SignerProvider, the result is automatically published — making every risk assessment a permanent, queryable on-chain record that other agents can trust.

---

## x402 Monetized API Server

SafeHands exposes a paid HTTP REST API server using the Coinbase-designed **x402 micro-payment protocol** on Pharos Atlantic. This allows developers to offer risk gating and intelligence tools as a paid utility to external AI agents.

### API Endpoints
- `GET /health` (Free) — Health check, token registry, and receiver addresses.
- `GET /assess-risk` (Paid: USDC 0.001) — Gate queries with 5-dimension risk score checks.
- `GET /check-token-security` (Paid: USDC 0.001) — Verify contract security, honeypots, and token code privileges.
- `GET /simulate-transaction` (Paid: USDC 0.001) — Perform dry-runs of transfers and swaps.

### Flow Architecture
1. **Challenge:** When a client fetches a gated resource, the server replies with `HTTP 402 Payment Required` and a Base64-encoded `PAYMENT-REQUIRED` header specifying token address, receiver wallet, and pricing details.
2. **On-Chain Settlement:** The client signs a standard authorization envelope with their SignerProvider signer, transferring the micro-payment directly to the recipient wallet.
3. **Resubmission:** The client resubmits the request, appending the payload signature in the `PAYMENT-SIGNATURE` header.
4. **Unlocking Content:** The integrated Facilitator verifies the signature, settles the transfer on-chain, and responds with `HTTP 200 OK` carrying the resource response payload.

---

## Supported Tokens

Pharos Atlantic Testnet registered tokens:
- **PHRS**: Native Pharos token (`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`)
- **USDC**: USD Coin (`0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`) - Primary Pharos Skill Engine USDC
- **USDT**: Tether USD (`0xE7E84B8B4f39C507499c40B4ac199B050e2882d5`)
- **WBTC**: Wrapped BTC (`0x0c64F03EEa5c30946D5c55B4b532D08ad74638a4`)
- **WETH**: Wrapped ETH (`0x7d211F77525ea39A0592794f793cC1036eEaccD5`)
- **WPHRS**: Wrapped PHRS (`0x838800b758277CC111B2d48Ab01e5E164f8E9471`)
- **altUSDC**: Alternate USDC (`0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B`) - Alternate Circle-referenced USDC

## Chain

Pharos Atlantic Testnet — Chain ID 688689 — RPC: `https://atlantic.dplabs-internal.com/`
