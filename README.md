# SafeHands-Pharos

<p align="center">
  <strong>Open-Source Reusable Pharos Skill — Safety Gateway for AI Agent On-Chain Actions</strong><br/>
  <em>Before an agent acts — SafeHands decides if it should.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Pharos_Skill-000000?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Pharos_Atlantic-688689-blueviolet?style=for-the-badge" />
  <img src="https://img.shields.io/badge/29_Tools-orange?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Testnet_Only-SAFE-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/v1.7.0-green?style=for-the-badge" />
</p>

---

## Try It Now — No Setup Required

```bash
npx safehands-pharos --demo
```

Runs 10 live safety checks in your terminal: ALLOW/BLOCK decisions, wallet health, token registry, x402 preflight, risk scoring. No config, no wallet, no transactions.

---

## What Is SafeHands?

SafeHands is an **open-source reusable Pharos Skill** that gives AI agents a safety gateway before on-chain actions such as payments, approvals, swaps, x402 payments, custom contract calls, risk reports, and managed agent wallet checks.

Any agent can use its preflight and risk tools freely, while managed execution tools are gated by authorization, funding checks, policy limits, and SafeHands risk approval.

SafeHands is **Pharos Atlantic Testnet-only**. It features production-inspired safety architecture but is **not audited for mainnet custody**. Mainnet and Pacific are blocked by design.

---

## Execution Modes

| Mode | Wallet/Key | Authorization | Best For |
|------|-----------|---------------|----------|
| **Preflight / Read-only** | None required | None | Safety checks, demos, risk analysis |
| **User-signed** | User's own wallet | None | User signs externally after SafeHands validates |
| **Managed execution** | Auto-created managed wallet | RiskRegistry V2 required | Full agent autonomy on testnet |
| **Env wallet** (advanced) | `PRIVATE_KEY` in env | None by default | Local testnet development |
| **Operator / demo** | Owner key for auto-authorize | Auto-authorized | Onboarding, demo flows |

**Normal preflight/read-only usage requires no `.env`, no private key, and no authorization.**

---

## How SafeHands Works

```
Agent wants to act
        |
        v
+------------------------+
|  safehands_preflight   |  <-- runs before every action
|  _check                |
+-----------+------------+
            |
     +------+------+
     | Policy Engine|  checks: chain ID, mainnet guard,
     |              |  approval limits, SSRF, spend caps,
     |              |  token registry, x402 URL safety,
     |              |  agent policy, signer availability
     +------+-------+
            |
    +-------+----------+--------+
    |       |                   |
  ALLOW   REQUIRE_           BLOCK / WARN
    |     CONFIRMATION        |
  Agent     |              Agent stops
  acts    Agent asks       (plain-English reason returned)
          user first
```

---

## Guardrails at a Glance

| Risk | Without SafeHands | With SafeHands |
|------|------------------|----------------|
| Unlimited token approval | Agent approves malicious spender forever | **BLOCK** — unlimited approval disabled by default |
| Wrong chain | Agent signs on mainnet by mistake | **BLOCK** — mainnet guard active |
| Suspicious x402 URL | Agent pays a localhost / private IP resource | **BLOCK** — SSRF guard |
| Overspending | Agent drains wallet in one session | **BLOCK** — per-agent policy + daily cap |
| Unknown token | Agent swaps unverified contract | **WARN** — requires review |
| Custom contract call | Agent calls arbitrary contract | **REQUIRE_CONFIRMATION** |
| Unauthorized managed wallet | Agent writes without V2 authorization | **BLOCK** — RiskRegistry gate |
| Invalid amount/address | Agent passes `-1` or zero address | **VALIDATION_ERROR** |

---

## Getting Started

### Quick Install

```bash
npx skills add SZtch/safehands-pharos
```

Then connect to Claude Desktop, Anvita Flow, or use from CLI.

### Option A — Connect to AI Agent (Claude Desktop)

