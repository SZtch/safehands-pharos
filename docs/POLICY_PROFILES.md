# SafeHands — Policy Profiles & Hardening (P8C)

Policy presets let an operator (or a caller, tighten-only) select a named SafeHands policy for
the **agent runtime**. They are layered on the **existing escalate-only `applyPolicy`**
(`src/agent/agentPolicyResolver.ts`), which can only *raise* severity — so **no preset or
request can ever weaken the analyzer's decision (a BLOCK stays a BLOCK by construction)**. Pure,
read-only; no signing/wallet/write/x402-paid behavior. Future paid endpoints use x402, not policy.

---

## 1. Presets
Each preset is a `GuardianPolicy` config (`src/lib/policy/policyPresets.ts`). Every preset is
**equal-or-stricter than `standard`** (enforced by `assertNotWeaker`, tested for all presets).

| Preset | Intent | Notes vs `standard` |
|---|---|---|
| `standard` | current public default (= `DEFAULT_BACKEND_POLICY`) | baseline |
| `strict` | much lower limits; confirm/block the risky cases | maxNative 1, maxApproval 1e9, maxX402 0.1, daily 10 |
| `agent` | A2A/agent runtime default | maxX402 0.5, daily 50; no trusted lists |
| `x402-preflight` | payment-intent focused | maxX402 0.1 |

`POLICY_VERSION` is surfaced (never secret) in agent responses + `/metrics/public`.

## 2. Where presets apply
Presets govern the **agent path** (`POST /agent/check`, `POST /agent/a2a/check`) where
`applyPolicy(GuardianPolicy)` runs. The deterministic read-only analyzers (`/guardian/check`,
`/analyze/*`) are **policy-independent** — a preset never changes an analyzer verdict; it can
only add agent-side escalation. Agent endpoints default to the **`agent`** preset.

## 3. Resolution (tighten-only)
`resolvePresetName(requestPreset, endpointDefault, env)`:
1. **server default** = `SAFEHANDS_POLICY_PRESET` (env) → endpoint default (`agent`) → `standard`.
2. A **request** `policyPreset` is honored only if it is a valid preset that is **equal-or-stricter**
   than the server default (`assertNotWeaker`). A request asking for a *weaker* preset is **clamped**
   to the server default — a caller can never loosen policy.

## 4. Request policy overrides (sanitized, tighten-only)
A request may also pass a partial `policy`. `sanitizeRequestPolicy(serverPolicy, overrides)`:
- numeric limits may only be **lowered** (`min`);
- safety booleans (`blockUnlimitedApproval`, `requireConfirmationForUnknownContract`) may only be
  set **toward safer** (`true`);
- request-supplied `trustedRecipients`/`trustedSpenders` are **ignored** (server-config only) — so
  a public caller can never add an approval/transfer bypass.

## 5. Surfaced fields
- **Agent responses** carry `policyPreset` (applied name, or `null`) + `policyVersion`.
- **Activity items** carry `policyPreset` for agent decisions (`null` for analyzer endpoints);
  `GET /activity/summary` adds `totals.byPolicyPreset`.
- **`GET /metrics/public`** adds `policyProfilesAvailable:true`, `policyVersion`, and the available
  `policyPresets` list. No secrets/identifiers.

## 6. Configuration
| Env | Default | Meaning |
|---|---|---|
| `SAFEHANDS_POLICY_PRESET` | *(unset → `agent` on agent endpoints)* | Server default preset (must be a valid preset name). |

## 7. Guarantees
- **No weakening:** escalate-only `applyPolicy` + `assertNotWeaker` (load-time + tested) +
  tighten-only `resolvePresetName` + `sanitizeRequestPolicy`.
- **Read-only:** presets never sign/execute/publish; `signingAvailable`/`managedWalletAvailable`/
  `onchainPublishingAvailable`/`premiumEndpointsAvailable`/`x402PaidEndpointsAvailable` stay `false`.

