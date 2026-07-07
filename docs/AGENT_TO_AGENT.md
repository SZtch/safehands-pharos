# SafeHands Agent-to-Agent (A2A) Contract

Other agents may call the **SafeHands Agent** before acting. SafeHands
returns one of four public decisions; the **calling agent is solely responsible**
for honoring the obligation. SafeHands only advises — it never executes, signs,
sends, approves, swaps, or publishes, and it holds no keys.

## The obligation contract

| Decision | Caller obligation | Caller responsibility |
|----------|-------------------|------------------------|
| `ALLOW` | `proceed` | Caller MAY proceed. SafeHands found no blocking risk; the caller still executes externally with its own signer. |
| `BLOCK` | `stop` | Caller MUST stop. The action is unsafe and must not be executed. |
| `REQUIRE_CONFIRMATION` | `ask_user_or_admin` | Caller MUST pause and obtain explicit user/admin confirmation before any execution. |
| `PREPARE_ONLY` | `prepare_handoff_no_execute` | Caller MUST NOT execute. It may only prepare/hand off the action; execution is disabled here. |

This table is the runtime source of truth: `OBLIGATION_CONTRACT` in
`src/agent/agentRuntime.ts` (`obligationFor(decision)`).

## Calling SafeHands from another agent

```ts
import { createGuardianAgent } from "safehands-pharos/agent"; // or "../../src/agent/index.js"

const guardian = createGuardianAgent();

const verdict = await guardian.checkForAgent("payment-agent", {
  url: "https://api.example.com/paid-resource",
  paymentAmountUsdc: "0.001",
});

// verdict.decision           → ALLOW | BLOCK | REQUIRE_CONFIRMATION | PREPARE_ONLY
// verdict.caller.obligation  → proceed | stop | ask_user_or_admin | prepare_handoff_no_execute
// verdict.readOnly           → true
// verdict.executionAvailable → false (by default)

switch (verdict.caller.obligation) {
  case "proceed":                     /* execute with your own signer */ break;
  case "stop":                        /* abort and surface the reason */ break;
  case "ask_user_or_admin":           /* pause for confirmation       */ break;
  case "prepare_handoff_no_execute":  /* prepare only; do not execute */ break;
}
```

## Request shape (`AgentRequest`)

All fields optional — the classifier decides the intent: `text`, `to`, `data`,
`value`, `txHash`, `address`, `token`, `url`, `paymentAmountUsdc`,
`paymentTokenAddress`, `payTo`, `agentId`, `network`, `chainId`, `inputType`.

## Policy ownership

The agent owner/admin may supply a stricter policy (`createGuardianAgent({ owner:
"agent", policy: { … } })`). Policy may only **raise** severity — it can never
relax a `BLOCK` or weaken an analyzer verdict. Default is the conservative public
`backend` policy.

## Guarantees

- **Read-only by construction** — `executionAvailable` is `false` by default;
  `readOnly` is always `true`. SafeHands has no code path to execute.
- **Fail-safe** — invalid or un-analyzable input returns `REQUIRE_CONFIRMATION`,
  never a silent `ALLOW`.
- **No secrets** — responses never contain private keys, premium RPC URLs, or
  facilitator secrets.

## Out of scope (Roadmap)

A network transport for A2A (RPC/queue/x402-paid invocation), mainnet execution,
and ecosystem integrations are **not** part of this phase. The A2A contract here
is an in-process orchestration interface.

