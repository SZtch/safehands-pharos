# SafeHands starter: make your agent check before it signs

The smallest real integration. Your agent decides what it wants to do, SafeHands
decides whether that action is safe, and your agent signs only when the verdict
allows it. SafeHands holds no keys and never signs: it verifies, your wallet
executes.

## Run it

```bash
npm install safehands-pharos
npx tsx safe-agent.ts
```

You will see the agent consult SafeHands before three actions: a swap it clears
and signs, an unlimited approval it refuses, and an over-limit payment it holds
back. All deterministic and offline, no keys or RPC required.

## The pattern you copy

One function, added right before you sign:

```ts
import { evaluateActionPolicy } from "safehands-pharos";
import type { ActionPolicyInput } from "safehands-pharos";

function safeToSign(action: ActionPolicyInput): boolean {
  const verdict = evaluateActionPolicy(action);
  // ALLOW / BLOCK / REQUIRE_CONFIRMATION / REQUIRE_FUNDING / REQUIRE_TOKEN_REVIEW
  return verdict.safeToExecute; // true only on a clean ALLOW
}

// ...in your agent, before signing:
if (safeToSign(action)) {
  signAndBroadcast(action); // your own signer
} else {
  // do not auto-sign: surface verdict.reasons to a human, or adjust the action
}
```

`evaluateActionPolicy` returns a structured result: `decision`, `riskLevel`,
`safeToExecute`, `reasons`, `requiredActions`, and per-check detail. For a
human-readable line, use `explainPolicyResult(verdict)`.

## What SafeHands decides

The engine is deterministic: the same action always yields the same verdict, and
every verdict traces to a named check (unlimited approval, over-limit amount,
denylisted recipient, unsupported chain, and so on). It never guesses. The
default limits are conservative; tune them with an agent policy when you are
ready (see `docs/DECISION_CONTRACT.md` for the decision vocabulary and thresholds).

## Important: SafeHands advises, you enforce

`evaluateActionPolicy` gives you a verdict. It cannot stop your code from
signing anyway. The safety only exists because this example checks
`safeToExecute` and acts on it. Wire the check in front of your signer and honor
it; that is the whole contract.

## Not self-hosting? Use the hosted agent instead

If you are building on Anvita Flow, you do not need this library at all: call the
hosted `safehands` agent from your Steward Agent and it returns the same kind of
verdict, with no infrastructure to run. This starter is for developers who want
the verdict logic inside their own code. Both are the same policy model; see
[docs/AGENT_INTEGRATION.md](../../docs/AGENT_INTEGRATION.md) for the full picture,
including the L0 to L4 autonomy levels and where SafeHands fits.