Add to `claude_desktop_config.json`, then restart Claude Desktop. **The default is read-only — no `.env`, no private key, no wallet, no authorization required:**

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

All safety, analysis, and market tools work in this mode. Ask Claude: *"Run a SafeHands preflight on this payment"* to try it.

#### Optional — enable managed execution (testnet writes)

Only when you intentionally want the agent to execute on Pharos Atlantic Testnet, add the `env` block:

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

With managed execution enabled, SafeHands **auto-creates an encrypted agent wallet** on first connection — no manual setup. Ask Claude *"Check my SafeHands wallet health"* to see the address, fund it from the [Pharos faucet](https://testnet.pharosnetwork.xyz/), then authorize it in RiskRegistry V2 before write tools can run.

### Option B — Pharos Skill Engine / Anvita Flow

Read-only default:

```json
{
  "command": "npx",
  "args": ["safehands-pharos"]
}
```

Add `"env": { "WALLET_MODE": "managed-testnet", "WRITE_TOOLS_ENABLED": "true" }` only for optional managed execution.

### Option C — Terminal / CLI

```bash
npx safehands-pharos skill safehands_preflight_check \
  '{"actionType":"approve_token","chainId":688689,"approvalToken":"USDC","spender":"0x000000000000000000000000000000000000dEaD","approvalAmount":"max"}'
```

---

## All 29 Tools

Every tool returns the same response envelope: `{ "success": true, "data": { ... }, "error": null, "timestamp": "..." }`

### 1. Safety Preflight (public, no key/auth needed)

| Tool | What it does |
|------|-------------|
| `safehands_preflight_check` | Policy preflight — ALLOW / WARN / BLOCK / REQUIRE_CONFIRMATION |
| `safehands_x402_preflight` | URL safety + payment check before x402 |
| `safehands_risk_report` | Human-readable risk summary with on-chain V2 data |
| `safehands_wallet_health` | Wallet, signer, gas, x402 readiness, V2 authorization |
| `explain_risk` | Translate decisions into plain English |
| `token_registry_status` | Canonical / custom / unknown token check |
| `query_risk_registry` | Read on-chain risk record from RiskRegistry V2 |

### 2. Risk + Analysis

| Tool | What it does |
|------|-------------|
| `assess_risk` | 5-dimension risk score (0–100) |
| `check_token_security` | Token security via GoPlus API |
| `simulate_transaction` | Dry-run before broadcasting |
| `estimate_gas` | Gas estimate + sufficiency check |
| `check_allowance` | ERC-20 allowance check |

### 3. Market + Chain Data

| Tool | What it does |
|------|-------------|
| `get_wallet_balance` | PHRS / USDC / USDT balances |
| `get_token_price` | Token price via DODO |
| `get_gas_price` | Current gas price |
| `get_pool_info` | Pool info via DODO |
| `get_transaction_status` | TX status by hash |
| `get_execution_history` | Wallet transfer history |

### 4. Execution (gated: WRITE_TOOLS_ENABLED + policy + managed auth where applicable)

| Tool | What it does |
|------|-------------|
| `safehands_safe_execute` | Preflight + execute in one call |
| `execute_swap` | Swap tokens via FaroSwap / DODO |
| `send_payment` | Send native PHRS |
| `approve_token` | ERC-20 approval (unlimited blocked by default) |
| `publish_risk_score` | Publish risk record to RiskRegistry V2 |
| `x402_pay_and_fetch` | Fetch x402 resource, pay after 402 |

> Execution tools are reusable, but intentionally gated behind WRITE_TOOLS_ENABLED, managed wallet authorization where applicable, funding checks, policy limits, and preflight approval.

### 5. Agent Policy

| Tool | What it does |
|------|-------------|
| `get_agent_policy` | Read active safety policy for an agent |
| `set_agent_policy` | Set/update agent policy (conservative / balanced / advanced / custom) |

### 6. Managed Wallet

| Tool | What it does |
|------|-------------|
| `create_agent_wallet` | Create testnet wallet (AES-256-GCM encrypted) |
| `get_agent_wallet` | Wallet address + metadata |
| `get_agent_wallet_balance` | Managed wallet balances |

---

## Per-Agent Policy

SafeHands supports per-agent policy profiles so that different agents can have different safety thresholds:

| Profile | Max Payment | Max Swap | Daily Spend | x402 | Approval |
|---------|------------|----------|-------------|------|----------|
| `conservative` | 0.1 PHRS | 1 PHRS | 5 PHRS | 0.01 USDC | 10 USDC |
| `balanced` (default) | 1 PHRS | 10 PHRS | 25 PHRS | 0.1 USDC | 50 USDC |
| `advanced` | 100 PHRS | 1000 PHRS | 5000 PHRS | 1 USDC | 500 USDC |
| `custom` | User-defined | User-defined | User-defined | User-defined | User-defined |

Large amounts (e.g. 1000 PHRS swap) are evaluated against the agent's own policy, not blocked by a single tiny global default. Hard safety rules (mainnet blocked, zero address, SSRF, unauthorized managed execution) still cannot be overridden by any policy.

Policy files are stored at `.agents/policies/default.json` and `.agents/policies/{agentId}.json`. Raising policy limits requires explicit saved configuration — runtime/prompt injection cannot silently increase limits.

---

## x402 Support

SafeHands makes x402 safer for autonomous agents by validating HTTP 402 payment requirements before signing or settling.

- `safehands_x402_preflight` = no payment, no authorization
- `x402_pay_and_fetch` = gated execution
- SSRF / redirect SSRF blocked
- Payment amount, token, and policy limits enforced
- x402 payment idempotency/replay hardening is partially guarded by policy/preflight; full paymentId/requestHash retry cache is a future hardening item.

---

## On-Chain RiskRegistry V2

RiskRegistry V2 is the only active registry. There is no V1 in active code, packaging, or supported usage.

| | |
|---|---|
| **Contract** | `0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25` |
| **Network** | Pharos Atlantic Testnet (688689) |
| **Features** | Authorized-agent registry, risk record publishing, action hash attestations, record validity/revocation |
| **Key functions** | `setAuthorizedAgent`, `isAuthorizedAgent`, `publishRiskRecord`, `getRiskRecord`, `getLatestRiskRecordForWallet`, `getRiskRecordsForWallet`, `getRiskRecordByActionHash`, `isRiskRecordValid` |

---

## On-Chain Proof (live on Pharos Atlantic Testnet)

SafeHands doesn't just deploy a contract — the full flow runs on-chain:
**agent → SafeHands preflight → risk scored → attestation written to RiskRegistry V2 → queryable by any agent.**

**Contract:** [`0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25`](https://atlantic.pharosscan.xyz/address/0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25)

**Live risk attestations published on-chain:**

| # | Action | Risk score | Transaction |
|---|--------|-----------|-------------|
| 1 | transfer 0.001 PHRS | 3 (low) | [`0x025a97ce…38a690`](https://atlantic.pharosscan.xyz/tx/0x025a97ce4e3f6635ab171f48eef35a5b2cf7b4c5a09c3c9bf307bd5add38a690) |
| 2 | swap PHRS → USDC | 35 (medium) | [`0x3297ed1a…582231`](https://atlantic.pharosscan.xyz/tx/0x3297ed1aef4bbae9b884f9f93a075d89ec6292fd5adb0772418498b692582231) |
| 3 | transfer 0.05 PHRS | 7 (low) | [`0xe2bbf8f0…9b9488`](https://atlantic.pharosscan.xyz/tx/0xe2bbf8f0e6d7c5ec70dab8871cb0c7d5ccb7930d60b6e85fa98eb05f089b9488) |

Each transaction stores a permanent, queryable risk record (score, level, recommendation, action hash, policy version `1.7.0`). Verify the round-trip yourself — read the records back, no key required:

```bash
npx safehands-pharos skill query_risk_registry \
  --input-json '{"walletAddress":"0x6730d3a2A217108AB53CCFe60ffdAd05D3C124e5"}'
```

---

## Network

| | Value |
|---|---|
| Chain ID | `688689` |
| Network | Pharos Atlantic Testnet |
| RPC | `https://atlantic.dplabs-internal.com` |
| Explorer | `https://atlantic.pharosscan.xyz` |
| USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` |
| RiskRegistry V2 | `0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25` |

---

## Security Defaults

SafeHands ships safe — nothing enabled without explicit opt-in:

- `WRITE_TOOLS_ENABLED=false` — no writes without opt-in
- `WALLET_MODE=managed-testnet` — auto-wallet, no key exposed
- Unlimited approvals blocked
- Mainnet/Pacific blocked
- SSRF-sensitive URLs blocked
- Private keys never returned in responses or logs
- Per-agent policy limits enforced
- Managed execution gated by RiskRegistry V2 authorization
- Daily spend cap enforced in-memory per wallet

---

## Testing

```bash
npm run build       # compile TypeScript
npm test            # deterministic smoke tests (no wallet/RPC needed)
npm run demo        # 10 live safety checks in terminal
npm run test:contracts  # 37 RiskRegistry V2 contract tests
npm run test:all    # build + test + demo + contracts
npm pack --dry-run  # verify package contents
```

---

## Configuration Reference

```env
# Safe defaults — preflight works without .env
PHAROS_ENVIRONMENT=atlantic-testnet
PHAROS_CHAIN_ID=688689
PHAROS_RPC_URL=https://atlantic.dplabs-internal.com
RISK_REGISTRY_V2_ADDRESS=0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
WRITE_TOOLS_ENABLED=false

# For write operations
WALLET_MODE=managed-testnet    # none | env | managed-testnet
WRITE_TOOLS_ENABLED=true
DODO_API_KEY=                  # required for swaps/price

# Per-agent policy limits (override via get_agent_policy / set_agent_policy)
MAX_TX_AMOUNT_PHRS=0.1
MAX_DAILY_SPEND_USD=10
```

See [.env.example](.env.example) for full reference.

---

## Known Limitations

- Pharos Atlantic Testnet only — not audited for mainnet use
- Managed wallet encryption is AES-256-GCM, not KMS/Vault grade
- User-signed/prepared transaction mode is functional but not formalized as a distinct handler (roadmap)
- x402 full idempotency/replay cache is future work
- GoPlus token security does not support Pharos chain 688689
- DODO reverse routes may lack liquidity on testnet

---

## Roadmap

SafeHands' direction is to be the safety layer autonomous agents call *before* they act on Pharos.

### Shipped

- 29-tool MCP package (preflight, risk, market/chain data, gated execution, agent policy, managed wallet)
- Deterministic policy engine: mainnet guard, approval limits, SSRF guard, spend caps, per-agent policy
- RiskRegistry V2 on Pharos Atlantic Testnet — authorized-agent registry + on-chain risk attestation
- Managed execution gated by RiskRegistry V2 authorization, funding, and policy
- x402 preflight + gated `pay_and_fetch` with SSRF/redirect protection
- AES-256-GCM managed testnet wallet store

### Next — agent safety depth

- **Agent safety memory** — persist prior decisions and outcomes per agent to inform future preflights
- **Agent role policies** — richer per-role limits beyond the current profile model
- **x402 payment safety for autonomous agents** — full paymentId/requestHash replay cache and idempotency
- **Swap & approval risk before execution** — deeper pre-trade simulation and spender reputation

### Later — builder surface

- **Hosted preflight endpoint** — let any builder call SafeHands preflight over HTTP without local setup
- **SafeHands Guardian Agent** — a reference safety agent for Agent Arena

### Research only (not supported today)

- **Cross-chain safety research** — long-term research direction. SafeHands does **not** support mainnet, Pacific, or cross-chain execution in the current release.

---

## License

MIT © [SZtch](https://github.com/SZtch)
