# SafeHands Production Backend

> **SafeHands is a mainnet-first transaction firewall for Pharos Pacific; this backend is
> its read-only read/check/analyze surface.** This document describes the production backend (the read-only
> SafeHands API), its endpoints, and its hardening. Hosted default is read-only: **no
> private keys, no custody, no signing or transaction sending.** Write / prepare-tx /
> broadcast are future **gated** capabilities.

---

## 1. Process & boundary

- Entrypoint: `node dist/api/server.js` (`npm start`). Compiled; no `tsx` at runtime.
- Read-only **by construction**: the API imports no signer, wallet, facilitator, or
  write tooling. The only chain access is a read-only viem public client routed through
  the read-only RPC method gate (`PharosReadOnlyRpc`).
- Binds `0.0.0.0:$PORT` (your host injects `PORT`; default `4022`).
- Every SafeHands/Agent response carries `readOnly: true` and `executionAvailable: false`.

## 2. Capability flags (honest)

From `getCapabilityFlags()` (`src/lib/config.ts`), surfaced on `/infra/status` +
`/public-config`:

- **`true`:** `mainnetLive`, `pharosPacificMainnet`, `liveReadChecksAvailable`,
  `guardianApiAvailable`, `agentApiAvailable`, `a2aAvailable`, `pharosEvidenceAvailable`,
  `rpcEvidenceAvailable`, `gasEvidenceAvailable`, `tokenRegistryEvidenceAvailable`,
  `canonicalContractEvidenceAvailable`, `ecosystemEvidenceAvailable`,
  `x402PreflightAvailable`, `railwayReady`, and the read-only observability flags
  `publicReadApiAvailable`, `apiKeyAuthAvailable`, `activityApiAvailable`,
  `metricsApiAvailable`, `structuredLoggingAvailable`, `requestIdAvailable`, and the
  prepare-only flag `prepareTxAvailable` (unsigned prepare; no signing/broadcast).
- **`false`:** `userSignedBroadcastAvailable`, `signingAvailable`,
  `managedWalletAvailable`, `autoExecutionAvailable`, `onchainPublishingAvailable`,
  `custodyAvailable`, and the paid-surface flags `premiumEndpointsAvailable`,
  `x402PaidEndpointsAvailable` (paid endpoints are a future, x402-gated capability, not part of the read-only surface).

## 3. Request safety

CORS (env allowlist; wildcard default) · JSON body limit (`SAFEHANDS_JSON_LIMIT`,
default `64kb`) · **tiered in-memory quota** (dependency-free, no Redis/DB; `X-RateLimit-*`
+ `Retry-After` headers; bucketed by trusted keyId/IP only; `/health` exempt) · consistent
error shape with **no stack traces** (generic 500 message when `NODE_ENV=production`) ·
consistent **404** · security headers (`nosniff`, `no-referrer`, no `x-powered-by`).
Config helpers live in `src/api/httpHardening.ts` (pure, offline-testable).

**Access control:** optional **scoped API keys** (`SAFEHANDS_API_KEYS`, format
`rawKey` or `rawKey#scopeA|scopeB`; bare keys get the default read bundle); identity /
access-control only, **never payment**. Public read API stays **open by default**; scopes are
enforced only in require-key mode (`SAFEHANDS_REQUIRE_API_KEY=true`): invalid key ⇒ 401, valid
key missing the endpoint scope ⇒ 403. Raw keys are never stored/logged (keyId only). See
[`ACCESS_CONTROL.md`](./ACCESS_CONTROL.md).

**Policy profiles:** named SafeHands presets (`standard`/`strict`/`agent`/`x402-preflight`,
`SAFEHANDS_POLICY_PRESET`) govern the **agent path**, layered on the existing escalate-only
`applyPolicy`: **no preset/request can weaken a decision**. Request presets are tighten-only;
responses carry `policyPreset`/`policyVersion`. See [`POLICY_PROFILES.md`](./POLICY_PROFILES.md).

**Prepare-only mode:** `POST /prepare/tx` returns an **UNSIGNED** transaction after a
SafeHands check (`requiresUserSignature: true`, `decision: PREPARE_ONLY`; a BLOCK prepares
nothing). SafeHands signs/broadcasts nothing; `signingAvailable`/`broadcastAvailable` stay
false; the caller signs externally. See [`PREPARE_AND_HANDOFF.md`](./PREPARE_AND_HANDOFF.md).

**Wallet-ready handoff:** `POST /wallet/prepare` reads wallet context
(`userAddress`/`from`) from the request and returns a `walletRequest`
(`{from,to,data,value,chainId}`) for an **external** wallet to sign and send. Missing wallet
context → `requiresWalletConnection: true`; a BLOCK produces no `walletRequest`. SafeHands
signs/broadcasts nothing and creates no wallet. See [`PREPARE_AND_HANDOFF.md`](./PREPARE_AND_HANDOFF.md).

