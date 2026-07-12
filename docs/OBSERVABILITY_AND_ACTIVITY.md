# SafeHands: Observability & Public Activity API (Phase 7)

SafeHands runs as a **read-only**, mainnet-first safety layer for Pharos Pacific. Phase 7 adds
the production observability and **public activity surface** that lets a future SafeHands
site show a landing page, "how to use", a live activity feed, and public metrics;
**without** ever storing payloads, secrets, or enabling any write/sign/execution path.

Hosted mode stays read-only: `readOnly: true`, `executionAvailable: false`, all four safety
gates off, `mainnetLive: true`. No database, no external API, no new runtime dependency.

---

## 1. What "SafeHands activity" means

Every time an agent or app asks SafeHands to judge an action (a SafeHands check, an analyzer
call, or an agent/A2A check), SafeHands produces a verdict
(`ALLOW` / `BLOCK` / `REQUIRE_CONFIRMATION` / `PREPARE_ONLY`). **Activity** is a sanitized,
coarse record of *that verdict*, enough to power a public "what SafeHands has been deciding"
feed and aggregate metrics, and nothing more.

Activity is recorded **only** for decision/analysis endpoints:

```
POST /guardian/check
POST /analyze/tx   /analyze/contract   /analyze/approval   /analyze/safe   /analyze/x402
POST /agent/check
POST /agent/a2a/check
```

Infrastructure endpoints (`/health`, `/infra/status`, `/public-config`, `/activity/*`,
`/metrics/public`) are **not** recorded in the feed (they only ever flow through the
structured request log).

Storage is an **in-memory ring buffer** (default 500 items, env-configurable, clamped
10–5000) plus O(1) cumulative counters. There is **no database**. The buffer is
**per-process / per-instance**: on multi-replica deployments each instance keeps its own
window, so the public feed is illustrative rather than globally exhaustive.

---

## 2. What is stored (sanitized activity item)

Each item is built by a strict field **whitelist**: the raw request body and response are
never spread in. Shape:

```jsonc
{
  "id": "9f1c0b7e2a4d6f8a",            // random display id
  "ts": "2026-06-27T22:14:05.123Z",
  "requestId": "7f3e…",                 // correlates with the request log + X-Request-Id
  "endpoint": "/guardian/check",
  "callerType": "api",                  // api | agent | a2a | unknown
  "network": "pacific-mainnet",
  "chainId": 1672,
  "checkType": "evm",                   // analyzer/inputType (api); null for agent
  "intentType": "erc20_approval",       // agent intent if available; else null
  "decision": "BLOCK",                  // public 4-decision, or null
  "riskLevel": "CRITICAL",              // or null
  "reasonSummary": "Unlimited approval to an unknown spender (0x0000…0abc); blocked.",
  "evidenceTypes": ["ecosystemEvidence", "rpcEvidence", "gasEvidence"],
  "readOnly": true,
  "executionAvailable": false,
  "target": {
    "type": "contract",                 // contract | eoa | address | url | text | tx | none
    "addressShort": "0x1111…1111",      // shortened; never the full address
    "selector": "0x095ea7b3",           // 4-byte selector only; never full calldata
    "txHashShort": null                 // shortened; never the full hash
  }
}
```

Coarse-target policy: addresses are shortened (`0x1234…cdef`), calldata is reduced to its
4-byte selector, tx hashes are shortened, and `reasonSummary` runs through a hex-redactor
so any address/hash embedded in text is shortened too.

### What is NEVER stored

- full request payloads / response bodies
- full addresses, full calldata, full tx hashes, full URLs
- full x402 payment-request payloads
- private keys, signatures, raw signed transactions, wallet secrets
- API keys (only a `keyId` hash-prefix is ever referenced)
- secret/premium RPC URLs
- sensitive headers, cookies, or client IP

---

## 3. Public endpoints

All responses use the standard envelope `{ success, data, error, timestamp }` and carry the
`X-Request-Id` response header. All stay **open by default** and are read-only.

### `GET /activity/recent?limit=N`
Newest-first sanitized items. `limit` default 20, clamped 1–100.
```jsonc
{ "data": { "generatedAt": "…", "limit": 20, "count": 12, "items": [ /* ActivityItem */ ],
            "readOnly": true, "executionAvailable": false } }
```

### `GET /activity/summary`
Aggregate counts over the ring window + counters.
```jsonc
{ "data": {
  "generatedAt": "…",
  "window": { "capacity": 500, "size": 12 },
  "totals": {
    "recorded": 1234, "rateLimited": 3,
    "byCaller":   { "api": …, "agent": …, "a2a": …, "unknown": … },
    "byDecision": { "ALLOW": …, "BLOCK": …, "REQUIRE_CONFIRMATION": …, "PREPARE_ONLY": …, "NONE": … },
    "byRisk":     { "CRITICAL": …, "HIGH": …, "MEDIUM": …, "LOW": …, "UNKNOWN": … },
    "byEndpoint": { "/guardian/check": …, "/agent/check": … }
  },
  "lastActivityAt": "…", "readOnly": true, "executionAvailable": false } }
```

