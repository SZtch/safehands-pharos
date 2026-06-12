---
name: safehands-pharos-guard
description: >
  REQUIRED before any Pharos AI agent write action involving token approvals, payments, swaps,
  x402 paid requests, or custom contract calls. SafeHands runs policy-based preflight checks
  and returns ALLOW, WARN, BLOCK, REQUIRE_CONFIRMATION, REQUIRE_FUNDING, or REQUIRE_TOKEN_REVIEW
  before execution. Use this skill as a safety firewall before invoking Pharos Skill Engine
  write operations.
version: 1.3.0
requires:
  anyBins:
  - npx
---

# SafeHands Pharos Guard

Transaction Safety Firewall / Guardrail Skill for Pharos AI agents. SafeHands checks whether an action is safe before execution on Pharos Atlantic Testnet.

SafeHands complements the official `pharos-skill-engine`. It is not a replacement. The official Skill Engine provides general on-chain capabilities (queries, transactions, contract deployments). SafeHands answers: **"Is this action safe to execute?"**

```text
User intent
→ SafeHands preflight (ALLOW / WARN / BLOCK / REQUIRE_CONFIRMATION)
→ Pharos Skill Engine or MCP execution (only if safe)
→ SafeHands risk report
```

## Real-World Use Cases

1. **Anti-Drain Protection:** An AI Agent is tricked by a prompt injection to approve `999999 USDC` to a hacker's contract. SafeHands intercepts the action, detects an unlimited approval, and returns `BLOCK`.
2. **SSRF Payment Prevention:** A malicious website asks the AI Agent to pay `0.001 USDC` to an x402 URL pointing to `http://localhost:8080/admin`. SafeHands detects the private IP address, blocks the HTTP request, and returns `BLOCK` preventing server compromise.
3. **Fake Token Detection:** An AI Agent decides to buy a token named "Official Pharos Coin" on the testnet. SafeHands checks the `token_registry_status`, realizes it's a fake token not listed in the official docs, and returns `WARN` to ask the human for confirmation before swapping.

## Prerequisites

1. **Install SafeHands** (via npx, no global install required):
   ```bash
   npx safehands-pharos --help
   ```
   If `npx safehands-pharos` is not available, install globally:
   ```bash
   npm install -g safehands-pharos
   ```

2. **No private key required** for safety checks. Private keys are only needed for write execution (which is disabled by default).

## Network Configuration

SafeHands reads network configuration from its built-in constants. Default network: **Atlantic Testnet**.

| Field | Value |
|-------|-------|
| Environment | `atlantic-testnet` |
| Chain ID | `688689` |
| RPC URL | `https://atlantic.dplabs-internal.com` |
| Native Token | `PHRS` |
| Primary USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` |
| Mainnet | `false` |

Token addresses are sourced from the official Pharos Skill Engine `assets/tokens.json`.

## Safety Model

SafeHands enforces these guardrails by default:

- **Block** mainnet actions
- **Block** chain ID mismatch
- **Block** unlimited token approvals
- **Block** SSRF-sensitive x402 URLs (localhost, private IPs)
- **Block** payments above configured limits
- **Block** x402 payments above `MAX_X402_PAYMENT_USDC`
- **Warn** when token is custom or non-registry
- **Warn** when token security provider is unavailable
- **Require confirmation** for medium-risk actions
- **Allow** low-risk Pharos Atlantic Testnet actions

Write tools are disabled by default (`WRITE_TOOLS_ENABLED=false`).

## Capability Index

Load the corresponding reference file based on user needs to get full command templates.

| User Need | Capability | Detailed Instructions |
|-----------|------------|----------------------|
| Check whether an on-chain action is safe before execution | SafeHands Preflight Check | → `references/safehands.md#safehands-preflight-check` |
| Check whether an x402 paid endpoint is safe to pay | SafeHands x402 Preflight | → `references/safehands.md#safehands-x402-preflight` |
| Check whether an agent wallet is ready to act | SafeHands Wallet Health | → `references/safehands.md#safehands-wallet-health` |
| Check whether a token address is canonical or custom | Token Registry Status | → `references/safehands.md#token-registry-status` |
| Explain why an action was blocked or warned | Explain Risk | → `references/safehands.md#explain-risk` |
| Generate a human-readable safety report | SafeHands Risk Report | → `references/safehands.md#safehands-risk-report` |

## General Error Handling

Before executing commands, the Agent should perform pre-checks; when commands fail, provide user-friendly error messages based on the structured JSON output.

| Error Scenario | Error Code | Handling |
|---------------|-----------|----------|
| Invalid address format | `INVALID_TOKEN_ADDRESS` / `INVALID_WALLET_ADDRESS` | Prompt to check address format (0x + 40 hex characters) |
| Write tools disabled | `WRITE_TOOLS_DISABLED` | Inform user that write tools are disabled by default |
| SSRF blocked URL | `SSRF_BLOCKED` | Do not fetch or pay; inform user the URL is blocked |
| Mainnet action attempted | `MAINNET_NOT_SUPPORTED` | Do not execute; SafeHands is testnet-only |
| Chain ID mismatch | `CHAIN_ID_MISMATCH` | Switch to Pharos Atlantic Testnet (688689) |
| Signer not available | `NO_SIGNER_AVAILABLE` | Ask user to configure wallet mode |
| Invalid input JSON | `INVALID_INPUT_JSON` | Fix the JSON input and retry |
| Policy blocked | `POLICY_BLOCKED` | Explain reasons to the user; do not execute |

See `references/safehands.md` for detailed error handling tables for each operation.

## Security Reminders

- **No private key required** for read-only safety checks (preflight, token registry, wallet health, explain risk).
- **Write tools are disabled by default.** Set `WRITE_TOOLS_ENABLED=true` only for trusted testnet execution.
- **Private keys are never returned** in CLI or MCP responses.
- **Unlimited approvals are blocked** unless explicitly allowed via `ALLOW_UNLIMITED_APPROVAL=true`.
- **SSRF protection** blocks localhost and private IP x402 URLs by default.
- **Testnet only.** SafeHands is not audited for mainnet production use.

## Write Operation Pre-checks (Required for All Write Operations)

For all write operations, the Agent must run SafeHands preflight first:

```bash
npx safehands-pharos skill safehands_preflight_check --input-json '<action_json>'
```

1. If `decision` is `BLOCK`, **stop execution**.
2. If `decision` is `WARN`, explain the risk and ask for user confirmation.
3. If `decision` is `REQUIRE_CONFIRMATION`, ask for explicit user approval.
4. If `decision` is `REQUIRE_FUNDING`, ask user to fund the wallet.
5. If `decision` is `REQUIRE_TOKEN_REVIEW`, ask user to verify the token contract.
6. If `decision` is `ALLOW`, proceed with the Pharos Skill Engine write operation.

For full command templates, parameters, output parsing, and error handling, see [`references/safehands.md`](references/safehands.md).
