# SafeHands — Access Control & Scoped API Keys (P8A)

SafeHands is **mainnet-first, read-only** for Pharos Pacific. P8A adds an optional
**scoped API-key** access-control layer + **sanitized caller identity** — while keeping the
public read API **open by default**. API keys are **identity / access-control only — never
payment**; future paid endpoints will use **x402** gating (`x402PaidEndpointsAvailable:false`
stays false). Everything here is in-memory, read-only; no signing/wallet/DB/external calls.

> **P8A scope:** access control + scoped keys + caller identity only. Quota (P8B) and policy
> profiles (P8C) are **not** in this slice.

---

## 1. Caller model
| Caller type | How it's determined |
|---|---|
| `anonymous` | no API key presented |
| `api-key` | a valid API key presented (on a non-agent endpoint) |
| `agent` | request to `POST /agent/check` |
| `a2a` | request to `POST /agent/a2a/check` |
| `premium / x402` | paid endpoints use x402 payment gating (not API keys) — env-gated via the `/paid/*` gate; off until `X402_PAY_TO` + `X402_FACILITATOR_URL` are configured |

## 2. Public read API — open by default
With `SAFEHANDS_REQUIRE_API_KEY=false` (default) **all** endpoints are open to anonymous
callers: `GET /health`, `/infra/status`, `/public-config`, `/activity/summary`,
`/activity/recent`, `/metrics/public`, and `POST /guardian/check`, `/agent/check`,
`/agent/a2a/check`, `/analyze/*`. Keys, when supplied, are recorded as identity — not gates.

## 3. Scoped API keys (backward-compatible)
Configure via `SAFEHANDS_API_KEYS` (comma-separated). Each entry may be:
```
rawKey                          # bare key → default read scopes
rawKey#guardian:check|analyze:read   # scoped key → only those scopes
```
- A **bare key (no `#`)** receives the **default read bundle** — so existing keys behave
  exactly as before P8A.
- Scopes: `guardian:check`, `agent:check`, `a2a:check`, `analyze:read`, `activity:read`,
  `metrics:read`, `prepare:tx`, `wallet:prepare` (the default bundle) + reserved `future:attest`,
  `future:premium` (**defined only — never granted by default; no live endpoint**).
  `prepare:tx` (P9) and `wallet:prepare` (P10A) are read-only — they build UNSIGNED / wallet-ready
  requests for external signing; neither signs or broadcasts.
- Unknown scope tokens are dropped (fail-closed). Split is on the **first `#`** only.
- Keys are **sha256-hashed at load**; only the 8-char `keyId` is ever stored/logged. **The raw
  key is never stored, logged, or returned.**

### Endpoint → required scope
| Endpoint | Scope |
|---|---|
| `POST /guardian/check` | `guardian:check` |
| `POST /prepare/tx` | `prepare:tx` |
| `POST /wallet/prepare` | `wallet:prepare` |
| `POST /agent/check` | `agent:check` |
| `POST /agent/a2a/check` | `a2a:check` |
| `POST /analyze/*` | `analyze:read` |
| `GET /activity/summary`, `/activity/recent` | `activity:read` |
| `GET /metrics/public`, `/infra/status`, `/public-config` | `metrics:read` |
| `GET /health` | — (always open) |

## 4. Require-key mode
Set `SAFEHANDS_REQUIRE_API_KEY=true` (only meaningful when keys are configured):
- `/health` stays open always (host healthcheck).
- `ALWAYS_OPEN` paths (`/infra/status`, `/public-config`, `/activity/*`, `/metrics/public`)
  stay open even in require mode.
- Gated endpoints (`/guardian/check`, `/analyze/*`, `/agent/*`) require a **valid key that
  carries the endpoint's scope**.
- An **invalid** key ⇒ `401 INVALID_API_KEY` (anywhere except `/health`).
- A valid key **missing the required scope** ⇒ `403 INSUFFICIENT_SCOPE`.
- A missing key on a gated endpoint ⇒ `401 API_KEY_REQUIRED`.

Scope is enforced **only** in require-key mode. When the public read API is open (default),
scopes are recorded as identity, never as gates.

## 5. Caller identity (sanitized)
Each request builds a sanitized access context: `callerType`, `keyId` (hash prefix only),
`scopes`, `agentId`, `a2aPeerId`, `requestId`. `agentId`/`a2aPeerId` are **untrusted,
display-only** — validated against `^[A-Za-z0-9._:-]{1,64}$` and **dropped if malformed**.
**Never captured:** raw API keys, `Authorization`/other headers, client IP, or raw payloads.

## 6. Activity & metrics
- Activity items carry the sanitized `accessTier` (anonymous|api-key|agent|a2a), `keyId`,
  `agentId`, `a2aPeerId` — alongside the existing endpoint-class `callerType` (which drives
  metrics totals).
- `GET /activity/summary` adds `totals.byAccessTier` (aggregate counts, **no identifiers**).
- `GET /metrics/public` adds `scopedApiKeysAvailable:true`. No keys/IPs/payloads/headers are
  ever exposed.

## 6b. Tiered quota (P8B)
In-memory, dependency-free (no Redis/DB). Per-tier limits (`SAFEHANDS_QUOTA_*`): `anonymous`
defaults to the rate-limit max (120/60s), `api-key`/`agent`/`a2a` default to 600/60s. Buckets are
keyed by a **trusted identifier only** — `keyId` for a valid key, else the client IP; untrusted
body `agentId`/`a2aPeerId` is **never** a quota key. Responses carry `X-RateLimit-Limit/Remaining/
Reset`; a 429 adds `Retry-After` (the existing `RATE_LIMITED` body shape). `/health` is exempt
(host liveness). `/metrics/public` exposes the safe quota config + `rateLimitedByTier`
(aggregate; **no keys/IPs**). Disable with `SAFEHANDS_RATE_LIMIT_ENABLED=false`.

## 7. Capability flags
`publicReadApiAvailable:true`, `apiKeyAuthAvailable:true`, **`scopedApiKeysAvailable:true`**,
**`quotaControlsAvailable:true`**, **`prepareTxAvailable:true`** (P9 prepare-only — unsigned, no signing/broadcast).
Env-gated (default `false` until explicitly configured): `premiumEndpointsAvailable`,
`x402PaidEndpointsAvailable` (true when `X402_PAY_TO` + a facilitator are set),
`signingAvailable`, `managedWalletAvailable`, `onchainPublishingAvailable`,
`userSignedBroadcastAvailable`.

## 8. Not payment
API keys are **identity/access-control only**. SafeHands does not bill on keys. **Paid
endpoints use x402 payment gating**, served by the zero-custody `/paid/*` gate
(`X402_PAY_TO` + external `X402_FACILITATOR_URL`); `x402PaidEndpointsAvailable` reports
`false` until that config is present.

