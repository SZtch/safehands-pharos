# SafeHands Agent

> SafeHands Phase 4 is mainnet-first for Pharos Pacific read-only SafeHands checks.
> Execution, signing, managed wallets, and on-chain publishing are advanced
> self-hosted modes and remain **disabled by default**.

## What it is

The **SafeHands Agent** is a Pharos-native, **pre-execution safety
agent**. Given a user/agent action it returns exactly one public decision:

| Decision | Meaning |
|----------|---------|
| `ALLOW` | No blocking risk found. The caller may proceed (and executes externally). |
| `BLOCK` | The action is unsafe. The caller must stop. |
| `REQUIRE_CONFIRMATION` | Needs explicit user/admin confirmation before execution. |
| `PREPARE_ONLY` | Safe, but execution is disabled here — prepare/hand off only. |

SafeHands is **not** a wallet, token, NFT, DEX, bridge, custody product,
private-key manager, or auto-execution bot. It holds no keys and never signs,
sends, approves, swaps, creates/loads wallets, or publishes. It only *advises*.

## How it is built (layered on Phases 1–3)

The agent is a thin **orchestration layer** — it adds classification, policy, and
formatting, but **does not duplicate decision logic**:

- **Phase 1 — decision contract & boundaries** (`src/lib/guardian/decision.ts`,
  `src/lib/networks.ts`, `src/lib/config.ts`): the four public decisions, the
  mainnet-first network registry, and the four safety gates (all `false` by
  default).
- **Phase 2 — read-only analyzers** (`src/lib/analysis/`): EVM call, tx-hash,
  contract intel, approval, Safe/MultiSend, x402, gas, token.
- **Phase 3 — read-only HTTP handlers** (`src/api/routes.ts`): the agent routes
  intents through these pure handlers (which wrap the Phase 2 analyzers).
- **Phase 1 tools as evidence** (offline-safe): `classifyTokenRegistryStatus`
  enriches token/contract evidence. RPC-dependent tools (preflight, wallet-health,
  risk-report) are optional live integrations, not used in the offline path.

## Architecture (`src/agent/`)

| File | Responsibility |
|------|----------------|
| `agentIntentClassifier.ts` | Deterministic classification into 11 intents. |
| `agentToolRouter.ts` | Routes an intent to the matching Phase 3 handler / analyzer. |
| `agentPolicyResolver.ts` | Configurable policy; **escalate-only** enforcement. |
| `agentDecisionFormatter.ts` | Builds the `AgentDecision`; applies `PREPARE_ONLY`. |
| `agentRuntime.ts` | Agent-to-Agent obligation contract + demo runner. |
| `SafeHandsGuardianAgent.ts` | The agent: classify → route → policy → format. |
| `index.ts` | Public surface. |

Pipeline: **classify → route → applyPolicy → format**. Invalid/un-analyzable
input fails safe to `REQUIRE_CONFIRMATION` (never a silent `ALLOW`).

### Intents

`tx_hash_check`, `contract_check`, `raw_transaction_intent`, `erc20_approval`,
`permit2_approval`, `safe_transaction`, `x402_payment_request`, `native_transfer`,
`unknown_contract_call`, `policy_question`, `risk_explanation`.

### Policy (configurable, escalate-only)

`GuardianPolicy` fields: `maxNativeTransferWei`, `maxApprovalAmount`,
`maxX402PaymentUsdc`, `maxDailyAgentSpendUsdc`, `trustedRecipients`,
`trustedSpenders`, `blockUnlimitedApproval`, `requireConfirmationForUnknownContract`.
Ownership: `backend` (public default) · `user` · `dapp` · `agent`. Policy may only
**raise** severity or annotate — it can never relax a `BLOCK`.

### Decision output

Every response includes: `decision`, `riskLevel`, `summary`, `reasons`,
`recommendedAction`, `evidence` (analyzer output), `readOnly: true`,
`executionAvailable: false` (by default), `nextStep`, `intent`,
`callerObligation`.

### PREPARE_ONLY

For an *execution-intent* action whose analyzer verdict is `ALLOW`, the agent
returns `PREPARE_ONLY` when `isExecutionAvailable() === false` (the default —
mainnet `executionAllowed=false` and all gates off). Read-only intents keep the
analyzer verdict.

## Safety boundaries

- Pharos Pacific Mainnet **read/check/analyze: yes**.
- Execution / signing / sending / publishing: **disabled by default**.
- Managed wallets: **disabled by default**. No private keys. No custody.
- Read-only **by construction**: `src/agent/` imports only analyzers, Phase 3
  handlers, and config — never a signer, managed-wallet, write-tool, or publish
  module.

## Demo commands

```bash
npm run agent:demo   # all Agent Arena scenarios (showcase)
npm run agent:x402   # Payment Agent (x402)
npm run agent:defi   # DeFi Agent (unlimited approval → BLOCK)
npx tsx examples/agent-arena/treasury-agent-safe.ts
npx tsx examples/agent-arena/user-agent-contract-call.ts
```

All demos are offline (no RPC, no keys) and self-checking.

## Live vs Experimental vs Roadmap

| Capability | Status |
|------------|--------|
| Intent classification, policy resolution, decision formatting, A2A contract | **Live** (read-only) |
| Routing to Phase 2 analyzers / Phase 3 handlers | **Live** (read-only) |
| Deep Safe/MultiSend decode, Permit2 deep decode | **Experimental** (read-only, flagged) |
| Live mainnet read-only checks via injected RPC | **Live capability** (default wiring) |
| Execution / signing / managed wallets / on-chain publishing | **Advanced self-hosted / disabled by default / Roadmap** |
| x402 **mainnet payment**, paid agent API, ecosystem integrations | **Roadmap** |

See also: [`AGENT_ARENA.md`](./AGENT_ARENA.md) and
[`AGENT_TO_AGENT.md`](./AGENT_TO_AGENT.md).

