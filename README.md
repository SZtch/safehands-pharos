# SafeHands-Pharos — Transaction Safety Firewall for AI Agents

> **Most Pharos skills let an agent *do* things — check balances, swap, pay, deploy.**
> **SafeHands is the one that decides whether the agent *should*.**

```bash
npx safehands-pharos skill safehands_preflight_check --input-json \
  '{"actionType":"approve_token","chainId":688689,"tokenAddress":"0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8","spenderAddress":"0x000000000000000000000000000000000000dEaD","approvalAmount":"max"}'
```

Sample output:

```json
{
  "success": true,
  "data": {
    "decision": "BLOCK",
    "riskLevel": "HIGH",
    "safeToExecute": false,
    "reasons": [
      "Unlimited approval requested."
    ],
    "requiredActions": [
      "Use a limited approval amount."
    ],
    "checks": [
      { "name": "mainnet_guard", "status": "pass", "message": "Action is not targeting mainnet." },
      { "name": "chain_id", "status": "pass", "message": "Chain ID is Pharos Atlantic Testnet (688689)." },
      { "name": "environment", "status": "pass", "message": "Environment is atlantic-testnet." },
      { "name": "approval_amount", "status": "fail", "message": "Unlimited approval is blocked by default." }
    ],
    "environment": "atlantic-testnet",
    "chainId": 688689,
    "isMainnet": false,
    "tokenRegistry": {
      "symbol": "USDC",
      "status": "SKILL_ENGINE_CANONICAL_TOKEN",
      "verificationStatus": "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE"
    },
    "source": "safehands_preflight_check"
  },
  "error": null,
  "timestamp": "2026-06-14T00:00:00.000Z"
}
```

That's the whole idea: **before** an agent approves a token, swaps, sends a payment,
or pays an x402 resource, SafeHands runs a policy check and returns `ALLOW`, `WARN`,
or `BLOCK` — with a plain-English reason. If `BLOCK`, the agent stops. No transaction,
no loss.

**Live preflight examples:** see [DEMO.md](DEMO.md) — real ALLOW and BLOCK outputs.

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/MCP_Skill-000000?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Pharos_Atlantic-688689-blueviolet?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Tools-27-orange?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Testnet_Only-SAFE-blue?style=for-the-badge" />
</p>

> **Testnet only.** SafeHands targets Pharos Atlantic Testnet (Chain ID 688689). Not audited for mainnet use.

---

## Why AI Agents Need This

Generic Web3 tools answer: *"Can this transaction be sent?"*
SafeHands answers: **"Should this action be allowed at all?"**

| Risk | What goes wrong without SafeHands | SafeHands guardrail |
|------|----------------------------------|---------------------|
| Unlimited approval | Agent approves malicious spender forever | Blocked by default |
| Wrong chain | Agent signs on mainnet by mistake | Blocked |
| Risky x402 URL | Agent pays a localhost / private IP | Blocked (SSRF guard) |
| Overspending | Agent drains wallet in one session | Daily cap enforced |
| Unknown token | Agent swaps unverified contract | Warns, requires review |
| Missing signer | Agent attempts write without wallet | Structured error returned |

SafeHands is a **Pharos Skill Engine-compatible MCP package** — a composable guardrail layer that any agent can add in front of any action, without modifying existing skill logic.

---

## Getting Started

### Step 1 — Try it now (no setup, no wallet)

```bash
npx safehands-pharos --demo
```

Runs 10 live safety checks in your terminal: ALLOW/BLOCK decisions, wallet health, token registry, x402 preflight, risk report. No config, no private key, no transactions.

---

### Step 2 — Connect to your AI agent

Pick **one** depending on how you use AI agents:

#### Claude Desktop

Add to your `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "safehands": {
      "command": "npx",
      "args": ["safehands-pharos"]
    }
  }
}
```

All 27 SafeHands tools appear automatically in every Claude conversation.

#### Anvita Flow

