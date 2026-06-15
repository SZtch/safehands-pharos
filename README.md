# SafeHands-Pharos

<p align="center">
  <strong>Transaction Safety Firewall for AI Agents on Pharos Atlantic Testnet</strong><br/>
  <em>Before an agent acts — SafeHands decides if it should.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/MCP_Skill-000000?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Pharos_Atlantic-688689-blueviolet?style=for-the-badge" />
  <img src="https://img.shields.io/badge/27_Tools-orange?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Live_on_Railway-brightgreen?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Testnet_Only-SAFE-blue?style=for-the-badge" />
</p>

---

## Try It Now — No Setup Required

```bash
npx safehands-pharos --demo
```

Runs 10 live safety checks in your terminal: ALLOW/BLOCK decisions, wallet health, token registry, x402 preflight, risk scoring. No config, no wallet, no transactions.

**Live server:** `https://safehands-pharos-production.up.railway.app`

```bash
# Try a live ALLOW/WARN/BLOCK response right now:
curl "https://safehands-pharos-production.up.railway.app/preflight?actionType=send_payment&amount=0.001&chainId=688689&recipient=0x1234567890123456789012345678901234567890"
```

---

## The Problem

AI agents are increasingly trusted to execute Web3 actions — token approvals, swaps, payments, x402 resource access. But most agent toolkits answer only one question:

> *"Can this transaction be sent?"*

They don't answer the question that actually matters:

> **"Should this action be allowed at all?"**

The result: agents that approve unlimited token allowances, swap on the wrong chain, pay suspicious x402 URLs, or drain wallets — not from malice, but from missing guardrails.

---

## How SafeHands Works

```
Agent wants to act
        │
        ▼
┌───────────────────────┐
│  safehands_preflight  │  ← runs before every action
│  _check               │
└───────────┬───────────┘
            │
     ┌──────┴──────┐
     │  Policy Engine│  checks: chain ID, mainnet guard,
     │               │  approval limits, SSRF, spend caps,
     │               │  token registry, x402 URL safety,
     │               │  signer availability, field validation
     └──────┬────────┘
            │
    ┌───────┼────────────────┐
    │       │                │
  ALLOW   REQUIRE_         BLOCK / WARN
    │     CONFIRMATION       │
  Agent     │             Agent stops
  acts    Agent asks      (plain-English reason returned)
          user first
```

SafeHands is both an **MCP server** (Model Context Protocol, for AI assistants like Claude) and a **Pharos Skill Engine skill** — a composable guardrail layer that any agent can add in front of any action, without modifying existing skill logic.

---

## Guardrails at a Glance

| Risk | Without SafeHands | With SafeHands |
|------|------------------|----------------|
| Unlimited token approval | Agent approves malicious spender forever | **BLOCK** — unlimited approval disabled by default |
| Wrong chain | Agent signs on mainnet by mistake | **BLOCK** — mainnet guard active |
| Suspicious x402 URL | Agent pays a localhost / private IP resource | **BLOCK** — SSRF guard (localhost, private IPs, metadata IPs, IPv6 local) |
| Overspending | Agent drains wallet in one session | **BLOCK** — daily cap enforced |
| Unknown token | Agent swaps unverified contract | **WARN** — requires review |
| Custom contract call | Agent calls arbitrary contract | **REQUIRE_CONFIRMATION** — must explicitly confirm |
| Missing signer | Agent attempts write without wallet | Structured error, no crash |
| Invalid amount/address | Agent passes `-1` or zero address | **VALIDATION_ERROR** — strict input checking |

---

## Two Ways to Use SafeHands

| | Local (MCP / CLI) | x402 API (live server) |
|---|---|---|
| **How** | `npx safehands-pharos` or Claude Desktop | HTTP calls to `safehands-pharos-production.up.railway.app` |
| **Cost** | Free | 0.001 USDC per paid request |
| **DODO API key** | Needed for price/swap tools | **Not needed** — server has the key |
| **USDC balance** | Not needed | Needed for paid endpoints |
| **Private key** | Needed for write tools only | Not needed for data queries |
| **Best for** | Full agent integration, write operations | Quick data queries, no setup |

**Don't have USDC or DODO key?** Use `npx safehands-pharos --demo` — runs 10 safety checks with zero config, zero cost.

