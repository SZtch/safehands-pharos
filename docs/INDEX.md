# SafeHands Docs: Index & Reading Order

SafeHands is the **transaction firewall for AI agent finance on Pharos**: it renders a
deterministic safety verdict (`ALLOW` / `BLOCK` / `REQUIRE_CONFIRMATION` / `PREPARE_ONLY`) on risky
approvals, contract calls, payments, swaps, and prepared transactions *before* a wallet or
agent signs. Hosted mode is a no-custody, read-only verdict you consult ahead of execution;
self-hosted integrations can gate execution on the same verdict (write tools off by default).
Default network is **Pharos Pacific Mainnet** (chain `1672`, `PROS`), with live contracts.
The hosted agent is live on [Anvita Flow](https://flow.anvita.xyz/home) as `safehands` (Agent Carnival Phase 2); discoverable and callable
by any Steward Agent; to hit the HTTP API directly, self-host the read-only backend locally
(`npm run build && node dist/api/server.js` → `http://localhost:4022`).

New here? Read the **Start here** docs, then dip into the rest as needed.

## Start here

| Doc | What it covers |
|-----|----------------|
| [REVIEWER_QUICKSTART.md](./REVIEWER_QUICKSTART.md) | Clone → build → test → demo in minutes. No keys/wallet needed. |
| [SAFEHANDS_REVIEWER_DEMO_SCRIPT.md](./SAFEHANDS_REVIEWER_DEMO_SCRIPT.md) | Guided reviewer walkthrough: live URLs, live contracts, expected outputs. |
| [DECISION_CONTRACT.md](./DECISION_CONTRACT.md) | The public 4-value decision vocabulary, its internal mappings, and the confirmation trust anchor. Load-bearing. |
| [REALFI_RWA_ALIGNMENT.md](./REALFI_RWA_ALIGNMENT.md) | How SafeHands serves Real-Fi & RWA on Pharos: what is live today vs roadmap. |

## Agent & integration

| Doc | What it covers |
|-----|----------------|
| [TOOLS.md](./TOOLS.md) | The 33 MCP/HTTP/CLI tools, grouped by surface (safety preflight, risk, market/chain, gated execution, policy, managed wallet). |
| [SAFEHANDS_GUARDIAN_AGENT.md](./SAFEHANDS_GUARDIAN_AGENT.md) | The read-only SafeHands Agent surface. |
| [AGENT_TO_AGENT.md](./AGENT_TO_AGENT.md) | A2A check flow + obligations. |
| [examples/agent-arena/](../examples/agent-arena/) | Example agents that consult SafeHands before acting (payment, DeFi, treasury, user scenarios). |
| [ANVITA_FLOW.md](./ANVITA_FLOW.md) | Assembling the SafeHands Agent in Anvita Flow. |

## Pharos alignment & evidence (source-of-truth)

| Doc | What it covers |
|-----|----------------|
| [REFERENCES.md](./REFERENCES.md) | External/official sources. Check before claiming ecosystem facts. |
| [PHAROS_ECOSYSTEM_EVIDENCE.md](./PHAROS_ECOSYSTEM_EVIDENCE.md) | Ecosystem awareness registry + escalate-only evidence classifier (awareness, never integration claims). |
| [PHAROS_RPC.md](./PHAROS_RPC.md) | RPC read-only whitelist, full method matrix, SPV/proof status, optional premium providers. |

## Contracts, audits & deep dives

| Doc | What it covers |
|-----|----------------|
| [CANONICAL_CONTRACTS.md](./CANONICAL_CONTRACTS.md) | Ground truth for the official Pharos canonical contracts the preflight engine recognizes. |
| [CONTRACTS_V2_DESIGN.md](./CONTRACTS_V2_DESIGN.md) | Design note for a second contract iteration: known limits of the v1 registry, committed-root history, content-addressed DA, revocation, intent tickets. Designed, not scheduled. |
| [SWAP_HANDOFF_DESIGN.md](./SWAP_HANDOFF_DESIGN.md) | Design note for intent-to-signature swap handoff: prepare-swap endpoint, hosted delegation to a pinned provider endpoint, conversational rules. Designed, not scheduled. |
| [reports/AUDIT_REMEDIATION_2026-07.md](./reports/AUDIT_REMEDIATION_2026-07.md) | Full July 2026 repository audit + remediation record: every finding, fix, and verification gate. |

## Self-hosting & advanced backend

Real features you run yourself against the read-only reference backend. Every write or
execution capability here is **off by default** behind env gates; hosted mode never signs or
broadcasts. Not needed for the reviewer path above.

| Doc | What it covers |
|-----|----------------|
| [PRODUCTION_BACKEND.md](./PRODUCTION_BACKEND.md) | The read-only SafeHands HTTP API and how to self-host it: endpoints, capability flags, request safety (Docker / VPS / any container host). |
| [PREPARE_AND_HANDOFF.md](./PREPARE_AND_HANDOFF.md) | Prepare-only mode (`POST /prepare/tx`, unsigned tx) and wallet-ready handoff (`POST /wallet/prepare`); the user signs externally. |
| [ACCESS_CONTROL.md](./ACCESS_CONTROL.md) | Scoped API keys, tiered quota, rate-limit headers. |
| [POLICY_PROFILES.md](./POLICY_PROFILES.md) | Policy presets (tighten-only), policy version metadata. |
| [OBSERVABILITY_AND_ACTIVITY.md](./OBSERVABILITY_AND_ACTIVITY.md) | Sanitized activity feed, public metrics, request IDs, structured logging. |
| [deployment/ARCHITECTURE_DECISION.md](./deployment/ARCHITECTURE_DECISION.md) | ADR for the optional self-hosted reference backend (single-instance profile). |
| [deployment/FULL_SERVICE_DESIGN.md](./deployment/FULL_SERVICE_DESIGN.md) | Layout for running every endpoint/service self-hosted (API + x402 + worker). |
| [indexing/GOLDSKY_ATTESTATION_INDEXING.md](./indexing/GOLDSKY_ATTESTATION_INDEXING.md) | Goldsky indexing design; mainnet contracts stay the source of truth. |

## Archive (historical snapshots, superseded, kept for provenance)

Planning-era documents whose status labels no longer reflect the product. Each carries
a supersession banner; **do not cite them for current capabilities.**

| Doc | Era |
|-----|-----|
| [archive/PHAROS_OFFICIAL_ALIGNMENT.md](./archive/PHAROS_OFFICIAL_ALIGNMENT.md) · [archive/PHAROS_ECOSYSTEM_ALIGNMENT.md](./archive/PHAROS_ECOSYSTEM_ALIGNMENT.md) | Early planning |
| [archive/PHAROS_IMPLEMENTATION_MAP.md](./archive/PHAROS_IMPLEMENTATION_MAP.md) · [archive/PHAROS_IMPLEMENTED_VS_ROADMAP.md](./archive/PHAROS_IMPLEMENTED_VS_ROADMAP.md) | Later planning snapshots (CLI/SDK, live Chainlink reads, and SPV verification have since shipped) |
| [archive/POST_HACKATHON_NOTES.md](./archive/POST_HACKATHON_NOTES.md) | Post-hackathon hardening notes |

---

**Decision contract (public):** `ALLOW` · `BLOCK` · `REQUIRE_CONFIRMATION` · `PREPARE_ONLY`.
SafeHands explains every decision and never signs or broadcasts in hosted mode.