Add as an MCP server in Anvita Flow settings:

```json
{ "command": "npx", "args": ["safehands-pharos"] }
```

#### Terminal / scripts (CLI)

Call any tool directly without connecting to an AI client:

```bash
npx safehands-pharos skill safehands_preflight_check \
  '{"actionType":"send_payment","chainId":688689,"amount":"0.001","recipient":"0x1234567890123456789012345678901234567890"}'
```

---

### Step 3 — (Optional) Enable write operations

By default, SafeHands is **read-only**: preflight checks, risk scoring, token registry, wallet health. No private key needed.

To unlock swaps, payments, and approvals, run the setup wizard:

```bash
npx safehands-pharos init
```

Or set manually in a `.env` file in your working directory:

```env
WALLET_MODE=env             # env | managed-testnet
PRIVATE_KEY=0x...           # testnet key only — never mainnet
WRITE_TOOLS_ENABLED=true
MAX_TX_AMOUNT_PHRS=0.1      # per-transaction cap
MAX_DAILY_SPEND_USD=10      # daily spend cap
```

---

## Calling Tools from the CLI

```bash
# Short form (recommended)
npx safehands-pharos skill <tool> '<json>'

# With flag
npx safehands-pharos skill <tool> -i '<json>'

# Explicit flag
npx safehands-pharos skill <tool> --input-json '<json>'
```

Examples:

```bash
# Preflight check before a swap
npx safehands-pharos skill safehands_preflight_check \
  '{"actionType":"execute_swap","tokenIn":"PHRS","tokenOut":"USDC","amount":"0.01","chainId":688689,"isMainnet":false}'

# Check wallet balance
npx safehands-pharos skill get_wallet_balance \
  '{"walletAddress":"0xYourWallet"}'

# Assess risk score
npx safehands-pharos skill assess_risk \
  '{"action":"swap","tokenIn":"PHRS","tokenOut":"USDC","amount":"0.01","walletAddress":"0xYourWallet"}'

# Classify a token address
npx safehands-pharos skill token_registry_status \
  '{"tokenAddress":"0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8"}'
```

---

## All 27 Tools

All tools return the same response envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "timestamp": "2026-06-13T00:00:00.000Z"
}
```

On failure: `success: false`, `data: null`, `error: { code, message, retryable }`.

### SafeHands Guardrail Tools

| Tool | What it does | CLI |
|------|-------------|-----|
| `safehands_preflight_check` | ALLOW / WARN / BLOCK before any action | ✓ |
| `safehands_safe_execute` | Preflight + execute in one call | ✓ |
| `safehands_wallet_health` | Wallet, signer, gas, x402 readiness | ✓ |
| `safehands_x402_preflight` | URL safety + payment check before x402 | ✓ |
| `safehands_risk_report` | Human-readable risk summary | ✓ |
| `explain_risk` | Translate ALLOW/WARN/BLOCK into plain English | ✓ |
| `token_registry_status` | Canonical / custom / unknown token check | ✓ |

### Safety & Analysis Tools

| Tool | What it does | CLI |
|------|-------------|-----|
| `assess_risk` | 5-dimension risk score (0–100) | ✓ |
| `check_token_security` | GoPlus token security profile | ✓ |
| `simulate_transaction` | Dry-run before broadcasting | ✓ |
| `estimate_gas` | Gas estimate + sufficiency check | ✓ |
| `check_allowance` | ERC-20 allowance check | MCP |

### Market & Chain Data

| Tool | What it does | CLI |
|------|-------------|-----|
| `get_wallet_balance` | PHRS / USDC / USDT balances | ✓ |
| `get_token_price` | Token price via DODO | ✓ |
| `get_gas_price` | Current network gas price | MCP |
| `get_pool_info` | FaroSwap / DODO pool info | MCP |
| `get_transaction_status` | TX status by hash | ✓ |
| `get_execution_history` | Wallet transfer history (ERC-20 + native) | MCP |

### Write Tools *(require `WRITE_TOOLS_ENABLED=true`)*

| Tool | What it does | CLI |
|------|-------------|-----|
| `execute_swap` | Swap tokens via FaroSwap / DODO | MCP |
| `send_payment` | Send native PHRS | MCP |
| `approve_token` | ERC-20 approval (unlimited blocked by default) | MCP |
| `publish_risk_score` | Publish risk score to RiskRegistry contract | MCP |
| `x402_pay_and_fetch` | Fetch x402 resource, pay only after HTTP 402 | MCP |

### Risk Registry

| Tool | What it does | CLI |
|------|-------------|-----|
| `query_risk_registry` | Read on-chain risk score | ✓ |

### Managed Wallet Tools

| Tool | What it does | CLI |
|------|-------------|-----|
| `create_agent_wallet` | Create testnet wallet (AES-256-GCM encrypted) | ✓ |
| `get_agent_wallet` | Wallet address + metadata (no private key) | ✓ |
| `get_agent_wallet_balance` | Managed wallet balances | ✓ |

> **CLI** = callable via `npx safehands-pharos skill <tool> '<json>'`  
> **MCP** = available via Claude Desktop / Anvita Flow only

---

## Configuration

If you cloned the repo, copy the example file:

```bash
cp .env.example .env   # then edit .env with your settings
```

If you installed via `npx` or `npm install`, create a `.env` in your working directory with these settings:

```env
# Wallet mode
WALLET_MODE=none              # none | env | managed-testnet
PRIVATE_KEY=                  # required when WALLET_MODE=env
WALLET_STORE_PATH=            # optional: persist managed wallets to disk