**Just want price/pool/route data without setting up a DODO key?** Use the x402 API — pay 0.001 USDC per query, server handles DODO routing for you.

**Building a full agent with swaps?** Use local mode with your own `DODO_API_KEY` and `PRIVATE_KEY`.

---

## Getting Started

### Quick Install

```bash
npx skills add SZtch/safehands-pharos
```
Then connect to Claude Desktop, Anvita Flow, or use from CLI.

### Option A — Connect to your AI agent (Claude Desktop)

Add to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "safehands": {
      "command": "npx",
      "args": ["safehands-pharos"],
      "env": {
        "WALLET_MODE": "managed-testnet",
        "WRITE_TOOLS_ENABLED": "true"
      }
    }
  }
}
```

On first connection, SafeHands **auto-creates an encrypted agent wallet** — no manual setup needed. Ask Claude: *"Check my SafeHands wallet health"* to see your wallet address, then fund it from the [Pharos faucet](https://testnet.pharosnetwork.xyz/).

> **Read-only mode:** Omit the `env` block to run without a wallet. All safety, analysis, and market tools still work.

### Option B — Pharos Skill Engine / Anvita Flow

Register SafeHands as a skill with auto-wallet:

```json
{
  "command": "npx",
  "args": ["safehands-pharos"],
  "env": { "WALLET_MODE": "managed-testnet", "WRITE_TOOLS_ENABLED": "true" }
}
```

### Option C — Terminal / CLI

```bash
# Preflight check before approving a token
npx safehands-pharos skill safehands_preflight_check \
  '{"actionType":"approve_token","chainId":688689,"approvalToken":"USDC","spender":"0x000000000000000000000000000000000000dEaD","approvalAmount":"max"}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "decision": "BLOCK",
    "riskLevel": "HIGH",
    "safeToExecute": false,
    "reasons": ["Unlimited approval requested."],
    "requiredActions": ["Use a limited approval amount."]
  }
}
```

---

## Agent Integration Quick Start

Your agent wants to swap 100 PHRS → USDC. Here's the full safety flow, step by step:

```
Step 1 — Preflight (is this action allowed?)
─────────────────────────────────────────────
Agent calls: safehands_preflight_check
  { "actionType": "execute_swap", "chainId": 688689, "amount": "100" }

Response:  { "decision": "ALLOW", "safeToExecute": true }
  → If BLOCK or REQUIRE_CONFIRMATION → stop or ask user. Don't execute.

Step 2 — Risk score (how risky is it?)
──────────────────────────────────────
Agent calls: assess_risk
  { "action": "swap", "amount": "100", "walletAddress": "0xYOUR...", "toAddress": "0xPOOL..." }

Response:  { "score": 12, "riskLevel": "LOW" }
  → Score > 80 = auto-blocked. Score < 50 = safe to proceed.

Step 3 — Simulate (will it succeed?)
─────────────────────────────────────
Agent calls: simulate_transaction
  { "action": "swap", "amount": "100", "walletAddress": "0xYOUR...", "toAddress": "0xPOOL..." }

Response:  { "wouldSucceed": true, "estimatedOutput": "166.5 USDC" }
  → If wouldSucceed=false → stop. Show revert reason to user.

Step 4 — Execute (do it)
────────────────────────
Agent calls: execute_swap
  { "tokenIn": "PHRS", "tokenOut": "USDC", "amountIn": "100" }

Response:  { "txHash": "0xabc...", "status": "confirmed" }

Step 5 — Verify (confirm on-chain)
───────────────────────────────────
Agent calls: get_transaction_status
  { "txHash": "0xabc..." }

