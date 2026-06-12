---
name: safehands-guard
version: 1.0.0
description: Transaction Safety Firewall / Guardrail Skill for Pharos Skill Engine on Pharos Atlantic Testnet.
author: SZtch
chain: pharos-atlantic-testnet
tags: [pharos, skill-engine, guardrail, transaction-safety, x402, risk, ai-agent]
---

# SafeHands Guard

SafeHands Guard is a **Transaction Safety Firewall / Guardrail Skill** for Pharos Skill Engine. It checks whether an AI agent action, token approval, x402 payment, swap, wallet action, or token interaction is safe before execution on Pharos Atlantic Testnet.

Use this skill when the user wants to check whether an AI agent action, transaction, token approval, x402 payment, swap, wallet action, or token interaction is safe before execution on Pharos Atlantic Testnet.

SafeHands complements Pharos Skill Engine. It is not a replacement for Pharos Skill Engine and should not be used as a generic Web3 toolbox.

```text
User intent
→ SafeHands preflight
→ ALLOW / WARN / BLOCK / REQUIRE_CONFIRMATION
→ Pharos Skill Engine or MCP execution
→ SafeHands risk report
```

## When to use this skill

Use SafeHands when:

- The user or agent is about to send PHRS, approve tokens, swap assets, call a custom contract, publish risk data, or pay an x402 endpoint.
- The user asks if a token address is canonical, custom, non-registry, unknown, or invalid.
- The user asks why an action was blocked, warned, or requires confirmation.
- The agent needs a wallet readiness check before an on-chain or x402 action.

## When not to use this skill

Do not use SafeHands as the primary execution engine for generic Web3 tasks. If the user only wants to deploy a contract, write Solidity, or perform a normal Pharos Skill Engine tutorial flow, use the appropriate Pharos Skill Engine capability first and add SafeHands only as the preflight guardrail.

## Pharos Atlantic Testnet context

| Field | Value |
|---|---|
| Environment | `atlantic-testnet` |
| Chain ID | `688689` |
| Mainnet | `false` |
| Default write tools | disabled |
| Safety posture | testnet-only guardrail |

## Capability Index

| User wants to... | Capability | Reference |
|---|---|---|
| Check whether an on-chain action is safe before execution | SafeHands Preflight Check | references/safehands.md#safehands-preflight-check |
| Check whether an x402 paid endpoint is safe to pay | SafeHands x402 Preflight | references/safehands.md#safehands-x402-preflight |
| Check whether an agent wallet is ready to act | SafeHands Wallet Health | references/safehands.md#safehands-wallet-health |
| Check whether a token address is canonical or custom | Token Registry Status | references/safehands.md#token-registry-status |
| Explain why an action was blocked or warned | Explain Risk | references/safehands.md#explain-risk |
| Generate a human-readable safety report | SafeHands Risk Report | references/safehands.md#safehands-risk-report |

## Natural language examples

- "Check if this token approval is safe before execution."
- "Run SafeHands preflight before paying this x402 endpoint."
- "Explain why this action was blocked."
- "Check whether this token is canonical on Pharos Atlantic Testnet."
- "Tell me if this wallet is ready for x402 payment."

## Agent behavior guidelines

1. Always run `safehands_preflight_check` before any write action.
2. If `decision` is `BLOCK`, do not execute the action.
3. If `decision` is `WARN`, explain the risk and ask for user confirmation.
4. If `decision` is `REQUIRE_CONFIRMATION`, ask for explicit user approval.
5. If `decision` is `REQUIRE_FUNDING`, ask the user to fund the testnet wallet before continuing.
6. If `decision` is `REQUIRE_TOKEN_REVIEW`, ask the user to verify the exact token contract.
7. If `decision` is `ALLOW`, the action may continue through Pharos Skill Engine or MCP execution.
8. Never silently replace a user-provided token address.
9. Never request or reveal private keys in the conversation.
10. Treat SafeHands output as a safety decision, not a guarantee that external contracts are audited.

## Safety disclaimer

SafeHands is built for Pharos Atlantic Testnet hackathon workflows. It is not audited for mainnet production use. Write tools are disabled by default and require explicit configuration. Managed wallet storage is testnet-grade only.

For command templates, parameters, output parsing, and error handling, see [`references/safehands.md`](references/safehands.md).
