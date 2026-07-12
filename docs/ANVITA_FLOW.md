# Integrating SafeHands with Anvita Flow (Phase 2: Agent Arena)

This document covers the **SafeHands Agent** for Pharos Agent Carnival Phase 2 (Agent Arena).

SafeHands began as a suite of native Pharos Skills (Phase 1). For Phase 2, these are orchestrated into a complete **Intelligent SafeHands Agent** (33 tools across MCP, HTTP, and CLI) ready to be deployed on **Anvita Flow**.

This guide demonstrates how to construct the SafeHands Agent visually in Anvita Flow and configure it for **Pharos Pacific Mainnet (Chain 1672)**.

> **Hosted agent**: the SafeHands Agent is being published to **Anvita Flow** ([flow.anvita.xyz/home](https://flow.anvita.xyz/home)) (Agent Carnival Phase 2); once live it will be discoverable and callable by any Steward Agent; no install required. To exercise the raw HTTP endpoints referenced below (`/tools/*`, `/wallet/prepare`, `/broadcast/signed`, `/paid/*`), self-host the read-only reference backend locally (`npm run build && node dist/api/server.js`, default port 4022) and hit `http://localhost:4022`.

## 1. Importing the SafeHands Skill Server

To bring SafeHands into Anvita Flow, you will register our MCP server as a Skill Module.

1. Open your Anvita Flow Canvas.
2. In the left panel, click **Add Module** -> **Import MCP Server**.
3. Use the following initialization command:
   ```bash
   npx safehands-pharos
   ```
4. Anvita Flow will automatically discover all 33 tools (e.g., `safehands_preflight_check`, `check_token_security`, `safehands_risk_report`, `get_agent_reputation`, `verify_risk_inclusion`). Most are read-only safety/intelligence skills; the six write tools (`execute_swap`, `send_payment`, `approve_token`, `x402_pay_and_fetch`, `safehands_safe_execute`, `publish_risk_score`) stay disabled unless you explicitly opt into self-hosted managed execution (see §3, Step 3).

## 2. Configuring the Agent Node (Environment Variables)

SafeHands is entirely Mainnet-first and zero-custody. To ensure the agent operates securely on Mainnet, set the following environment variables in your Anvita Flow Agent settings:

| Variable | Value | Description |
|----------|-------|-------------|
| `SAFEHANDS_NETWORK` | `pacific-mainnet` | Locks the agent strictly to Chain 1672. |
| `WALLET_MODE` | `none` (default) | Ensures the agent runs in read-only preflight mode (safest). |
| `WRITE_TOOLS_ENABLED` | `false` | Prevents the agent from executing unauthorized mainnet transactions. |

*(Optional for advanced enrichment)*:
| Variable | Description |
|----------|-------------|
| `ZAN_PHAROS_MAINNET_RPC_URL` (or the `PHAROS_ZAN_RPC_URL` alias) | Full ZAN RPC endpoint URL (key embedded in the URL) to route read-only RPC through ZAN instead of the public endpoint. Optional; see `docs/PHAROS_RPC.md` section 6. |

## 3. Assembling the SafeHands Agent Workflow

To create the "SafeHands" behavior, wire the modules in the Anvita Flow canvas as follows:

### Step 1: User/Agent Intent (Trigger)
Create a Trigger Node (e.g., a Telegram Bot input or a Wallet Interaction). This represents the raw transaction intent.

### Step 2: The SafeHands Check (`safehands_preflight_check`)
Connect the Trigger Node directly to the `safehands_preflight_check` skill.
- **Input**: The raw intent (Target Address, Token, Amount, URL).
- **Behavior**: SafeHands will automatically route this through its enrichment pipeline (fetching real-time DODO Mainnet prices and verifying contract intelligence).

### Step 3: Branching on Decision (Router)
The `safehands_preflight_check` returns a strict JSON decision: `ALLOW`, `BLOCK`, `REQUIRE_CONFIRMATION`, or `PREPARE_ONLY`.
- Create a **Condition Node** in Anvita Flow.
- **If `BLOCK`**: Route to a Message Node returning "Transaction blocked due to critical risk."
- **If `REQUIRE_CONFIRMATION`**: Route to a Human-in-the-Loop (HITL) approval node.
- **If `ALLOW` / `PREPARE_ONLY`** (default, zero-custody): Route to the **user-signed prepare flow**: call the SafeHands API `POST /wallet/prepare` to get an unsigned `walletRequest` + `preparedTransactionId`, have the user sign it in their own wallet, then `POST /broadcast/signed`. SafeHands holds no keys and signs nothing in this path.
- **Optional (self-hosted, opt-in managed execution):** if, and only if, you run your own MCP server with `WRITE_TOOLS_ENABLED=true` and a managed wallet authorized in `SafeHandsRegistry`, you may instead route to `execute_swap` / `send_payment`. This mode signs and broadcasts from a managed wallet (it is **not** zero-custody) and is disabled by default.

## 4. What the on-chain grounding adds

**Real-Fi & RWA fit.** Pharos is a Real-Fi chain, and this agent is the pre-execution safety checkpoint those flows need: it verifies asset legitimacy before an agent touches a tokenized asset (token registry + GoPlus security checks), enforces transfer restrictions deterministically (per-agent caps, human-in-the-loop `REQUIRE_CONFIRMATION`), caps stablecoin settlements on the x402 rail, and, on the opt-in relayed-broadcast path (off by default), writes a privacy-preserving audit record on-chain for every verified broadcast it relays. See [REALFI_RWA_ALIGNMENT.md](./REALFI_RWA_ALIGNMENT.md) for the full live-vs-roadmap mapping.

Rather than relying on model output for safety-relevant facts, the SafeHands Agent grounds its checks in **deterministic on-chain data**:
- It pulls live liquidity from **FaroSwap**.
- It prevents SSRF attacks in **x402 Agent Payments**.
- It halts **unlimited token approvals** dynamically based on the exact token address.
- After a verified user-signed broadcast, it publishes a permanent **Attestation** to the on-chain `SafeHandsAttestation` contract on Pharos Pacific Mainnet (1672), gated by `SAFEHANDS_ATTESTATION_REQUIRED` and a segregated attester key, building a decentralized reputation layer for AI agents on top of `SafeHandsRegistry`.

The result is the Phase 1 Skills assembled into a single agent behind a deterministic transaction firewall: every action is decided by the policy engine before anything is signed.