Response:  { "status": "success", "blockNumber": 24168300 }
```

**Key rule:** Always check `decision` before executing. If it's not `ALLOW`, don't call write tools.

| Decision | What your agent should do |
|----------|--------------------------|
| `ALLOW` | Safe to execute |
| `WARN` | Execute, but inform the user |
| `BLOCK` | Do **not** execute — show `reasons` to user |
| `REQUIRE_CONFIRMATION` | Ask user for explicit yes/no before executing |
| `REQUIRE_FUNDING` | Tell user to fund wallet first |
| `REQUIRE_TOKEN_REVIEW` | Tell user to verify the token manually |

> **Read-only tools need zero setup.** Steps 1–3 work immediately with `npx safehands-pharos` — no wallet, no `.env`, no config. Only Step 4 (write) requires the setup below.

---

## Enable Write Operations (Optional)

By default SafeHands is **read-only** — preflight checks, risk scoring, token registry, wallet health. No private key required.

To unlock swaps, payments, and approvals:

```bash
npx safehands-pharos init
```

Or create a `.env` in your working directory:

```env
WALLET_MODE=env             # env | managed-testnet
PRIVATE_KEY=0x...           # testnet key only — never mainnet
WRITE_TOOLS_ENABLED=true
MAX_TX_AMOUNT_PHRS=0.1      # per-transaction cap
MAX_DAILY_SPEND_USD=10      # daily spend cap
```

> **Note:** Both `WRITE_TOOLS_ENABLED=true` **and** a valid signer (`WALLET_MODE=env` with `PRIVATE_KEY`, or `WALLET_MODE=managed-testnet` with a created wallet) are required. Setting only one will not enable writes.
>
> For managed wallets that persist across restarts, also set `WALLET_STORE_PATH=./.agents/wallets.json` and `WALLET_ENCRYPTION_KEY=<your-secret>`.

---

## All 27 Tools

Every tool returns the same response envelope:

```json
{ "success": true, "data": { ... }, "error": null, "timestamp": "..." }
```

On failure: `success: false`, `data: null`, `error: { code, message, retryable }`.

### Guardrail Tools

| Tool | What it does |
|------|-------------|
| `safehands_preflight_check` | Policy preflight — returns one of the decisions below |
| `safehands_safe_execute` | Preflight + execute in one call (blocks if not ALLOW) |
| `safehands_wallet_health` | Wallet, signer, gas, x402 readiness |
| `safehands_x402_preflight` | URL safety + payment check before x402 |
| `safehands_risk_report` | Human-readable risk summary |
| `explain_risk` | Translate decisions into plain English |
| `token_registry_status` | Canonical / custom / unknown token check |

**Policy decisions returned by `safehands_preflight_check`:**

| Decision | Meaning |
|----------|---------|
| `ALLOW` | Safe to execute |
| `WARN` | Proceed with caution — non-critical issue detected |
| `BLOCK` | Action is unsafe — do not execute |
| `REQUIRE_CONFIRMATION` | Action needs explicit user confirmation (e.g. custom contract calls) |
| `REQUIRE_FUNDING` | Wallet has insufficient balance for gas or value |
| `REQUIRE_TOKEN_REVIEW` | Token is unknown or unverified — manual review needed |

### Safety & Analysis

| Tool | What it does |
|------|-------------|
| `assess_risk` | 5-dimension risk score (0–100): liquidity, slippage, counterparty, balance, market conditions |
| `check_token_security` | Token security profile via GoPlus API (note: GoPlus does not support Pharos chain 688689 — returns a clear error on testnet tokens) |
| `simulate_transaction` | Dry-run before broadcasting |
| `estimate_gas` | Gas estimate + sufficiency check |
| `check_allowance` | ERC-20 allowance check |

### Market & Chain Data

| Tool | What it does |
|------|-------------|
| `get_wallet_balance` | PHRS / USDC / USDT balances |
| `get_token_price` | Token price via DODO (needs `DODO_API_KEY` locally, or use `/token-price` x402 endpoint) |
| `get_gas_price` | Current network gas price |
| `get_pool_info` | Pool info via DODO (needs `DODO_API_KEY` locally, or use `/pool-info` x402 endpoint) |
| `get_transaction_status` | TX status by hash |
| `get_execution_history` | Wallet transfer history |

### Write Tools *(require `WRITE_TOOLS_ENABLED=true`)*

| Tool | What it does |
|------|-------------|
| `execute_swap` | Swap tokens via FaroSwap / DODO |
| `send_payment` | Send native PHRS |
| `approve_token` | ERC-20 approval (unlimited blocked by default) |
| `publish_risk_score` | Publish risk score on-chain to RiskRegistry |
| `x402_pay_and_fetch` | Fetch x402 resource, pay only after HTTP 402 |

### Risk Registry

| Tool | What it does |
|------|-------------|
| `query_risk_registry` | Read on-chain risk score |

### Managed Wallet Tools

| Tool | What it does |
|------|-------------|
| `create_agent_wallet` | Create testnet wallet (AES-256-GCM encrypted) |
| `get_agent_wallet` | Wallet address + metadata (no private key exposed) |
| `get_agent_wallet_balance` | Managed wallet balances |

> CLI-callable: `npx safehands-pharos skill <tool> '<json>'`

---

## x402 Support

SafeHands acts as both an **x402 client** and **x402 server**.

**Client** (`x402_pay_and_fetch`) — fetches a resource normally first. If the server returns HTTP 402, SafeHands runs a preflight check, signs the payment, and retries — all in one tool call.

**Server** (`npm run x402-server`) — exposes paid endpoints. Live at:

```
https://safehands-pharos-production.up.railway.app
```

| Endpoint | Access | Price | DODO key needed? |
|----------|--------|-------|-----------------|
| `GET /health` | Free | — | No |
| `GET /preflight` | Free | — | No |
| `GET /risk` | Free | — | No |
| `GET /assess-risk` | Paid | 0.001 USDC | No |
| `GET /check-token-security` | Paid | 0.001 USDC | No |
| `GET /simulate-transaction` | Paid | 0.001 USDC | No |
| `GET /token-price` | Paid | 0.001 USDC | No — server has key |
| `GET /pool-info` | Paid | 0.001 USDC | No — server has key |
| `GET /swap-route` | Paid | 0.001 USDC | No — server has key |

> **No USDC?** All paid endpoints have local equivalents (`get_token_price`, `get_pool_info`, `assess_risk`, etc.) that run free via MCP or CLI — you just need your own `DODO_API_KEY` for price/pool tools. Free endpoints (`/health`, `/preflight`, `/risk`) work without any payment.

---

## Security Defaults

SafeHands ships safe — nothing is enabled without explicit opt-in:

- `WRITE_TOOLS_ENABLED=false` — no on-chain writes without opt-in
- `WALLET_MODE=none` — no signer loaded on startup
- Unlimited token approvals blocked
- Mainnet actions blocked
- SSRF-sensitive x402 URLs blocked
- Private keys never returned in responses or logs
- Daily spend cap enforced in-memory per wallet

---

## On-Chain Proof

The RiskRegistry contract is live on Pharos Atlantic:

| | |
|---|---|
| **Contract** | [`0x61962a6c812ee9f57b207e1ea47c19ae70bb7141`](https://atlantic.pharosscan.xyz/address/0x61962a6c812ee9f57b207e1ea47c19ae70bb7141) |
| **Live TX** | [`0x6a58f636...fdefc`](https://atlantic.pharosscan.xyz/tx/0x6a58f636814458c09304db3d7c4f5f48e764f6439649fbb786cddb32c77fdefc) |
| **Action** | `publish_risk_score` → RiskRegistry |
| **Block** | `24168297` |
| **Gas Used** | `140,187` |

---

## Network

| | Value |
|---|---|
| Chain ID | `688689` |
| Network | Pharos Atlantic Testnet |
| RPC | `https://atlantic.dplabs-internal.com` |
| Explorer | `https://atlantic.pharosscan.xyz` |
| USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` |
| RiskRegistry | `0x61962a6c812ee9f57b207e1ea47c19ae70bb7141` |

---

## Configuration Reference

```env
# Wallet mode
WALLET_MODE=none              # none | env | managed-testnet
PRIVATE_KEY=                  # required when WALLET_MODE=env
WALLET_STORE_PATH=            # persist managed wallets to disk

