---
name: safehands-pharos
description: Pharos Pacific Mainnet-first SafeHands Agent for AI-agent transaction safety, x402 preflight, token checks, and gated execution.
---

# SafeHands Pharos

SafeHands is a **SafeHands Agent composed of 33 registered MCP tools** for the Pharos ecosystem. It protects AI agents by checking transaction intent before the agent signs, approves, swaps, pays an x402 resource, or publishes risk data, and exposes an **on-chain agent reputation oracle** (`get_agent_reputation`) so any agent can read a counterparty's verified-safe track record as a composable trust signal.

SafeHands is:

> Read-only SafeHands by default, wallet handoff/user-signed prepare available, optional gated execution only with explicit env flags and authorization.

## Core capabilities

1. **Policy preflight**: Return deterministic `ALLOW`, `BLOCK`, `REQUIRE_CONFIRMATION`, or `PREPARE_ONLY` decisions for payments, approvals, swaps, contract calls, and x402 requests. In the read-only default, execution intents come back as `PREPARE_ONLY`: validated for you to sign externally, never executed here.
2. **Risk analysis**: Produce structured risk evidence, human-readable reports, and risk-score explanations.
3. **Pacific Mainnet token checks**: Classify tokens using the active Pharos network registry. Unsupported Pacific Mainnet tokens fail clearly instead of falling back to Atlantic/testnet addresses.
4. **x402 safety**: Validate URL, chain, token, payment limit, and signer readiness. Default Pacific Mainnet x402 token is USDC; WPROS/PROS-compatible wrapped payment is also supported. **Permissionless-first**: `safehands_x402_preflight` needs no key and no authorization, and self-signed x402 payments (the agent's own `X402_SIGNER_PRIVATE_KEY`) require no SafeHandsRegistry authorization; only the optional managed/custodial wallet path can be allowlist-gated.
5. **Gated execution**: Optional write tools for swaps, payments, approvals, x402 fetches, and risk publishing are disabled by default and require explicit operator configuration. These write tools are experimental and unaudited; they are opt-in, self-hosted, single-tenant only.
6. **On-chain layer**: Includes `SafeHandsRegistry` and `SafeHandsAttestation` contracts for registry and proof workflows when configured.

## What SafeHands refuses by default

- It will not hold or create a wallet in default mode.
- It will not sign transactions in default mode.
- It will not broadcast transactions in default mode.
- It will not allow unlimited token approvals by default.
- It will not execute or approve a token whose security intelligence is unavailable (provider outage / token not yet indexed): fail-closed, not confirmable; registry-canonical tokens excepted.
- It will not swap an input token it cannot price against the USD spend caps (denied by default).
- It will not fetch localhost/private-IP x402 URLs unless local demo mode is explicitly enabled.
- It will not use Atlantic/testnet token addresses for Pacific Mainnet token operations.

## Example tasks

- “Run SafeHands preflight before this agent approves USDC.”
- “Check whether this token is canonical on Pharos Pacific Mainnet.”
- “Explain why this approval was blocked.”
- “Check x402 preflight for this paid API before signing.”
- “Check my managed agent wallet health.”

## Information needed from the user or agent

- Target chain ID or network, if not using the default Pacific Mainnet.
- Transaction intent: payment, approval, swap, contract call, x402 fetch, or risk publishing.
- Token symbol/address and amount when relevant.
- Recipient, spender, target contract, or URL when relevant.
- Agent ID only when using managed-wallet mode.

## Deliverables

- Structured JSON response with `success`, `data`, `error`, and `timestamp`.
- SafeHands decision and risk level.
- Plain-English reasons and required actions.
- Network, token-registry, signer, and policy evidence where relevant.

## Required usage by other agents

Before executing any write transaction, a calling agent should call `safehands_preflight_check` or the relevant SafeHands tool. If SafeHands returns `BLOCK`, the agent must stop and explain the reason to the user. If SafeHands returns `REQUIRE_CONFIRMATION`, the agent should ask the user for explicit confirmation or further review before continuing.
