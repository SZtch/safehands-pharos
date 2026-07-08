# SafeHands Docs — Index & Reading Order

SafeHands is a Pharos-native **transaction safety layer**: it checks risky approvals,
contract calls, AI-agent actions, and prepared transactions before any on-chain action.
Default network is **Pharos Pacific Mainnet** (chain `1672`, `PROS`), with live contracts.
The hosted agent is being published to [Anvita Flow](https://flow.anvita.xyz/home) (Agent Carnival Phase 2); once live it will be discoverable and callable
by any Steward Agent; to hit the HTTP API directly, self-host the read-only backend locally
(`npm run build && node dist/api/server.js` → `http://localhost:4022`).

New here? Read the **Start here** docs, then dip into the rest as needed.

## Start here

| Doc | What it covers |
|-----|----------------|
| [REVIEWER_QUICKSTART.md](./REVIEWER_QUICKSTART.md) | Clone → build → test → demo in minutes. No keys/wallet needed. |
| [SAFEHANDS_REVIEWER_DEMO_SCRIPT.md](./SAFEHANDS_REVIEWER_DEMO_SCRIPT.md) | Guided reviewer walkthrough — live URLs, live contracts, expected outputs. |
| [REALFI_RWA_ALIGNMENT.md](./REALFI_RWA_ALIGNMENT.md) | How SafeHands serves Real-Fi & RWA on Pharos: what is live today vs roadmap. |
| [PRODUCTION_BACKEND.md](./PRODUCTION_BACKEND.md) | The read-only SafeHands HTTP API: endpoints, capability flags, request safety. |
| [PREPARE_TRANSACTION.md](./PREPARE_TRANSACTION.md) | P9 prepare-only mode — `POST /prepare/tx` returns an unsigned tx; the user signs externally. |
| [WALLET_HANDOFF.md](./WALLET_HANDOFF.md) | P10A — `POST /wallet/prepare` returns a wallet-ready request for an external wallet to sign + send. |

## API, deployment & operations

| Doc | What it covers |
|-----|----------------|
| [ACCESS_CONTROL.md](./ACCESS_CONTROL.md) | Scoped API keys, tiered quota, rate-limit headers. |
| [POLICY_PROFILES.md](./POLICY_PROFILES.md) | Policy presets (tighten-only), policy version metadata. |
| [OBSERVABILITY_AND_ACTIVITY.md](./OBSERVABILITY_AND_ACTIVITY.md) | Sanitized activity feed, public metrics, request IDs, structured logging. |
| [PRODUCTION_BACKEND.md](./PRODUCTION_BACKEND.md) | Optional self-host of the read-only reference backend (Docker / VPS / any container host). |
| [SAFEHANDS_REVIEWER_DEMO_SCRIPT.md](./SAFEHANDS_REVIEWER_DEMO_SCRIPT.md) | Copy-paste curl smoke tests against a self-hosted backend. |

## Agent & integration

| Doc | What it covers |
|-----|----------------|
| [SAFEHANDS_GUARDIAN_AGENT.md](./SAFEHANDS_GUARDIAN_AGENT.md) | The read-only SafeHands Agent surface. |
| [AGENT_TO_AGENT.md](./AGENT_TO_AGENT.md) | A2A check flow + obligations. |
| [AGENT_ARENA.md](./AGENT_ARENA.md) | Example agents in `examples/agent-arena/`. |
| [ANVITA_FLOW.md](./ANVITA_FLOW.md) | Assembling the SafeHands Agent in Anvita Flow. |

## Pharos alignment & evidence (source-of-truth)

| Doc | What it covers |
|-----|----------------|
| [REFERENCES.md](./REFERENCES.md) | External/official sources. Check before claiming ecosystem facts. |
| [PHAROS_OFFICIAL_ALIGNMENT.md](./PHAROS_OFFICIAL_ALIGNMENT.md) · [PHAROS_ECOSYSTEM_ALIGNMENT.md](./PHAROS_ECOSYSTEM_ALIGNMENT.md) | How SafeHands aligns with Pharos. |
| [PHAROS_ECOSYSTEM_EVIDENCE.md](./PHAROS_ECOSYSTEM_EVIDENCE.md) · [PHAROS_ECOSYSTEM_INTEGRATIONS.md](./PHAROS_ECOSYSTEM_INTEGRATIONS.md) | Integration evidence. |
| [reports/PHAROS_IMPLEMENTATION_MAP.md](./reports/PHAROS_IMPLEMENTATION_MAP.md) · [reports/PHAROS_IMPLEMENTED_VS_ROADMAP.md](./reports/PHAROS_IMPLEMENTED_VS_ROADMAP.md) | What's implemented vs roadmap. |
| [PHAROS_RPC_READ_ONLY.md](./PHAROS_RPC_READ_ONLY.md) · [PHAROS_RPC_METHOD_MATRIX.md](./PHAROS_RPC_METHOD_MATRIX.md) · [PHAROS_ZAN_RPC_OPTIONAL.md](./PHAROS_ZAN_RPC_OPTIONAL.md) | RPC read-only whitelist + optional providers. |

---

**Decision contract (public):** `ALLOW` · `BLOCK` · `REQUIRE_CONFIRMATION` · `PREPARE_ONLY`.
SafeHands explains every decision and never signs or broadcasts in hosted mode.