# Write gates (all off by default)
WRITE_TOOLS_ENABLED=false
ALLOW_UNLIMITED_APPROVAL=false

# Spend limits
MAX_TX_AMOUNT_PHRS=0.1
MAX_DAILY_SPEND_USD=10
PHRS_USD_PRICE=1.0

# DODO API (required for swaps and price data)
DODO_API_KEY=
```

### Wallet Modes

| Mode | How it works |
|------|-------------|
| `none` | No signer — read-only tools only (safe default) |
| `env` | Reads `PRIVATE_KEY` from `.env` |
| `managed-testnet` | Uses wallet created via `create_agent_wallet` |

Managed wallets are AES-256-GCM encrypted on disk. The `.agents/` folder is gitignored.

---

## Testing

```bash
npm run build    # compile TypeScript
npm test         # 44 deterministic smoke tests (no wallet/RPC needed)
npm run demo     # 10 live safety checks in terminal (no wallet needed)
npm run test:all # build + test + demo in one command
npm run dev      # MCP server in dev mode
```

The smoke tests cover: amount validation, address validation, mainnet blocking, SSRF blocking (localhost, 169.254, IPv6), unlimited approval blocking, strict schema rejection, wallet creation validation, and all required ALLOW/BLOCK policy decisions.

Manual CLI testing after build:

```bash
npm run build
node dist/index.js skill safehands_preflight_check \
  '{"actionType":"approve_token","chainId":688689,"approvalAmount":"max","approvalToken":"USDC","spender":"0x0000000000000000000000000000000000000001"}'