# Write gates (all off by default)
WRITE_TOOLS_ENABLED=false
ALLOW_UNLIMITED_APPROVAL=false

# Spend limits
MAX_TX_AMOUNT_PHRS=0.1        # max PHRS per transaction
MAX_DAILY_SPEND_USD=10        # daily cap across all wallets
PHRS_USD_PRICE=1.0            # used for daily spend accounting

# DODO API (required for swaps and price data)
DODO_API_KEY=
```

### Wallet modes explained

| Mode | How it works |
|------|-------------|
| `none` | No signer — read-only tools only (safe default) |
| `env` | Reads `PRIVATE_KEY` from `.env` |
| `managed-testnet` | Uses wallet created via `create_agent_wallet` |

### Persistent managed wallets

By default, wallets created with `create_agent_wallet` are in-memory and lost on restart. To persist them:

```env
WALLET_STORE_PATH=./.agents/wallets.json
WALLET_ENCRYPTION_KEY=your-strong-secret
```

Private keys are AES-256-GCM encrypted on disk. The `.agents/` folder is gitignored.

---

## Security Defaults

SafeHands ships safe by default — nothing is enabled without explicit opt-in:

- `WRITE_TOOLS_ENABLED=false` — no on-chain writes without opt-in
- `WALLET_MODE=none` — no signer loaded on startup
- Unlimited token approvals blocked
- Mainnet actions blocked
- SSRF-sensitive x402 URLs blocked
- Private keys never returned in responses or logs
- Daily spend cap enforced in-memory per wallet

---

## x402 Support

SafeHands acts as both an x402 client and server.

**Client** (`x402_pay_and_fetch`): Fetches a resource normally first. If the server returns HTTP 402, SafeHands runs a preflight check, requests the signer, pays, and retries — all in one tool call. Payment proofs are never logged.

**Server** (`npm run x402-server`): Exposes paid endpoints. A live instance runs at:

```
https://safehands-pharos-production.up.railway.app
```

| Endpoint | Type | Price |
|----------|------|-------|
| `GET /supported` | Free | — |
| `GET /health` | Free | — |
| `GET /assess-risk` | Paid | 0.001 USDC |
| `GET /check-token-security` | Paid | 0.001 USDC |
| `GET /simulate-transaction` | Paid | 0.001 USDC |

---

## Examples

**Threat Radar dashboard** (`examples/dashboard/index.html`) — open in any browser to see a visual ALLOW / WARN / BLOCK feed. Uses illustrative sample data; not connected to live on-chain events.

**Prompt-injection attack scenario** (`examples/scenario-hack.ts`) — demo showing SafeHands blocking an unlimited token approval triggered by a simulated prompt-injection attack. Run the equivalent check directly with the CLI (no extra dependencies):

```bash
npx safehands-pharos skill safehands_preflight_check \
  '{"actionType":"approve_token","chainId":688689,"approvalAmount":"max","spender":"0xBadActor12300000000000000000000000000000"}'