## 4. Endpoint matrix

Read-only = the endpoint never writes/signs/sends. "Live RPC?" = may perform a read-only
on-chain read when configured (falls back to offline-deterministic evidence otherwise).
**No endpoint requires secrets.**

| Endpoint | Purpose | Read-only | Live RPC? | Secrets? |
|----------|---------|:--------:|:---------:|:--------:|
| `GET /health` | Liveness; lightweight | ✅ | ❌ | ❌ |
| `GET /infra/status` | Capabilities, gates, network, evidence | ✅ | ❌ | ❌ |
| `GET /public-config` | Safe public config + decisions | ✅ | ❌ | ❌ |
| `POST /guardian/check` | Universal pre-execution check | ✅ | optional | ❌ |
| `POST /analyze/tx` | Analyze a tx hash | ✅ | optional | ❌ |
| `POST /analyze/contract` | Contract intelligence | ✅ | optional | ❌ |
| `POST /analyze/approval` | ERC-20 approval decode | ✅ | ❌ | ❌ |
| `POST /analyze/safe` | Safe/MultiSend decode (experimental) | ✅ | ❌ | ❌ |
| `POST /analyze/x402` | x402 preflight (no payment) | ✅ | ❌ | ❌ |
| `POST /agent/check` | SafeHands Agent verdict | ✅ | optional | ❌ |
| `POST /agent/a2a/check` | Agent-to-agent verdict + caller obligation | ✅ | optional | ❌ |
| `POST /prepare/tx` | Prepare-only UNSIGNED tx after SafeHands check | ✅ | optional | ❌ |
| `POST /wallet/prepare` | Wallet-ready request for an external wallet | ✅ | optional | ❌ |
| `GET /activity/recent` | Public sanitized activity feed | ✅ | ❌ | ❌ |
| `GET /activity/summary` | Aggregate activity counts | ✅ | ❌ | ❌ |
| `GET /metrics/public` | Safe aggregate metrics | ✅ | ❌ | ❌ |

Decision/analysis endpoints (`/guardian/check`, `/analyze/*`, `/agent/*`) are recorded as
**sanitized** activity items (coarse target only, no payloads/secrets). Every response also
carries an `X-Request-Id` header. See
[`OBSERVABILITY_AND_ACTIVITY.md`](./OBSERVABILITY_AND_ACTIVITY.md).

### Example request / response

`POST /guardian/check`
```json
{ "to": "0x1111111111111111111111111111111111111111", "data": "0xdeadbeef" }
```
Safe response shape (abridged):
```json
{
  "success": true,
  "data": {
    "decision": "REQUIRE_CONFIRMATION",
    "riskLevel": "UNKNOWN",
    "reasons": ["..."],
    "analyzers": [ { "tool": "evm_call", "details": { "canonicalContractEvidence": null } } ],
    "ecosystemEvidence": { "category": "unknown", "recommendedDecisionImpact": "none" },
    "rpcEvidence": { "readOnly": true, "provider": { "secretsRedacted": true } },
    "gasEvidence": { "gasBufferPct": 20 },
    "network": "pacific-mainnet",
    "chainId": 1672,
    "readOnly": true,
    "executionAvailable": false
  }
}
```

### Self-host curl (read-only; no keys, no tx)

After `npm run build && node dist/api/server.js`, hit the local read-only backend:

```bash
SAFEHANDS_API_URL=http://localhost:4022
curl -s "$SAFEHANDS_API_URL/health"
curl -s "$SAFEHANDS_API_URL/public-config"
curl -s -X POST "$SAFEHANDS_API_URL/guardian/check" \
  -H 'content-type: application/json' \
  -d '{"to":"0x1111111111111111111111111111111111111111","data":"0xdeadbeef"}'
```

Full copy-paste set: [`SAFEHANDS_REVIEWER_DEMO_SCRIPT.md`](./SAFEHANDS_REVIEWER_DEMO_SCRIPT.md).

## 5. Deployment (optional self-host)

The hosted SafeHands Agent is being published to **Anvita Flow** (<https://flow.anvita.xyz/home>) (Agent Carnival Phase 2); this
`src/` backend is an **optional, self-hostable reference**, not the production service. To run
it yourself: `npm start` runs the compiled read-only API on `0.0.0.0:$PORT`, no keys required,
so it drops onto any container host (Docker / VPS / Fly) or an ephemeral host with no persistent
volume. The single stateless `PORT` binding is what the `railwayReady` capability flag reports.

