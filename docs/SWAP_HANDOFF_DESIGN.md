# Swap handoff design note

Status: designed, not scheduled. Nothing in this document is implemented unless it names a shipped artifact explicitly. The positioning rule stays in force everywhere: SafeHands verifies and prepares; the user's wallet signs. SafeHands never holds keys and never signs.

## Goal

Let an agent (or a hosted caller such as an Anvita Flow steward agent) go from a swap intent ("swap 100 USDC to PROS") to a signed transaction, with SafeHands in the loop end to end, without SafeHands ever taking custody or signing.

## What already exists (shipped)

| Piece | Where | Notes |
|---|---|---|
| Verdict-gated execution (self-hosted, off by default) | `execute_swap` | Full write gate stack; venues: DODO (default) and OKX (`venue: okx`, registry-verified router/spender, signed API, fail-closed without credentials) |
| Wallet-ready handoff for a PRE-BUILT transaction | `POST /wallet/prepare` | Verdicts {to,data,value}, returns `walletRequest` + `preparedTransactionId` + `preparedTransactionHash`; BLOCK produces no request |
| Signed-broadcast completion + attestation | `POST /broadcast/signed` | External wallet signs; SafeHands relays and attests |
| Offline calldata decode in the hosted engine | `anvita/safehands/scripts/safehands-engine.js` | Approve/permit/transfer/admin selectors, escalate-only floors |

The missing link: nothing today BUILDS a swap transaction from an intent on the read-only surface. `execute_swap` builds one but only inside the gated write path.

## Piece 1: `POST /wallet/prepare-swap` (self-hosted backend)

Input: `tokenIn`, `tokenOut`, `amountIn`, `userAddress`, optional `slippageTolerance`, optional `venue` (default `okx`: the registry-verified venue is the right default for a path whose whole story is "prepared by a venue the firewall verified").

Flow, in order, each step fail-closed:

1. Resolve tokens and chain gating (reuse the venue clients; OKX credentials live only in this backend's env).
2. Fetch the quote; run the existing hard quote guards (price impact ceiling, non-positive amountOut).
3. Containment: quote router/spender must pass the venue allowlist (registry-verified pair for OKX).
4. Verdict the EXACT quoted calldata through the same guardian check `/wallet/prepare` uses. BLOCK returns reasons and no wallet request, always.
5. If `tokenIn` is not native and allowance is short, return TWO wallet requests in order: a LIMITED approval for exactly `amountIn` (never unlimited) and the swap itself. Each is independently verdicted and independently hash-bound.
6. Response: `walletRequests[]` (each with `preparedTransactionId` + `preparedTransactionHash`), quote summary (`amountOut`, `minReceiveAmountWei`, `priceImpact`, venue), verdict block, and an `expiresAt` (quotes go stale; a signed-after-expiry request should be re-prepared).

The response is advisory until signed: the user's wallet (external wallet, or an Anvita steward wallet, which platform-side can sign transactions per the operator's account check on 2026-07-16) signs and broadcasts, optionally completing through `/broadcast/signed` for the attestation trail.

## Piece 2: hosted delegation (requires a deliberate charter amendment)

The hosted Anvita engine stays zero-dependency and never gains route or pricing logic. Instead, the hosted agent MAY delegate preparation to ONE operator-pinned, first-party, https-only provider endpoint (this backend), following the precedent of the registry-committed dataURI fetch: scheme-checked, no local or reserved hosts, no redirect following, bounded body read. Unset endpoint = feature absent; the agent remains verdict-only, which is the current shipped state.

Defense in depth: the hosted engine treats the provider response as UNTRUSTED input. It re-decodes the returned calldata with its own offline decoder and composes its own verdict with the backend's, escalate-only. A compromised or buggy backend can therefore lose availability but cannot mint an ALLOW.

Required alongside the amendment: `capability-scope.md` gains a provider-endpoint row in the allowed-sources table, and the hosted SKILL.md documents the delegation honestly.

## Piece 3: conversational rules (hosted SKILL/output-template)

- Never guess an unstated `tokenIn`. Ask one clarifying question and still deliver everything that does not depend on it (verified venues, safe-approval guidance).
- Dollar-denominated amounts convert at confirmation time from live Chainlink reads, never from a stale earlier quote.
- Every swap conversation closes with the two-phase invite: build the transaction, then send the exact calldata back for a final verdict before signing.
- Agent intelligence is escalate-only: the agent may be MORE cautious than the verdict (hold, ask again, propose a smaller size, re-quote, compare venues, add context like "this is most of your balance"), never less. On a BLOCK it looks for a passing alternative (smaller size, different venue) and re-submits that for its own verdict; it never argues with or reinterprets the decision it was given.

## Quote economics in the decision contract

