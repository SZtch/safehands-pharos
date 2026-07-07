# SafeHands full-enabled self-host design (reference backend)

> **The hosted SafeHands service agent is the Anvita Flow skill** (https://flow.anvita.xyz/home) — discoverable and callable by any Steward Agent, with no backend of your own to run. The TypeScript backend in `src/` is an **optional, self-hostable reference**: nothing here is "the production service." Reach for this doc only if you want to run every endpoint, skill, and tool yourself on your own host.

This is the recommended layout when the goal is **all endpoints active, all skills active, all tools active** on a self-hosted backend (the horizontal scaling path — see [`ARCHITECTURE_DECISION.md`](./ARCHITECTURE_DECISION.md)). It is host-agnostic: any container host that can run a Node process and mount a persistent volume works (Docker, a VPS, Fly, etc.).

## Best architecture

Run the same repository as separate services with different start commands:

| Service | Public? | Start command | Purpose |
|---|---:|---|---|
| `safehands-api` | Yes | `npm run start:api` | SafeHands API, prepare/broadcast, attestation lookup, metrics, and hosted `/tools` gateway for all 33 tools |
| `safehands-x402` | Yes | `npm run start:x402` | x402 resource server and paid HTTP endpoints |
| `safehands-worker` | No | `npm run start:worker` | Durable attestation retry queue and background jobs |
| `safehands-anvita-mcp` | Host-dependent | `npm run start:mcp` | MCP/Anvita Skill runtime exposing the same 33 tools over stdio |

Optional later:

| Service | Public? | Start command | Purpose |
|---|---:|---|---|
| `safehands-dashboard` | Yes | project-specific | UI for risk, pool, tx lifecycle, and attestations |

## Why not only one service?

A single Node process can run the API, but the best production-oriented design separates responsibilities:

- API stays responsive.
- x402 has its own port and resource-server middleware.
- Worker retries do not block HTTP requests.
- MCP/Anvita tools remain compatible with hosts that expect stdio rather than public HTTP.

## Hosted tool gateway

The API service exposes all 33 tools over HTTP:

- `GET /tools` lists all hosted tools.
- `POST /tools/:toolName` invokes a tool with JSON body.

The same safety gates still apply. For example, `execute_swap`, `send_payment`, `approve_token`, `publish_risk_score`, and `safehands_safe_execute` still require `WRITE_TOOLS_ENABLED=true` and signer/wallet configuration.

## Host layout

Build one image from this repo (the included `Dockerfile`) and run it as several long-lived processes with different start commands. Any container host works — Docker Compose, a VPS with systemd, Fly, or similar. Each process binds `0.0.0.0:$PORT` and exposes `GET /health` for liveness where noted.

### 1. `safehands-api`

- Start command: `npm run start:api`
- Liveness: `GET /health`
- Main env: `PORT=3000`
- Publicly reachable: yes

### 2. `safehands-x402`

- Start command: `npm run start:x402`
- Liveness: `GET /health`
- Main env: `X402_SERVER_PORT=4021`
- Publicly reachable: yes

### 3. `safehands-worker`

- Start command: `npm run start:worker`
- Liveness: none (background process)
- Publicly reachable: no
- Needs the durable state directory (see below) — this process owns the attestation retry queue.

### 4. `safehands-anvita-mcp`

- Start command: `npm run start:mcp`

Only run this as a standalone process if your host supports long-lived MCP/stdio processes. Otherwise, use the generated Anvita package and let Anvita/Skill Engine start the MCP tool runtime.

## Durable state

The API and worker persist prepared transactions, the attestation retry queue, and the audit trail under `SAFEHANDS_STATE_DIR` (default `.safehands`). On an **ephemeral host (no persistent volume)** that data is lost on restart. Mount a persistent volume and point `SAFEHANDS_STATE_DIR` at it (e.g. `/data`) so the API and worker share the same durable directory. For higher throughput you can additionally front the retry queue with Redis via the optional Upstash env below.

## Required full-mode env

Use `.env.example` as the source of truth. For all features active, set at least:

```env
SAFEHANDS_NETWORK=pacific-mainnet
PHAROS_RPC_URL=https://rpc.pharos.xyz
# Public URL where your self-hosted API is reachable (local self-host default below;
# on a container host, use the host's public URL)
SAFEHANDS_PUBLIC_BASE_URL=http://localhost:3000
# Durable state dir — point at a mounted persistent volume so state survives restarts
SAFEHANDS_STATE_DIR=/data

WRITE_TOOLS_ENABLED=true
SAFE_EXECUTE_ENABLED=true
WALLET_MODE=managed-mainnet
SAFEHANDS_ENABLE_MANAGED_WALLET=true
MANAGED_WALLET_ENABLED=true
SAFEHANDS_WALLET_ENCRYPTION_KEY=replace-with-secret
WALLET_ENCRYPTION_KEY=replace-with-secret

SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED=true
SAFEHANDS_REGISTRY_ADDRESS=0x...
SAFEHANDS_RISK_REGISTRY_ADDRESS=0x...
SAFEHANDS_ATTESTATION_ADDRESS=0x...
SAFEHANDS_ATTESTER_PRIVATE_KEY=0x...
SAFEHANDS_ATTESTATION_REQUIRED=true
SAFEHANDS_ATTESTATION_SYNC=true
SAFEHANDS_ATTESTATION_RETRY_ENABLED=true

DODO_API_KEY=
DODO_ROUTER_ALLOWLIST=0x...
DODO_SPENDER_ALLOWLIST=0x...

X402_PAY_TO=0x...
X402_FACILITATOR_PRIVATE_KEY=0x...
X402_PAYMENT_TOKEN_ADDRESS=0x...
# Optional: Redis-backed retry queue
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Smoke tests

Once the processes are up, verify against your host. For local self-host these are `http://localhost:3000` (API) and `http://localhost:4021` (x402); on a container host substitute its public URLs. The full curl smoke set lives in [`../SAFEHANDS_REVIEWER_DEMO_SCRIPT.md`](../SAFEHANDS_REVIEWER_DEMO_SCRIPT.md).

```bash
curl http://localhost:3000/health
curl http://localhost:3000/infra/status
curl http://localhost:3000/tools
curl -X POST http://localhost:3000/tools/get_gas_price -H 'content-type: application/json' -d '{}'
curl http://localhost:4021/health
curl http://localhost:4021/supported
```

Then test the full flow:

1. `/tools/get_pool_info`
2. `/tools/safehands_preflight_check`
3. `/wallet/prepare`
4. `/broadcast/signed`
5. `/attestation/:txHash`
6. x402 paid endpoint from the x402 service