### `GET /metrics/public`
Safe aggregate metrics only: no env, no payloads, no secrets, no memory dumps.
```jsonc
{ "data": {
  "service": "SafeHands API", "version": "2.4.0", "generatedAt": "…",
  "network": "pacific-mainnet", "chainId": 1672, "uptimeSeconds": 1234,
  "totalChecks": …, "totalAgentChecks": …, "totalA2AChecks": …,
  "totalBlocked": …, "totalRequireConfirmation": …, "totalPrepareOnly": …, "totalAllowed": …,
  "totalRateLimited": …, "ring": { "capacity": 500, "size": 12 },
  "mainnetLive": true, "railwayReady": true,
  "publicReadApiAvailable": true, "apiKeyAuthAvailable": true,
  "premiumEndpointsAvailable": false, "x402PaidEndpointsAvailable": false,
  "readOnly": true, "executionAvailable": false } }
```

---

## 4. Request ID

- Every response carries an `X-Request-Id` header.
- A caller may supply `X-Request-Id` (safe charset `^[A-Za-z0-9._:-]{1,128}$`); otherwise the
  server generates a UUID. The id is echoed in the response header, included in the response
  `data.requestId`, and stamped on the activity item + request log for correlation.

## 5. Host-agnostic structured logging

One JSON line per request to **stdout** (any host captures stdout). Whitelisted fields only:

```json
{"ts":"…","level":"info","event":"request","requestId":"7f3e…","method":"POST","path":"/guardian/check","status":200,"durationMs":12,"callerType":"api","decision":"BLOCK","rateLimited":false,"apiKeyId":null}
```

Never logged: bodies, headers, query strings, client IP, API keys, private keys, full RPC
URLs, raw signed transactions. Toggle with `SAFEHANDS_REQUEST_LOG_ENABLED=false`.

---

## 5b. Caller identity in activity (P8A)

Activity items also carry sanitized caller identity: `accessTier` (anonymous|api-key|agent|a2a),
`keyId` (hash prefix only), `agentId`, `a2aPeerId` (untrusted, charset+length-validated, dropped
if malformed), alongside the existing endpoint-class `callerType`. `GET /activity/summary` adds
`totals.byAccessTier` (aggregate counts only); `GET /metrics/public` adds `scopedApiKeysAvailable`.
**Never stored/exposed:** raw API keys, `Authorization`/other headers, client IP, raw payloads.

P8B (quota) adds to `/metrics/public`: `quotaControlsAvailable:true`, the safe `quota` config
(`windowSeconds` + per-tier limits, **no identifiers**), and `rateLimitedByTier` (aggregate 429
counts). Responses carry `X-RateLimit-*` headers. See [`ACCESS_CONTROL.md`](./ACCESS_CONTROL.md).

## 6. Optional API key foundation (identity / access-control)

The API key layer is an **optional** identity / rate-limit / access-control foundation. It is
**not** a payment mechanism. The public read API is **open by default**.

| Env | Default | Effect |
|---|---|---|
| `SAFEHANDS_API_KEYS` | *(blank)* | Comma-separated keys. Blank ⇒ fully open. Keys are sha256-hashed at load; raw keys are never stored or logged. |
| `SAFEHANDS_REQUIRE_API_KEY` | `false` | When `true` **and** keys are configured, non-public endpoints require a valid key. |
| `SAFEHANDS_PUBLIC_READ_ENABLED` | `true` | Public read API stays open. |

Behavior:
- Present a key via `X-Api-Key: <key>` or `Authorization: Bearer <key>`.
- No key ⇒ `anonymous` (allowed unless required). Match ⇒ `valid` (referenced only by
  `keyId`, an 8-char hash prefix). No match ⇒ **401 `INVALID_API_KEY`** (anywhere except
  `/health`).
- When `SAFEHANDS_REQUIRE_API_KEY=true`, these stay open regardless: `/health`,
  `/infra/status`, `/public-config`, `/activity/summary`, `/activity/recent`,
  `/metrics/public`.
- Rate limiting (the unchanged Phase 6 limiter) buckets authenticated clients by `keyId`
  (their own quota) and anonymous clients by IP (as before).

## 7. Future direction: x402-paid endpoints (NOT in Phase 7)

Paid/premium endpoints are intentionally **not** implemented in Phase 7:
`premiumEndpointsAvailable: false`, `x402PaidEndpointsAvailable: false`. When introduced,
**paid access will be gated by x402** (HTTP 402 payment-required), distinct from the API-key
identity layer above. The API key foundation here is for identity/quota/access-control, not
billing.

---

## 8. Configuration summary

| Env | Default | Meaning |
|---|---|---|
| `SAFEHANDS_ACTIVITY_ENABLED` | `true` | Record decision activity into the ring buffer. |
| `SAFEHANDS_ACTIVITY_CAPACITY` | `500` | Ring size (clamped 10–5000). |
| `SAFEHANDS_REQUEST_LOG_ENABLED` | `true` | Structured JSON request log to stdout. |
| `SAFEHANDS_API_KEYS` | *(blank)* | Optional comma-separated API keys (hashed). |
| `SAFEHANDS_REQUIRE_API_KEY` | `false` | Gate non-public endpoints when keys configured. |
| `SAFEHANDS_PUBLIC_READ_ENABLED` | `true` | Keep the public read API open. |

## 9. Try it

```bash
# read-only, no keys needed
curl -s localhost:4022/metrics/public        | jq .data
curl -s localhost:4022/activity/summary      | jq .data.totals
curl -s "localhost:4022/activity/recent?limit=5" | jq '.data.items[].decision'
curl -si localhost:4022/health | grep -i x-request-id
```

Hosted mode remains read-only: SafeHands holds no keys, signs nothing, sends nothing, and
publishes nothing. Observability and the activity API are pure read-only additions.