Price impact, minReceive, and quote freshness are mapped into the existing four-value decision vocabulary; the calling agent obeys `decision` and displays the numbers, it never re-derives a decision from raw numbers.

| Signal | Mapping | Rationale |
|---|---|---|
| Impact above the ceiling (max of `slippageTolerance`, `MAX_SLIPPAGE_PCT`) | BLOCK, never confirmable, NO wallet request | The bad price is inside the quote itself; slippage protection only covers movement after quoting, so user confirmation cannot mitigate it |
| Non-positive `amountOut`, or missing/unparseable impact | BLOCK (fail-closed; the OKX client already maps missing impact to NaN) | Absent evidence is never treated as favorable |
| Impact above a review threshold (`PRICE_IMPACT_CONFIRM_THRESHOLD`, new constant) but below the ceiling | REQUIRE_CONFIRMATION; wallet request produced; reason states the numbers in plain language | Real but survivable cost: the human decides, with the figures in front of them |
| Small impact | ALLOW with the quote summary always included (amountOut, minReceive, impact, venue, `expiresAt`) | ALLOW is not silent |

Confirmation binding: a confirmation is valid only for the specific `preparedTransactionHash` it was given for. A re-quote invalidates any prior confirmation. Steward or host agents must never auto-confirm.

Precision cuts both ways: fail-closed governs MISSING evidence, never clear evidence. Clear-good evidence (registry-verified venue, limited approval, known tokens, small impact) yields a clean ALLOW with disclosure and no added friction; BLOCK is reserved for what confirmation cannot cure; the review band is for genuinely ambiguous ground, and the durable fix for a noisy review band is acquiring evidence (registry verification, alias resolution), not lowering the bar. `PRICE_IMPACT_CONFIRM_THRESHOLD` is calibrated from measured live-quote impacts at realistic sizes, not chosen defensively. Every non-ALLOW response must be actionable (state the numbers and a passing alternative when one exists), because an over-blocking firewall trains its users to bypass it.

Freshness: signing past `expiresAt` requires a re-prepare, not a signature; minReceive bounds post-quote movement, expiry bounds everything else.

Oracle sanity check (closes a hole the security re-verdict cannot): a compromised or dishonest quote source can serve a security-clean but economically bad quote (expensive route, poor fill, all inside the allowlist), and offline calldata decoding cannot detect price quality. The deterministic guard: compare the quote's implied price (amountOut over amountIn) against the live Chainlink read the engine already performs; deviation beyond a threshold maps to REQUIRE_CONFIRMATION with the deviation stated, extreme deviation to BLOCK. A stale feed is reported and the check is marked unavailable (never silently skipped as a pass); per the pricing invariant, no price is ever hardcoded.

Slippage rules (asymmetric by design): tightening below the pair-type tier (`resolveAutoSlippage`: 0.1 stable pairs, 0.5 majors, 3 default) is always free; widening beyond the tier is a disclosed, user-confirmed decision and never silent, because slack is exactly what sandwich extraction consumes. On a failed or reverted swap the agent diagnoses before reacting: embedded price impact is never cured by wider slippage (smaller size, split, or another venue instead), and post-quote movement is cured FIRST by a fresh re-quote at tight slippage; widening is the last resort, stepwise, always under `MAX_SLIPPAGE_PCT`. Volatile pairs get shorter expiry and a re-quote near signing, not wider slippage. The deterministic backstops (`MAX_SLIPPAGE_PCT` ceiling, on-chain minReceive) hold regardless of anything the conversation layer decides.

## Invariants this design must never violate

1. No SafeHands surface signs or broadcasts on behalf of a hosted user; wallet requests are the terminal output.
2. A BLOCK never yields a wallet request, on any surface, under any venue.
3. Approvals prepared by this path are limited to the swap amount; unlimited approval is never prepared.
4. Trust evidence comes only from the registry; venue allowlists remain containment.
5. The hosted engine never fetches anything except its charter-listed sources (today: registry dataURI; after the amendment: plus the one pinned provider endpoint).

## Open items

- Wallet-request format compatibility with Anvita steward signing (the platform can sign; the exact request schema it expects is unverified: confirm during integration, adjust the `walletRequest` shape or add an adapter if needed).
- `expiresAt` semantics: quote lifetime vs verdict lifetime; contracts v2 intent tickets (see [CONTRACTS_V2_DESIGN.md](./CONTRACTS_V2_DESIGN.md)) are the eventual on-chain home for this binding.
- Ordering against the agreed Merkle-inclusion port, which remains first in the post-publish roadmap unless re-prioritized.
- Leftover-allowance guidance: if the approval is signed but the swap expires or fails, a bounded allowance (the swap amount, never unlimited) remains; the agent template should offer the revoke.
- Confirmation binding lives in the host conversation's memory (the platform LLM context); it is best-effort until intent tickets give it an on-chain home.
