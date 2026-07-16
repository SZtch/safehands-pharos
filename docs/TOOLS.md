# The 33 SafeHands tools

One policy engine behind three surfaces (MCP server, HTTP API, CLI), exposing 33 tools any
agent on Pharos Pacific Mainnet (chain `1672`) can call. Every tool returns the same envelope:
`{ "success": true, "data": { … }, "error": null, "timestamp": "…" }`.

The safety-preflight, risk, and market/chain tools are public and need no key or wallet.
Execution tools are OFF by default behind env gates plus the policy verdict (see
[DECISION_CONTRACT.md](./DECISION_CONTRACT.md) and [PRODUCTION_BACKEND.md](./PRODUCTION_BACKEND.md)).

## Safety preflight: public, no key or auth

| Tool | What it does |
|------|--------------|
| `safehands_preflight_check` | Policy preflight, returns the public decision (ALLOW / BLOCK / REQUIRE_CONFIRMATION / PREPARE_ONLY) |
| `safehands_x402_preflight` | URL + payment safety before an x402 call |
| `safehands_risk_report` | Human-readable risk summary with on-chain registry data |
| `safehands_wallet_health` | Wallet, signer, gas, and x402 readiness |
| `explain_risk` | Translate a decision into plain English |
| `token_registry_status` | Canonical / custom / unknown token check |
| `query_risk_registry` | Read an on-chain risk record from the registry |
| `verify_risk_inclusion` | Prove a target's risk record is in the committed Merkle root (local rebuild + on-chain `verifyRiskRecord` view). Keyless |
| `get_agent_reputation` | Read an address's on-chain verified-safe track record (count + recency). Keyless, composable |

## Risk + analysis

| Tool | What it does |
|------|--------------|
| `assess_risk` | 5-dimension risk score (0-100) |
| `check_token_security` | Token security via GoPlus (mainnet) |
| `simulate_transaction` | Dry-run before broadcasting |
| `estimate_gas` | Gas estimate + sufficiency check |
| `check_allowance` | ERC-20 allowance check |

## Market + chain data

| Tool | What it does |
|------|--------------|
| `get_token_price` | Canonical USD price via Chainlink Push Engine feeds on Pharos Pacific Mainnet, with bounded degraded cache on transient RPC failure |
| `get_wallet_balance` | PROS / USDC / USDT balances |
| `get_gas_price` | Current gas price |
| `get_pool_info` | Pool / route info via DODO / FaroSwap |
| `get_transaction_status` | Transaction status by hash |
| `get_execution_history` | Wallet transfer history |
| `query_goldsky_subgraph` | Query indexed attestation / registry events (Goldsky) |
| `get_spv_proof` | `eth_getProof` state-trie proof against a block state root |

## Execution (gated): `WRITE_TOOLS_ENABLED` + policy + managed auth

> Experimental / unaudited. Write tools ship disabled and are opt-in, self-hosted,
> single-tenant only; the audited surface is the read-only preflight layer.

| Tool | What it does |
|------|--------------|
| `safehands_safe_execute` | Preflight + execute in one call |
| `execute_swap` | Swap via FaroSwap / DODO routing (default) or the OKX DEX aggregator (`venue: okx`, registry-verified router, requires OKX API credentials) |
| `send_payment` | Send native PROS |
| `approve_token` | ERC-20 approval (unlimited blocked by default) |
| `publish_risk_score` | Publish a risk record (legacy) |
| `x402_pay_and_fetch` | Fetch an x402 resource, pay after the 402 |

## Agent policy

| Tool | What it does |
|------|--------------|
| `get_agent_policy` | Read an agent's active safety policy |
| `set_agent_policy` | Set/update policy (conservative / balanced / advanced / custom) |

See [POLICY_PROFILES.md](./POLICY_PROFILES.md) for the profile limits.

## Managed wallet

| Tool | What it does |
|------|--------------|
| `create_agent_wallet` | Create a managed wallet (AES-256-GCM encrypted) |
| `get_agent_wallet` | Wallet address + metadata |
| `get_agent_wallet_balance` | Managed wallet balances |
