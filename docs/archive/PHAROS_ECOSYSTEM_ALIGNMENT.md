> [!WARNING]
> **Historical snapshot (Phase 2 planning) — superseded.** Kept unedited for provenance; outdated statements below include: "read-only Pharos checks on Atlantic testnet today" (Pacific Mainnet 1672 is live and the default), "SDK Roadmap" (the SDK shipped), and Chainlink listed as not integrated (live Chainlink Push price reads shipped in `get_token_price`). The do-not-overclaim guardrails remain broadly valid. For current status see `docs/INDEX.md`.

> [!NOTE]
> Pharos Pacific Mainnet (chain `1672`) is the default and live network. Any Atlantic Testnet (`688689`) references below are legacy/secondary context.

# SafeHands Phase 2 — Pharos Ecosystem Alignment

> How SafeHands positions within the Pharos ecosystem, how Agent-to-Agent
> works, and **what must not be overclaimed**. Source links in `REFERENCES.md`.
>
> Legend — **Live** · **Supported** · **Experimental** · **Roadmap**

---

## 1. SafeHands-as-a-layer thesis

SafeHands is a **universal pre-execution transaction firewall for Pharos**, not a
standalone wallet or execution app. Any user, dApp, wallet, Safe, payment agent, or
AI agent calls SafeHands **before** an on-chain action and receives one of:
`ALLOW` · `BLOCK` · `REQUIRE_CONFIRMATION` · `PREPARE_ONLY`.

SafeHands **checks and decides**; it never holds keys, never custodies funds,
and does not execute by default.

> **SafeHands Phase 2 is mainnet-first for Pharos Pacific read-only safety checks.
> Execution, signing, managed wallets, and on-chain publishing are advanced
> self-hosted modes and remain disabled by default.** Pacific Mainnet (1672, PROS) is
> the primary network for read-only checks; Atlantic Testnet is for demo,
> compatibility, contract testing, and x402 testing only.

---

## 2. Agent-to-Agent (A2A) model

SafeHands acts as a **SafeHands Agent**. Other agents consult it before acting.

```
   Caller Agent ──(action intent)──▶  SafeHands Agent
                                          │
                            ┌─────────────┴─────────────┐
                          decision                  explanation
                            │
   ALLOW ─────────▶ caller proceeds
   BLOCK ─────────▶ caller stops
   REQUIRE_CONFIRMATION ─▶ caller asks user/admin first
   PREPARE_ONLY ──▶ caller must NOT execute (prepare/handoff only)
```

**Caller obligations (the contract every agent must honor):**

| Decision | Caller must… |
|----------|--------------|
| `ALLOW` | Proceed with the action. |
| `BLOCK` | Stop. Do not execute. |
| `REQUIRE_CONFIRMATION` | Pause and ask the user/admin for explicit approval. |
| `PREPARE_ONLY` | Not execute; only prepare/return the action for external handling. |

**Example caller agents (demo scope — `examples/a2a/`, Experimental):**

| Agent | Checks before acting | Status |
|-------|----------------------|--------|
| Payment Agent | x402 payment request (URL/amount/token) | **Experimental** |
| DeFi Agent | USDC approval or swap intent | **Experimental** |
| Treasury Agent | Safe MultiSend transaction | **Experimental** |
| Bridge Agent | CCTP / USDC transfer intent | **Roadmap** |

---

## 3. Ecosystem categories & direction

| Category | SafeHands direction | Status |
|----------|--------------------|--------|
| **Wallet** | Pre-sign safety check surfaced to wallet UIs (no key access) | **Roadmap** (integration-ready API) |
| **DeFi** | Approval/swap-intent analysis (decode-only; not a DEX) | **Experimental** |
| **x402** | Payment-request preflight before signing | **Live** (preflight) |
| **AI agent** | SafeHands Agent / MCP / SDK pre-execution checks | **Live** (MCP) / **Supported** (SDK Roadmap) |
| **Cross-chain** | CCTP / bridge transfer-intent checks | **Roadmap** |

