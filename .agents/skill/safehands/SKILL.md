name: safehands
version: 1.7.0
description: >
  Open-source reusable Pharos Skill — safety gateway for AI agent on-chain actions.
  29 tools across preflight, risk scoring, managed execution, agent policy, and x402 payment safety.
  Pharos Atlantic Testnet only.
author: "SZtch"
chain: pharos
tags: [execution, safety, defi, swap, payment, risk, registry, middleware, composable, x402, policy]
categories: [safety, execution, defi, intelligence]
---

# SafeHands

> *"Before an AI agent acts on-chain, SafeHands checks whether the action is safe."*

SafeHands is an **open-source reusable Pharos Skill** that gives AI agents a safety gateway before on-chain actions. Any agent can use its preflight and risk tools freely, while managed execution tools are gated by authorization, funding checks, policy limits, and SafeHands risk approval.

SafeHands is Pharos Atlantic Testnet-only. Mainnet and Pacific are blocked by design.

---

## Execution Modes

### Preflight / Read-only (no wallet, no key, no authorization)

Best for agent safety checks, reviewer demos, and risk analysis. No `.env` required.

Tools: `safehands_preflight_check`, `safehands_x402_preflight`, `safehands_risk_report`, `safehands_wallet_health`, `explain_risk`, `token_registry_status`, `query_risk_registry`, `get_agent_policy`

### User-signed / Prepared Transaction

SafeHands validates and explains risk. User signs externally with their own wallet. No RiskRegistry authorization required. Currently SafeHands provides preflight decisions and transaction safety context for user-signed flows; formal prepared-transaction output is a future enhancement.

### Managed Agent Execution (authorization + funding required)

SafeHands-managed wallet executes. Requires: RiskRegistry V2 authorization (once per wallet), funded wallet (PHRS for gas), `WRITE_TOOLS_ENABLED=true`, preflight ALLOW.

Tools: `safehands_safe_execute`, `execute_swap`, `send_payment`, `approve_token`, `publish_risk_score`, `x402_pay_and_fetch`

### Advanced Env Wallet (local testnet only)

`WALLET_MODE=env` with `PRIVATE_KEY`. Advanced local/self-hosted testnet mode. Not default UX. Not for hosted backend key collection. Still preflight/policy-gated. RiskRegistry authorization not required by default.

### Operator / Demo

`AUTO_AUTHORIZE_AGENT_WALLET=true` with `RISK_REGISTRY_OWNER_PRIVATE_KEY`. Operator-only, testnet-only. Never commit owner key. Used for managed wallet onboarding and demo flows.

---

## Tools (29)

### 1. Safety Preflight

| Tool | Description |
|------|-------------|
| `safehands_preflight_check` | Policy preflight — returns ALLOW / WARN / BLOCK / REQUIRE_CONFIRMATION / REQUIRE_FUNDING / REQUIRE_TOKEN_REVIEW |
| `safehands_x402_preflight` | URL safety + payment amount + token + signer check before x402 payment |
| `safehands_risk_report` | Human-readable risk summary with on-chain V2 data when wallet provided |
| `safehands_wallet_health` | Wallet, signer, gas, x402 readiness, RiskRegistry V2 authorization status |
| `explain_risk` | Translate policy decisions into plain English |
| `token_registry_status` | Classify token as canonical / custom / unknown / invalid |
| `query_risk_registry` | Read on-chain risk record from RiskRegistry V2 |

### 2. Wallet + Agent Authorization

| Tool | Description |
|------|-------------|
| `create_agent_wallet` | Create managed testnet wallet (AES-256-GCM encrypted) |
| `get_agent_wallet` | Wallet address + metadata (private key never returned) |
| `get_agent_wallet_balance` | Managed wallet PHRS/USDC/USDT balances |

### 3. Risk Scoring + RiskRegistry

| Tool | Description |
|------|-------------|
| `assess_risk` | 5-dimension risk score (0–100) |
| `publish_risk_score` | Publish risk record to RiskRegistry V2 on-chain. Requires WRITE_TOOLS_ENABLED + managed wallet authorization. |