```

The `.ts` source file shows the full narrative output — run it with `npx tsx examples/scenario-hack.ts` after cloning the repo.

---

## Network Info

| Item | Value |
|------|-------|
| Chain ID | `688689` |
| RPC | `https://atlantic.dplabs-internal.com` |
| Explorer | `https://atlantic.pharosscan.xyz` |
| USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` |
| RiskRegistry | `0x61962a6c812ee9f57b207e1ea47c19ae70bb7141` |

**Proof of life — live on-chain tx:**

| What | Value |
|------|-------|
| Action | `publish_risk_score` → RiskRegistry |
| Tx Hash | [`0x6a58f636...fdefc`](https://atlantic.pharosscan.xyz/tx/0x6a58f636814458c09304db3d7c4f5f48e764f6439649fbb786cddb32c77fdefc) |
| Block | `24168297` |
| Gas Used | `140,187` |

---

## Testing

```bash
npm run build
npm run test:all          # 43-point smoke test (no network needed)
npm run test:rpc:live     # live RPC connectivity check
npm run test:live:safehands  # 7 CLI safety checks against built dist
npm run test:dodo:live    # DODO API check (skips if DODO_API_KEY not set)
```

---

## Known Limitations

- Testnet-only — not audited for mainnet
- Managed wallet encryption is AES-256-GCM but not KMS/Vault grade
- `get_token_price` and swap routing require a DODO API key
- GoPlus token security does not support Pharos testnet (Chain 688689) — `check_token_security` returns a clear error
- DODO reverse routes (e.g. USDT → PHRS) have no liquidity on testnet
- x402 client and server are implemented with the official `@x402/fetch` and `@x402/evm` SDKs and verified against a local x402-compatible server. They have not yet been verified against live third-party x402 endpoints on Pharos.

---

## Roadmap

SafeHands is designed to grow from a single-project guardrail into **shared safety infrastructure** for the Pharos agent economy.

**Near-term**
- **Per-agent spend limits** — a `set_spend_limits` / `get_spend_limits` tool pair so each agent carries its own policy instead of a shared global cap. Stored in the existing AES-256-GCM encrypted wallet store.
- **x402 live endpoint verification** — validate SafeHands's x402 preflight against production third-party x402 endpoints on Pharos as they become available.

**Medium-term**
- **Community risk registry** — as more agents publish scores to the on-chain RiskRegistry (`0x61962a6c812ee9f57b207e1ea47c19ae70bb7141`), `query_risk_registry` becomes shared reputation infrastructure. A malicious contract blocked by one agent is flagged for all agents across the ecosystem.
- **Cross-chain x402 guardrails** — SafeHands's x402 preflight logic is protocol-level, not Pharos-specific. The same guardrail pattern can protect agents making x402 payments on AgentCash (Base / Solana) or any other compatible network.

**Long-term**
- **Mainnet support** — currently testnet-only by design. Mainnet requires a full re-audit of every safety check, formal verification of the RiskRegistry contract, and KMS/Vault-grade key management before it can be trusted with real funds.
- **Standardized guardrail interface** — a community spec so any Pharos skill can expose a `preflight(action) → ALLOW | WARN | BLOCK` interface and compose with SafeHands, rather than each skill reinventing safety logic independently.
