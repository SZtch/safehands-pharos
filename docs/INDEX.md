# SafeHands Docs — Index & Reading Order

SafeHands is the **transaction firewall for AI agent finance on Pharos**: it renders a
deterministic safety verdict (`ALLOW` / `BLOCK` / `REQUIRE_CONFIRMATION` / `PREPARE_ONLY`) on risky
approvals, contract calls, payments, swaps, and prepared transactions *before* a wallet or
agent signs. Hosted mode is a no-custody, read-only verdict you consult ahead of execution;
self-hosted integrations can gate execution on the same verdict (write tools off by default).
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
| [DECISION_CONTRACT.md](./DECISION_CONTRACT.md) | The public 4-value decision vocabulary, its internal mappings, and the confirmation trust anchor. Load-bearing. |
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
| [reports/PHAROS_IMPLEMENTATION_MAP.md](./reports/PHAROS_IMPLEMENTATION_MAP.md) · [reports/PHAROS_IMPLEMENTED_VS_ROADMAP.md](./reports/PHAROS_IMPLEMENTED_VS_ROADMAP.md) | What's implemented vs roadmap — **Phase 5D snapshots**; see the supersession banner (CLI/SDK, live Chainlink reads, and SPV verification have since shipped). |
| [PHAROS_RPC_READ_ONLY.md](./PHAROS_RPC_READ_ONLY.md) · [PHAROS_RPC_METHOD_MATRIX.md](./PHAROS_RPC_METHOD_MATRIX.md) · [PHAROS_ZAN_RPC_OPTIONAL.md](./PHAROS_ZAN_RPC_OPTIONAL.md) | RPC read-only whitelist + optional providers. |

## Contracts, audits & deep dives

| Doc | What it covers |
|-----|----------------|
| [CANONICAL_CONTRACTS.md](./CANONICAL_CONTRACTS.md) | Ground truth for the official Pharos canonical contracts the preflight engine recognizes. |
| [reports/AUDIT_REMEDIATION_2026-07.md](./reports/AUDIT_REMEDIATION_2026-07.md) | Full July 2026 repository audit + remediation record — every finding, fix, and verification gate. |
| [deployment/ARCHITECTURE_DECISION.md](./deployment/ARCHITECTURE_DECISION.md) | ADR for the optional self-hosted reference backend (single-instance profile). |
| [deployment/FULL_SERVICE_DESIGN.md](./deployment/FULL_SERVICE_DESIGN.md) | Layout for running every endpoint/service self-hosted (API + x402 + worker). |
| [indexing/GOLDSKY_ATTESTATION_INDEXING.md](./indexing/GOLDSKY_ATTESTATION_INDEXING.md) | Goldsky indexing design — mainnet contracts stay the source of truth. |
| [POST_HACKATHON_NOTES.md](./POST_HACKATHON_NOTES.md) | Applied hardening notes, a known contract-layer design limitation, and the engine roadmap. |

---

**Decision contract (public):** `ALLOW` · `BLOCK` · `REQUIRE_CONFIRMATION` · `PREPARE_ONLY`.
SafeHands explains every decision and never signs or broadcasts in hosted mode.

