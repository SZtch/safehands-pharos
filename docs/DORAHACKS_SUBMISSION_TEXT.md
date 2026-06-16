# SafeHands — DoraHacks Submission

## Project Name

SafeHands

## One-Liner

Reusable safety Skill for Pharos AI agents before on-chain execution.

## Short Description

SafeHands is an open-source reusable Pharos Skill that acts as a safety gateway for AI agents performing on-chain actions. It provides 29 MCP-style tools covering preflight checks, risk scoring, policy enforcement, wallet management, and gated execution — all on Pharos Atlantic Testnet. Any agent can use SafeHands freely for safety checks; execution is intentionally gated by authorization, funding, policy, and risk approval.

## Long Description

### Problem

AI agents interacting with blockchains face real safety risks: sending to wrong addresses, approving unlimited token spending, executing on the wrong chain, paying invoices to malicious endpoints, or exceeding reasonable spending limits. Without guardrails, a single bad decision can drain a wallet.

### Solution

SafeHands is a reusable Pharos Skill that sits between an AI agent and the blockchain. Before any on-chain action — payment, swap, approval, x402 payment, custom contract call — SafeHands evaluates the action through multiple safety layers:

1. **Strict input validation** — schema enforcement, address validation, amount bounds
2. **Chain/network guards** — mainnet and Pacific are blocked; only Pharos Atlantic Testnet (688689) is allowed
3. **Risk scoring** — multi-factor risk assessment considering address reputation, amount patterns, token registry status
4. **Per-agent policy** — configurable profiles (conservative / balanced / advanced / custom) with per-agent limits for payments, swaps, approvals, and x402 actions
5. **Hard safety rules** — mainnet blocking, SSRF protection, unlimited approval blocking, zero-address blocking — cannot be overridden by any policy
6. **RiskRegistry V2** — on-chain Solidity contract for authorized-agent registry and risk attestation, deployed on Pharos Atlantic Testnet
7. **Execution gating** — managed execution requires RiskRegistry V2 authorization, funding checks, policy compliance, and preflight approval

### Reusable Skill Concept

SafeHands is designed as a reusable Pharos Skill: other AI agents call SafeHands tools via MCP (Model Context Protocol) to get safety decisions before acting. Preflight and risk tools are freely available. Execution tools are gated. This architecture lets any agent add on-chain safety without building its own guardrails.

### Execution Modes

SafeHands supports multiple execution modes for different use cases:
- **Preflight / Read-only** — no wallet, no auth, safety checks only
- **User-signed** — user signs transactions after SafeHands validates
- **Managed execution** — auto-created wallets with RiskRegistry V2 authorization
- **Env wallet** — advanced local testnet development
- **Operator / demo** — onboarding and demo flows

### x402 Safety

SafeHands includes x402 payment safety: preflight checks for x402 invoices, SSRF/redirect protection for payment endpoints, amount/challenge validation, and policy-driven limits.

### Testnet-Only Scope

SafeHands is Pharos Atlantic Testnet-only by design. It features production-inspired safety architecture but is not audited for mainnet custody. Mainnet and Pacific are blocked at the chain ID level.

## Key Features

- 29 MCP-style tools grouped by capability
- Multi-layer safety: validation, chain guard, risk scoring, policy, hard rules, V2 authorization
- Per-agent policy profiles (conservative / balanced / advanced / custom)
- RiskRegistry V2 on-chain contract (deployed on Pharos Atlantic Testnet)
- x402 payment safety with SSRF protection
- Managed agent wallet creation and health monitoring
- No private key required for preflight/read-only usage
- Deterministic test suite: 75 smoke tests, 37 contract tests, 10 demo scenarios
- Hard safety rules that cannot be bypassed by any policy or prompt injection

## RiskRegistry V2

```
Network:  Pharos Atlantic Testnet
Chain ID: 688689
Address:  0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
Owner:    0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5
```

## Tech Stack

- TypeScript / Node.js
- MCP (Model Context Protocol) tools via stdio
- Solidity (RiskRegistry V2 contract)
- Hardhat (contract testing and deployment)
- Pharos Atlantic Testnet (Chain ID 688689)
- Viem (blockchain interaction)
- Zod (schema validation)
- x402 safety flow (payment preflight and gating)

## Known Limitations

- Pharos Atlantic Testnet-only — mainnet/Pacific blocked by design
- Not audited for mainnet custody
- User-signed prepared transaction output is a future enhancement
- Full x402 idempotency cache is future hardening
- Per-agent daily spend accumulation is documented but global
- npm audit vulnerabilities may remain from dependencies

## Links

- Repository: https://github.com/SZtch/safehands-pharos
- Package/NPM: https://www.npmjs.com/package/safehands-pharos
- Demo Video: to be added before final review
- Try it now: `npx safehands-pharos --demo`