```

Live preflight examples with real outputs: [DEMO.md](DEMO.md)

> **CLI vs MCP:** All 27 tools are available over MCP (Claude Desktop, Anvita Flow). The `skill` CLI exposes 19 tools suitable for terminal use — write-heavy tools like `execute_swap`, `send_payment`, `approve_token` are MCP-only to prevent accidental execution from the command line.

---

## Known Limitations

- Testnet-only — not audited for mainnet use
- Managed wallet encryption is AES-256-GCM, not KMS/Vault grade
- `get_token_price`, `get_pool_info`, and swap routing require a DODO API key when running locally (or use the x402 `/token-price`, `/pool-info`, `/swap-route` endpoints — no key needed)
- GoPlus token security does not support Pharos testnet (Chain 688689) — returns a clear error
- DODO reverse routes (e.g. USDT → PHRS) have no liquidity on testnet
- x402 client/server verified against SafeHands's own server; not yet tested against live third-party x402 endpoints on Pharos

---

## Roadmap

SafeHands is designed to grow from a single-project guardrail into **shared safety infrastructure for the Pharos agent economy**.

### Phase 1 — Foundation ✅ Complete

- [x] 27-tool MCP package published to npm (`safehands-pharos`)
- [x] Policy engine: mainnet guard, approval limits, SSRF, spend caps, token registry
- [x] RiskRegistry smart contract live on Pharos Atlantic (`0x61962a6c812ee9f57b207e1ea47c19ae70bb7141`)
- [x] x402 client + server — preflight-gated payment flow
- [x] AES-256-GCM managed wallet with persistent encrypted store
- [x] Live server deployed on Railway

---

### Phase 2 — Agent Policy Layer

> *Every agent carries its own safety policy, not a shared global config.*

- [ ] **Per-agent spend limits** — `set_spend_limits` / `get_spend_limits` tool pair. Each agent instance defines its own daily cap, per-TX limit, and allowed action types — stored alongside the encrypted wallet key.
- [ ] **Policy templates** — preset profiles (`conservative`, `standard`, `degen`) applied in one call, instead of configuring each limit manually.
- [ ] **BLOCK event webhooks** — agents register a callback URL; any BLOCK decision fires a structured alert payload for observability and audit trails.
- [ ] **Community risk registry** — as more agents call `publish_risk_score`, the on-chain RiskRegistry becomes a crowd-sourced reputation layer. A malicious contract flagged by one agent is visible to all.

---

### Phase 3 — Ecosystem Standard

> *Any Pharos skill can plug into SafeHands as a composable guardrail layer.*

- [ ] **Standardized guardrail interface** — a Pharos community spec so any skill exposes `preflight(action) → ALLOW | WARN | BLOCK`. Other skills compose with SafeHands instead of reinventing safety logic.
- [ ] **Cross-chain x402 guardrails** — SafeHands's x402 preflight is protocol-level, not chain-specific. The same guardrail pattern can protect agents on AgentCash (Base / Solana) or any x402-compatible network.
- [ ] **`@safehands/client` SDK** — a lightweight package other Pharos skill developers import to add preflight checks with one line of code.
- [ ] **Mainnet support** — requires full re-audit of every policy check, formal verification of RiskRegistry, and KMS/Vault-grade key management before it can be trusted with real funds.

---

## License

MIT © [SZtch](https://github.com/SZtch)
