# Architecture Decision Record: SafeHands Reference Backend (Optional Self-Host)

**Status:** Accepted · **Scope:** Pharos Pacific Mainnet (chainId 1672) · **Profile:** Single-Instance Self-Host Profile

> **Framing:** The SafeHands *hosted agent* is the **Anvita Flow skill**
> ([flow.anvita.xyz/home](https://flow.anvita.xyz/home)); once published, that is what any Steward
> Agent will discover and call, and it depends on **none of our own backend or cloud**.
> The full TypeScript backend in `src/` is an **optional, self-hostable reference**;
> not the production service. This ADR records how that reference backend is
> structured when you choose to self-host it.

---

## 1. Decision

When self-hosted, SafeHands runs as a **Single-Instance Architecture**: one
consolidated process that hosts the SafeHands API, the verified-broadcast pipeline,
the on-chain attestation lifecycle, and the background retry/audit loop **inside one
process**, backed by a persistent volume and optional Redis. It runs on **any
container host that supports a persistent volume**: Docker, a VPS, Fly, or
similar. This is a **cost-efficient, correctness-first topology** suitable for a
reviewer-ready read-only deployment on Pharos Pacific.

The distributed multi-service topology (dedicated API / x402 / worker processes on
shared Postgres/Redis) is defined below as the **horizontal scaling path**, activated
when throughput and high-availability requirements justify the shared-storage
investment.

---

## 2. Context

SafeHands is a mainnet-first pre-execution transaction firewall, verified-broadcast relay,
and privacy-preserving on-chain proof system for AI agents on Pharos Pacific. Its
runtime state (prepared transactions, the attestation lifecycle queue, x402
replay protection, and the audit trail) is held in an **atomic file-backed
persistent store** (`persistentJsonStore`), with x402 replay protection optionally
backed by Redis.

A service topology had to be chosen for the self-host reference. Two candidates were
evaluated: a **Single-Instance Architecture** (one process, one coherent state
domain) versus a **distributed multi-service topology** (API + x402 + worker as
separate processes over shared storage).

---

## 3. Rationale: why Single-Instance is the correct default

Single-instance is a **deliberate architectural decision to guarantee state
consistency and a verifiable, uninterrupted lifecycle**, not a reduction of scope.
With the current file-backed persistent state model, running one process is what
keeps the following **coherent and safe**:

| State domain | Why single-instance protects it |
|---|---|
| **Prepared transactions** | A prepared record and its `/broadcast/signed` redemption are served from one authoritative store: no cross-process divergence, no split prepared/used state. |
| **Attestation lifecycle** | Enqueue → publish → receipt-confirm → retry is owned end-to-end by one process, so every verified broadcast is attested exactly once with a consistent view of the queue. |
| **Retry / background loop** | The attestation retry loop runs **in-process**, reading the same authoritative queue the API writes, guaranteeing progress with zero inter-process coordination. |
| **x402 replay protection** | Enforced through Redis (durable, restart-safe), with a consistent single-writer view. |
| **Audit trail** | A single, append-consistent record of decisions and lifecycle events, not fragmented across processes. |

**Distributing these across separate processes today would fragment a file-backed
state domain** (a mounted volume is per-instance), which is precisely the integrity
property this architecture is designed to preserve. Single-instance is therefore the
**correct** default for the current persistence model, chosen for correctness first,
and cost-efficiency second.

---

## 4. Architecture

```
                         Pharos Pacific Mainnet (1672)
                    SafeHandsRegistry · SafeHandsAttestation
                                   ▲
                                   │ verify → relay → receipt → attest
   Users / Agents / Anvita Flow    │
        │  (HTTPS)                  │
        ▼                           │
 ┌───────────────────────────────────────────────────────────┐
 │  SafeHands Backend  (single self-hosted instance)           │
 │  ─────────────────────────────────────────────────────────│
 │  • SafeHands API  - preflight, risk, prepare, broadcast     │
 │  • Verified-broadcast pipeline (user-signed; zero-custody) │
 │  • On-chain attestation lifecycle (receipt-gated)          │
 │  • In-process background loop - retry / attestation / audit│
 └───────────────────────────────────────────────────────────┘
        │                         │
        ▼                         ▼
 Persistent volume → /data   Redis (optional)
 (SAFEHANDS_STATE_DIR)       (x402 replay, restart-safe)
 prepared_tx · attestations
 · audit · queue
```

- **One start command:** `node dist/api/server.js`: the SafeHands API **and** the
  background attestation/retry loop run in the same process (the loop starts on
  module load). The server binds `0.0.0.0:$PORT`. No separate worker process is
  required for correct operation.
- **Durable state:** a persistent volume mounted at `/data` with
  `SAFEHANDS_STATE_DIR=/data` makes prepared transactions, the attestation queue, and
  the audit trail durable across restarts and redeploys. On an ephemeral host (no
  persistent volume) this state does not survive a restart.
- **Restart-safe replay:** x402 replay protection uses Redis
  (`SAFEHANDS_X402_REPLAY_REDIS_REQUIRED=true` when enabled).
- **Deliberate cardinality:** run **one instance** (no horizontal replicas); a
  required invariant of this profile, preserving the single authoritative state
  domain.

---

## 5. Access model

| Tier | Surface | Access control |
|---|---|---|
| **Public / free** | `/health`, `/tools`, `/infra/status`, `/public-config`, attestation lookup (`/attestation/:txHash`), registry/reputation lookup (`/registry/latest`, `/reputation/:address`) | Open, read-only |
| **Guarded / paid** | Risk report, swap guard, simulation, DODO route, transaction prepare, verify + attestation request, publish risk, managed-wallet action | Monetized via the **x402 payment layer** (permissionless machine payments) |
| **Admin / internal** | Operator/diagnostic surfaces | Optional API key (`SAFEHANDS_API_KEYS`); never publicly required for the read tier |

Design principles: public users transact through **x402** (no API-key onboarding
friction); API keys are reserved for admin/internal use; the background loop is
in-process and exposes **no** public surface. x402 is the designated monetization
mechanism for guarded operations, applied through the `@x402/express` payment layer.
The read tier is enabled by default; x402 monetization of guarded operations is
configured per deployment through the x402 payment layer.

---

## 6. Single-Instance Self-Host Profile: deployment

**Required environment (single instance, verified-broadcast + attestation active):**
```
NODE_ENV=production
SAFEHANDS_NETWORK=pacific-mainnet
PHAROS_RPC_URL=https://rpc.pharos.xyz
# PORT → provided by your host (server binds 0.0.0.0:$PORT; defaults to 4022)

# Durable state (a container filesystem is ephemeral without a mounted volume)
SAFEHANDS_STATE_DIR=/data                       # + mount a persistent volume at /data

# Zero-custody hosted posture
WALLET_MODE=none
WRITE_TOOLS_ENABLED=false                        # managed execution off on a public host

# Verified-broadcast + on-chain attestation
SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED=true
SAFEHANDS_ATTESTATION_REQUIRED=true
SAFEHANDS_ATTESTATION_SYNC=true
SAFEHANDS_ATTESTER_PRIVATE_KEY=0x…               # segregated operational key (gas-only); Registry operator
SAFEHANDS_REGISTRY_ADDRESS=0x…
SAFEHANDS_ATTESTATION_ADDRESS=0x…

# x402 paid access: restart-safe replay via Redis
UPSTASH_REDIS_REST_URL=…                          # any Redis REST endpoint (e.g. Upstash)
UPSTASH_REDIS_REST_TOKEN=…
SAFEHANDS_X402_REPLAY_REDIS_REQUIRED=true
X402_PAY_TO=0x…                                  # receiver address (no key on host)
X402_FACILITATOR_PRIVATE_KEY=0x…                 # gas-only settlement key
X402_PAYMENT_TOKEN_ADDRESS=0x…

# Access / hardening (optional)
SAFEHANDS_API_KEYS=…                             # admin/internal only
SAFEHANDS_REQUIRE_API_KEY=false                  # public read tier stays open
CORS_ORIGIN=…
SAFEHANDS_RECIPIENT_DENYLIST=
```

**Deployment checklist:**
1. Deploy the on-chain layer (Node ≥22.13) → record `SAFEHANDS_REGISTRY_ADDRESS` + `SAFEHANDS_ATTESTATION_ADDRESS`.
2. Build the image from the repo `Dockerfile`; start `node dist/api/server.js` on a single instance.
3. **Attach a persistent volume mounted at `/data`; set `SAFEHANDS_STATE_DIR=/data`.**
4. Apply the environment above. Run **one instance** (no horizontal replicas; profile invariant).
5. Provision Redis (e.g. Upstash); set the REST URL + token.
6. Deploy → confirm `GET /health` = 200; run the curl smoke set from
   [`../SAFEHANDS_REVIEWER_DEMO_SCRIPT.md`](../SAFEHANDS_REVIEWER_DEMO_SCRIPT.md)
   against your instance (e.g. `http://localhost:4022`).
7. Verify `/public-config` (chainId 1672, execution disabled), `/reputation/:address`, `/attestation/:txHash`.

See [`../PRODUCTION_BACKEND.md`](../PRODUCTION_BACKEND.md) for the full self-host
backend guide.

---

## 7. Horizontal Scaling Path (distributed multi-service)

When throughput, high-availability, or independent-scaling requirements warrant it,
SafeHands scales to a **distributed multi-service topology**:

- **safehands-api** (public): SafeHands access for users / agents / Anvita Flow.
- **safehands-x402** (public): payment / resource gateway.
- **safehands-worker** (private): attestation, retry, batch, and audit lifecycle.

**Enabling investment (the one prerequisite):** replace the file-backed adapter with
**shared storage** (Postgres and/or Redis) behind the existing `persistentJsonStore`
seam, so prepared transactions, the attestation queue, quota, and the audit trail
become a shared, concurrency-safe state domain across processes. Once that adapter
lands, the services split cleanly and scale horizontally.

This is a **forward scaling path, engineered-in by design**: the single-instance
profile and the distributed profile share the same code seam. It is a capacity
upgrade, not a correction.

**Activation criteria:** sustained request volume beyond a single instance,
high-availability / zero-downtime requirements, dedicated x402 throughput, or growing
attestation volume warranting an isolated worker.

---

## 8. Operating parameters (deliberate)

| Parameter | Value | Rationale |
|---|---|---|
| Instances | 1 (single instance) | Preserves a single authoritative state domain (integrity-first). |
| Scaling axis | Vertical | Matches the file-backed state model; horizontal scaling is the defined upgrade path (§7). |
| State durability | Persistent volume + `SAFEHANDS_STATE_DIR` | Restart/redeploy-safe prepared-tx, attestation queue, audit trail. |
| Replay protection | Redis | Durable, restart-safe, already concurrency-ready for the scaling path. |
| Custody | None on host | Self-hosted service holds no user keys; only a segregated gas-only attester key. |

---

## 8.1 Security posture (enforced at boot)

A production posture guard (`src/lib/productionGuards.ts`, active when
`NODE_ENV=production`) protects this profile:
- **Fail-fast** if managed execution (`WALLET_MODE=managed-mainnet` +
  `WRITE_TOOLS_ENABLED=true`) is configured on a public host without the explicit
  `SAFEHANDS_ALLOW_MANAGED_ON_PUBLIC=true` override, enforcing the zero-custody
  public posture at startup.
- **Warn** on an ephemeral state dir, on missing Redis when x402 replay is
  required, and on wildcard CORS in production.

Wallet separation (owner offline / gas-only attester / gas-only facilitator) and the
full self-hosted backend security profile are specified in
[`../../SECURITY.md`](../../SECURITY.md) → "Self-Hosted Backend: Security Profile".

## 9. Consequences

- **Accepted:** a coherent, integrity-first single-instance profile deployable on
  one self-hosted instance, with a verifiable end-to-end attestation lifecycle and
  durable audit trail.
- **Engineered-in:** a clean horizontal scaling path to a distributed multi-service
  topology on shared Postgres/Redis, sharing the same persistence seam.
- **Invariant:** the single-instance profile requires a single instance and a mounted
  persistent volume; horizontal scale-out is gated on the shared-storage adapter (§7).