### 4. Payment + x402 Safety

| Tool | Description |
|------|-------------|
| `send_payment` | Native PHRS transfer with risk assessment and policy checks |
| `x402_pay_and_fetch` | Fetch x402 resource, pay only after HTTP 402 challenge |

### 5. Swap + Approval Safety

| Tool | Description |
|------|-------------|
| `execute_swap` | Swap tokens via FaroSwap/DODO with built-in risk gate |
| `approve_token` | ERC-20 approval (unlimited blocked by default) |

### 6. Simulation + Market Data

| Tool | Description |
|------|-------------|
| `simulate_transaction` | Dry-run via eth_call — zero gas |
| `estimate_gas` | Gas cost estimate in PHRS and USD |
| `check_token_security` | Token security profile via GoPlus API |
| `check_allowance` | ERC-20 allowance check |
| `get_token_price` | Real-time token price via DODO |
| `get_pool_info` | DODO pool info for any token pair |
| `get_gas_price` | Current gas price with trend classification |
| `get_wallet_balance` | PHRS / USDC / USDT balances |
| `get_transaction_status` | TX status by hash |
| `get_execution_history` | Wallet transfer history |

### 7. Agent Policy

| Tool | Description |
|------|-------------|
| `get_agent_policy` | Read active policy (limits, flags, profile) for an agent |
| `set_agent_policy` | Set/update policy: choose conservative/balanced/advanced or custom limits |

### 8. Guarded Execution

| Tool | Description |
|------|-------------|
| `safehands_safe_execute` | Preflight + execute in one call (blocks if not ALLOW). Managed execution requires RiskRegistry V2 authorization. |

---

## Per-Agent Policy

SafeHands supports per-agent policy profiles. Each agent can have its own limits and risk tolerance:

- **conservative** — low limits, strict confirmation, no unknown tokens
- **balanced** — moderate limits (default)
- **advanced** — high limits, allows unknown tokens and custom calls

Policy files: `.agents/policies/default.json`, `.agents/policies/{agentId}.json`

Hard safety rules (mainnet blocked, zero address blocked, SSRF blocked, unauthorized managed execution blocked) cannot be overridden by any policy.

---

## On-Chain RiskRegistry V2

| Field | Value |
|---|---|
| Contract | `0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25` |
| Network | Pharos Atlantic Testnet (688689) |

Features: authorized-agent registry, per-wallet risk records, action hash attestations, record validity/revocation, batch authorization.

RiskRegistry V2 is the only active registry. There is no V1 in active code, packaging, or supported usage.

---

## x402 Safety Model

SafeHands makes x402 safer for autonomous agents by validating HTTP 402 payment requirements before signing or settling any payment.

- `safehands_x402_preflight` = no payment, no authorization
- `x402_pay_and_fetch` = gated execution (WRITE_TOOLS_ENABLED required)
- User-signed x402 = no RiskRegistry authorization by default
- Managed-wallet x402 = RiskRegistry authorization required

Safety checks: SSRF/redirect SSRF, valid positive amount, challenge parse/validation, Pharos Atlantic network, allowlisted payment token, policy limit.

x402 payment idempotency/replay hardening is partially guarded by policy/preflight; full paymentId/requestHash retry cache is a future hardening item.

---

## Supported Tokens

Pharos Atlantic Testnet:
- **PHRS**: Native (`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`)
- **USDC**: `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` (Pharos Skill Engine)
- **USDT**: `0xE7E84B8B4f39C507499c40B4ac199B050e2882d5`
- **WBTC**: `0x0c64F03EEa5c30946D5c55B4b532D08ad74638a4`
- **WETH**: `0x7d211F77525ea39A0592794f793cC1036eEaccD5`
- **WPHRS**: `0x838800b758277CC111B2d48Ab01e5E164f8E9471`
- **altUSDC**: `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` (Circle-referenced)

## Chain

Pharos Atlantic Testnet — Chain ID 688689 — RPC: `https://atlantic.dplabs-internal.com/`
