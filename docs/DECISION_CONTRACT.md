# SafeHands Decision Contract

SafeHands has **one public decision contract** and two internal representations that map onto it. This document reconciles all three so reviewers aren't surprised by extra values seen in raw responses.

## 1. Public contract (what integrators consume) — 4 values

Returned by the MCP tools, CLI, and HTTP `/tools/safehands_preflight_check` (`GuardianDecision`, `src/lib/guardian/decision.ts`):

| Decision | Meaning |
|---|---|
| `ALLOW` | Passed all checks within policy limits. |
| `BLOCK` | A hard safety violation — do not proceed. |
| `REQUIRE_CONFIRMATION` | Proceed only after explicit human confirmation. |
| `PREPARE_ONLY` | Safe to prepare, but this deployment can't execute (read-only / hosted / unfunded) — hand off to an external signer. |

This is the contract to code against.

## 2. Internal policy engine — 6 values (mapped up to the 4)

`src/lib/policy/actionPolicyEngine.ts` (`PolicyDecision`) keeps richer sub-status for explanations. It is mapped to the public contract by `mapEngineDecision()`:

| Engine (`PolicyDecision`) | → Public |
|---|---|
| `ALLOW` | `ALLOW` (or `PREPARE_ONLY` when execution is unavailable) |
| `BLOCK` | `BLOCK` |
| `REQUIRE_CONFIRMATION` | `REQUIRE_CONFIRMATION` |
| `REQUIRE_TOKEN_REVIEW` | `REQUIRE_CONFIRMATION` |
| `REQUIRE_FUNDING` | `PREPARE_ONLY` |
| `WARN` *(reserved; not currently emitted)* | `REQUIRE_CONFIRMATION` |
| *(any unknown value)* | `REQUIRE_CONFIRMATION` — **fail-safe, never a silent ALLOW** |

`PREPARE_ONLY` is therefore **synthesized in the mapping layer**, not emitted by the engine directly.

## 3. Anvita hosted engine — 3-value recommendation

The zero-dependency hosted engine (`anvita/safehands/scripts/safehands-engine.js`) is score-based and reports a coarser `recommendation` for a hosted, read-only assistant:

| Hosted `recommendation` | Score band | Corresponds to |
|---|---|---|
| `allow` | ≤ 30 | `ALLOW` |
| `warn` | 31–69 | `REQUIRE_CONFIRMATION` |
| `block` | ≥ 70 | `BLOCK` |

It has no `PREPARE_ONLY` because it never executes anything. When its threat-intel dependency (GoPlus) is unreachable, an unverified subject is floored to at least `warn` (never `allow`) — see the fail-closed floor in the engine.

## Thresholds (documented divergence)

The two score-based engines use **different, intentional** block boundaries:

| Engine | allow/proceed | warn/caution | block | critical level |
|---|---|---|---|---|
| Hosted Anvita engine (`safehands-engine.js`) | ≤ 30 | 31–69 | **≥ 70** | > 85 |
| TS weighted risk engine (`src/lib/riskEngine.ts`, `RISK_BLOCK_THRESHOLD`) | ≤ 30 | 31–80 | **> 80** | > 80 |

The hosted engine blocks earlier **by design**: it runs unattended in front of third-party Steward agents with no human in the loop and no confirmable middle tier, so its "warn" band is narrower and its block band wider. The TS engine's score feeds surfaces that DO have a confirmable `REQUIRE_CONFIRMATION` tier and a separate hard-fail policy engine, so scores of 71–80 map to `caution` there rather than an outright block. The two scores also measure different things (hosted: additive on-chain/threat-intel heuristics; TS: weighted liquidity/slippage/counterparty/balance/market) — **never compare the raw numbers across engines**. Both engines share the same fail-safe direction: a missing signal can only push a score up, never down.

## Evidence status codes (system-wide convention)

These codes describe **evidence quality**, never verdicts. They may appear in checks, evidence cells, and error codes, but the decision vocabulary stays exactly as defined above — an evidence gap degrades the decision (floor `warn`/`REQUIRE_CONFIRMATION`, or `BLOCK` when the missing fact is load-bearing for a value-moving action); it is never itself returned as a fifth decision value. (This promotes the convention already used by the hosted skill's `output-template.md` to every surface.)

| Code | Meaning | Decision floor |
|---|---|---|
| `UNKNOWN` | Subject not found in any registry; no disqualifying evidence either. | `warn` / `REQUIRE_CONFIRMATION` |
| `NOT_CONFIGURED` | The provider/endpoint needed for this fact exists in the design but has no configured endpoint/key (e.g. Goldsky without `GOLDSKY_SUBGRAPH_URL`). Never silently passes; never guesses a value. | `warn` / `REQUIRE_CONFIRMATION` |
| `NOT_SUPPORTED` | Chain/asset/action outside SafeHands scope (e.g. a non-Pharos chain, Atlantic on the hosted skill). | `BLOCK` for execution-shaped intents; informational otherwise |
| `INSUFFICIENT_EVIDENCE` | Providers are configured but evidence could not be obtained or validated (outage, unindexed token, stale feed, schema drift). | `warn`; `BLOCK` when load-bearing (e.g. `token_security_intel_missing` is never caller-confirmable on the write path) |

## Evidence hierarchy (who wins on conflict)

SafeHands ranks truth sources in five tiers: **(1) on-chain reads** (code, balance, allowance, receipts, logs, SafeHands Registry/Attestation) win for *state* facts; **(2) official sources** (Pharos docs, official address lists — see `docs/REFERENCES.md`) win for *identity/legitimacy* facts; **(3) verified providers** (Chainlink feeds, GoPlus, RPC) supply *risk intel and market* facts; **(4) the curated registry** (`src/data/ecosystemRegistry.data.ts`) is a cache of tier-2 conclusions and must cite them; **(5) user/caller input is a claim to verify, never evidence**. Two asymmetric rules bind them:

- **Negative evidence is monotonic** — a negative signal from any tier (e.g. a GoPlus honeypot flag on a registry-canonical token) escalates the decision; no registry entry vetoes it.
- **Positive evidence relaxes risk only from an address-matched registry entry with `safetyUse: "allow_eligible"`** (enforced by `validateEcosystemRegistry`). Name/alias matches, clean provider results, and caller-asserted flags (`recipientVerified`, `spenderVerified`) never relax a decision on their own; an omitted caller flag is treated as unverified, not as safe.

## Invariant

Every layer is **fail-safe**: absence of a signal or an unrecognized value degrades toward confirmation/blocking, never toward a silent `ALLOW`.

## Confirmation trust anchor (write paths)

The soft tiers (`REQUIRE_CONFIRMATION` / `REQUIRE_TOKEN_REVIEW`) are confirmable, but *who* attests differs by surface — deliberately:

- **MCP write tools** accept an explicit caller `confirm=true`. The trust anchor is the **MCP host / human operator** relaying the call — SafeHands treats the confirmation as caller-attested, not verified. Hard stops are never confirmable: `BLOCK`, `REQUIRE_FUNDING`, and missing token-security intel (`token_security_intel_missing` → `TOKEN_INTEL_UNAVAILABLE`): intel that never existed cannot be "reviewed away".
- **The HTTP broadcast relay** (`src/api/broadcastRoutes.ts`) refuses `REQUIRE_CONFIRMATION` records outright: an anonymous HTTP client has no trusted confirmation channel, so a boolean in a request body proves nothing.
