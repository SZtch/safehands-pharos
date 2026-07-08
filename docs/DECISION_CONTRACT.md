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

## Invariant

Every layer is **fail-safe**: absence of a signal or an unrecognized value degrades toward confirmation/blocking, never toward a silent `ALLOW`.

## Confirmation trust anchor (write paths)

The soft tiers (`REQUIRE_CONFIRMATION` / `REQUIRE_TOKEN_REVIEW`) are confirmable, but *who* attests differs by surface — deliberately:

- **MCP write tools** accept an explicit caller `confirm=true`. The trust anchor is the **MCP host / human operator** relaying the call — SafeHands treats the confirmation as caller-attested, not verified. Hard stops are never confirmable: `BLOCK`, `REQUIRE_FUNDING`, and missing token-security intel (`token_security_intel_missing` → `TOKEN_INTEL_UNAVAILABLE`): intel that never existed cannot be "reviewed away".
- **The HTTP broadcast relay** (`src/api/broadcastRoutes.ts`) refuses `REQUIRE_CONFIRMATION` records outright: an anonymous HTTP client has no trusted confirmation channel, so a boolean in a request body proves nothing.
