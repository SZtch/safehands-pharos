# Integrate SafeHands into your agent

For authors of AI agents that move funds on Pharos Pacific Mainnet (chainId 1672): steward agents on Anvita Flow, and self-hosted agents speaking MCP or HTTP. SafeHands is the transaction firewall for AI agent finance on Pharos: your agent finds the opportunity and holds the wallet; SafeHands supplies the deterministic risk engine and the verification layer. It never holds keys and never signs.

## Where SafeHands fits: agent autonomy levels

| Level | Your agent can | SafeHands' role |
|---|---|---|
| 0 | Inform | Optional: verified facts (prices, balances, registry status) |
| 1 | Analyze and recommend | Verdicts back every recommendation with evidence |
| 2 | Prepare transactions; a human signs | Verdict-gated prepare: a BLOCK never produces a wallet request |
| 3 | Auto-execute within limits | The limit IS the verdict: auto-execute only what SafeHands ALLOWs |
| 4 | Manage a portfolio autonomously | Discouraged; nothing makes an unbounded LLM safe with funds |

SafeHands exists to make Level 2 and Level 3 agents safe. The principle across all levels: your model proposes, a deterministic engine decides, the user's wallet executes. The decision vocabulary (ALLOW / BLOCK / REQUIRE_CONFIRMATION / PREPARE_ONLY, and the hosted allow / warn / block bands) is specified in [DECISION_CONTRACT.md](./DECISION_CONTRACT.md).

## The core loop (4 calls)

Whatever the surface, the integration is the same loop:

1. **Resolve names.** `resolve_alias` turns "USDC", "okx", "morpho" into registry-canonical addresses with verification status. Never let your model resolve a token or protocol name from its own memory: an unknown alias is a stop signal, not a prompt to search elsewhere.
2. **Check the intent.** `analyze` the planned action (transfer, swap, approval, deposit) BEFORE building a transaction. You get a verdict, a risk score, and plain-language reasons your agent can show its user.
3. **Check the exact bytes.** After your agent builds the transaction, send the exact calldata for a final verdict before signing. The intent check covers the plan; only the calldata check covers what will actually execute.
4. **Read state through the same lens.** Balances (`get_token_balance`), allowances (`check_allowance`), prices (`get_token_price`, live Chainlink only), and on-chain risk records (`query`) come with the same fail-closed discipline: absent evidence is reported as UNKNOWN, never guessed.

Rules your agent must honor: obey the `decision` field rather than re-deriving one from raw numbers; treat a BLOCK as final for that action (offer a safer alternative and re-check it as a fresh call); never auto-confirm a REQUIRE_CONFIRMATION.

## Hosted: call the `safehands` agent on Anvita Flow

The hosted agent is live on [Anvita Flow](https://flow.anvita.xyz/home) as `safehands`, discoverable and callable by any Steward Agent; the platform bills 0.01 USDC per call on its x402/USDC rail. Speak to it in natural language and include the wallet address you act for:

```
Before I sign: check this swap for 0xYourUserWallet on Pharos.
tokenIn USDC, tokenOut PROS, amount 100, venue okx.
Then here is the exact calldata to verify: 0x38ed1739...
```

The hosted agent resolves names from the registry itself, uses wallet context for read-only lookups, and answers with the structured Safety Report (verdict, score, evidence, final action). It signs and broadcasts nothing.

## Self-hosted: SDK, HTTP, or MCP

**Tightest: the SDK, in your own code.** Import the deterministic policy engine and call it right before you sign, no server and no network:

```ts
import { evaluateActionPolicy } from "safehands-pharos";
const verdict = evaluateActionPolicy(action); // ALLOW / BLOCK / REQUIRE_*
if (!verdict.safeToExecute) return; // do not auto-sign
```

A complete, runnable starter (an agent that consults SafeHands before three actions and signs only what clears) is in [`examples/agent-starter/`](../examples/agent-starter/): `npm install safehands-pharos && npx tsx safe-agent.ts`, or from this repo `npm run agent:starter`.

**HTTP or MCP** run the read-only backend next to your agent (no keys needed):

```bash
npm install && npm run build && node dist/api/server.js   # http://localhost:4022
```

Verdict on a transaction your agent built:

```bash
curl -s -X POST http://localhost:4022/guardian/check \
  -H 'content-type: application/json' \
  -d '{"to":"0x75f21a97bd89a9a5683a9f46b5d5b4a080708dea","data":"0x...","value":"0","chainId":1672}'
# -> { "decision": "ALLOW|BLOCK|REQUIRE_CONFIRMATION|PREPARE_ONLY", "riskLevel": ..., "reasons": [...] }
```

Verdict-gated, wallet-ready handoff (Level 2): `POST /wallet/prepare` returns an unsigned `walletRequest` plus a `preparedTransactionHash` binding the verdict to those exact bytes, and produces NO request on a BLOCK; the user's own wallet signs and `POST /broadcast/signed` completes the trail. See [PREPARE_AND_HANDOFF.md](./PREPARE_AND_HANDOFF.md). MCP integrators get the same policy engine as tools (`safehands_preflight_check`, `analyze_transaction`, `check_token_security`, ...) via `node dist/index.js`; the full catalog is in [TOOLS.md](./TOOLS.md).

## The agent-to-agent contract

SafeHands advises; it never executes. When another agent calls it, SafeHands returns one of four public decisions (`ALLOW` / `BLOCK` / `REQUIRE_CONFIRMATION` / `PREPARE_ONLY`) and the **calling agent is solely responsible for honoring it**: stop on `BLOCK`, get explicit human/operator confirmation on `REQUIRE_CONFIRMATION`, and never treat a verdict as a signature. A verdict binds to exactly what was analyzed (see the `verdictBinding` digest and its expiry); acting on different bytes, or after expiry, means the verdict no longer applies.

## What SafeHands never does

No custody, no signing, no broadcasting on the hosted surface; write paths exist only self-hosted, off by default, behind explicit operator gates. No prices except live Chainlink reads (a stale feed is reported, never quoted). No trust from anywhere but the registry's first-party evidence. If your integration ever sees SafeHands claim otherwise, treat it as an impersonation and verify you are talking to the real deployment.
