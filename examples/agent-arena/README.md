# SafeHands in the Agent Arena

These scenarios show how other agents (payment, DeFi, treasury, user) consult the **SafeHands
Agent** *before* acting. Every scenario is offline (no RPC, no keys) and self-checking. SafeHands
only advises: it never executes.

## Run

```bash
npm run agent:demo   # runs all scenarios as a showcase
npm run agent:x402   # Scenario A
npm run agent:defi   # Scenario B
npx tsx examples/agent-arena/treasury-agent-safe.ts        # Scenario C
npx tsx examples/agent-arena/user-agent-contract-call.ts   # Scenario D
```

## Scenarios

### A. Payment Agent · x402
A Payment Agent wants to pay an x402 resource. SafeHands checks the URL (SSRF),
amount vs policy/limit, token, and `payTo`.

| Fixture | Decision |
|---------|----------|
| Safe URL, small amount within limits | `PREPARE_ONLY` (safe, but execution disabled) |
| `http://localhost:…` (SSRF) | `BLOCK` |
| Amount over a tighter agent policy (under hard cap) | `REQUIRE_CONFIRMATION` |
| Amount over the hard payment cap | `BLOCK` |

### B. DeFi Agent · ERC-20 approval
A DeFi Agent wants an **unlimited USDC approval to an unknown spender**.

| Fixture | Decision |
|---------|----------|
| Unlimited approval → unknown spender | `BLOCK` |
| Small finite approval → unknown spender | `REQUIRE_CONFIRMATION` |

### C. Treasury Agent · Safe / MultiSend
A Treasury Agent vets a Safe / MultiSend transaction before a multisig signs.
Deep Safe/MultiSend decode is **Experimental**; SafeHands returns a clear,
conservative verdict (`REQUIRE_CONFIRMATION`) and flags `experimental: true`.

### D. User Agent · raw contract call
A user asks whether a raw contract call is safe. SafeHands classifies the call.

| Fixture | Decision |
|---------|----------|
| Unknown contract, unrecognized selector | `REQUIRE_CONFIRMATION` |
| Plain native transfer | `PREPARE_ONLY` |
| Malformed/invalid input | `REQUIRE_CONFIRMATION` (fail-safe) |

## What this proves

- SafeHands returns the **public four-value decision** for every action.
- **Caller obligations** are surfaced on every verdict (see
  [`docs/AGENT_TO_AGENT.md`](../../docs/AGENT_TO_AGENT.md)).
- Everything is **read-only**: `readOnly: true`, `executionAvailable: false`.
  No scenario signs, sends, approves, swaps, or publishes.