---

## 4. Named ecosystem projects — integration status

> **All of the following are integration-ready or Roadmap. NONE are integrated
> today.** SafeHands must not claim a direct/live integration with any of them.

| Project | Category | Status |
|---------|----------|--------|
| OKX | Wallet / exchange | Integration-ready / **Roadmap** — not integrated |
| OneKey | Wallet | Integration-ready / **Roadmap** — not integrated |
| KuCoin | Exchange | Integration-ready / **Roadmap** — not integrated |
| Fordefi | MPC custody | Integration-ready / **Roadmap** — not integrated |
| Anchorage | Custody | Integration-ready / **Roadmap** — not integrated |
| Hypernative | Security / monitoring | Integration-ready / **Roadmap** — not integrated |
| TRM Labs | Compliance / risk | Integration-ready / **Roadmap** — not integrated |
| LayerZero | Messaging / bridge | Integration-ready / **Roadmap** — not integrated |
| LI.FI | Bridge aggregation | Integration-ready / **Roadmap** — not integrated |
| Jumper | Bridge UI | Integration-ready / **Roadmap** — not integrated |
| Chainlink | Oracles | Integration-ready / **Roadmap** — not integrated |
| Goldsky | Indexing | Integration-ready / **Roadmap** — not integrated |
| Circle (CCTP/USDC) | Stablecoin / bridge | Integration-ready / **Roadmap** — not integrated |

"Integration-ready" means the SafeHands exposes a generic API/SDK these systems
*could* call — not that any partnership, code path, or live integration exists.

---

## 5. Integrations — now vs later

| Now (buildable on current core) | Later (Roadmap) |
|---------------------------------|------------------|
| Read-only JSON-RPC analysis on any Pharos RPC | Mainnet execution / co-signing |
| x402 payment-request preflight | x402 mainnet production payment |
| Safe/Permit2/MultiSend **decode** (recognition) | Deep Safe integration, EAS attestation export |
| PharosScan link building | CCTP/USDC bridge-intent verification |
| MCP tool surface for agents | Wallet-vendor and custody-vendor integrations |

---

## 6. Do-not-overclaim guardrails

The submission and docs must **not** claim any of the following unless and until
implemented and tested:

- ❌ Direct/live integration with OKX, OneKey, KuCoin, Fordefi, Anchorage,
  Hypernative, TRM, LayerZero, LI.FI, Jumper, Chainlink, Goldsky, Circle, or any
  other ecosystem project. *(Describe as integration-ready / Roadmap only.)*
- ❌ Full x402 **mainnet** payment support (no production asset/facilitator config
  is shipped).
- ❌ Full **SPV** / `eth_getProof` verification (not implemented).
- ❌ That SafeHands **controls or custodies user funds** (it never does).
- ❌ That SafeHands **executes transactions by default** (read-only by default).
- ❌ That **mainnet execution is live** — mainnet execution, managed wallets, and
  on-chain publishing are advanced self-hosted modes, gated behind default-`false`
  flags and not enabled.

> **Mainnet-first ≠ mainnet-execution.** SafeHands Phase 2 targets Pacific Mainnet
> for **read-only** SafeHands checks; that is the goal, not a claim that mainnet
> *execution* is available.

**Always-true claims SafeHands may make:** deterministic pre-execution decisions; a
deterministic policy engine; x402 preflight; SSRF and unlimited-approval protection;
per-agent policy; on-chain SafeHandsRegistry read; an MCP tool surface for AI agents;
and read-only Pharos checks (on Atlantic testnet today — **Pacific Mainnet read-only
is the Phase 2 mainnet-first target**, landing in P1). The no-wallet SafeHands
Explorer is **Experimental** (P4), not yet shipped.

*Cross-references:* `PHAROS_OFFICIAL_ALIGNMENT.md` · `REFERENCES.md`

