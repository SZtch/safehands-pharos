<p align="center">
  <img src="assets/banner.svg" alt="SafeHands — transaction-safety gateway for AI agents on Pharos Pacific Mainnet" width="100%">
</p>

# SafeHands

**A transaction-safety gateway for AI agents on Pharos Pacific Mainnet — the compliance checkpoint Real-Fi needs before any tokenized-asset transaction is signed.**

An AI agent can sign almost anything: an unlimited token approval, a swap on the wrong chain, a payment to a malicious x402 endpoint, a transfer of a tokenized asset to an unvetted counterparty. SafeHands is the check that runs *before* the signature. A deterministic policy engine evaluates every action and returns one of four decisions (`ALLOW`, `BLOCK`, `REQUIRE_CONFIRMATION`, `PREPARE_ONLY`) with a plain-English reason — and every relayed verified broadcast is attested on-chain, building a privacy-preserving audit trail and reputation layer. You act on your own wallet; SafeHands never holds keys and never signs for you.

It ships as an MCP server, an HTTP API, and a CLI, exposing 33 tools that any agent in the Pharos ecosystem can call.

---

## 🏆 NEW: SafeHands on Anvita Flow — fully-hosted Service Agent (Agent Carnival Phase 2)

SafeHands ships as a **fully-hosted, zero-infrastructure Service Agent** for [Anvita Flow](https://flow.anvita.xyz/home) (Pharos Agent Carnival, Phase 2). Once published, any Steward Agent on the marketplace can discover and call it — no server, no keys, no custody anywhere in the running system.
<!-- after publish: replace the sentence above with the live marketplace link + "tell your Steward: go find SafeHands" -->

```
User → Steward Agent → Anvita Flow marketplace → SafeHands (hosted skill)
                                                      │
                                     reads Pharos mainnet (1672) directly via public RPC
                                     + official Pharos Token & Canonical-Contract registries
                                     + GoPlus threat intelligence (hackathon sponsor)
                                                      │
                                     deterministic verdict: riskScore 0–100 · allow / warn / block
```

**The hosted package lives in [`anvita/safehands/`](anvita/safehands/)** — a Pharos Skill following the official Skill-Engine pattern, powered by a **zero-dependency deterministic risk engine** ([`safehands-engine.js`](anvita/safehands/scripts/safehands-engine.js)):

| Capability | How it decides |
|---|---|
| **Token impersonation detection** | live on-chain `symbol()` cross-checked against the **official Pharos Token Registry** — catches fake USDC/WPROS/WETH/LINK that clean-looking threat feeds miss |
| Honeypot / sell-tax / hidden-owner | **GoPlus threat intelligence** (keyless public API, graceful fallback) |
| Malicious wallet flags | GoPlus address security: phishing, stealing, cybercrime |
| Canonical infrastructure recognition | 14 official Pharos canonical contracts (Safe, Permit2, EntryPoint 4337…) |
| Transfer / swap intent review | live balance, history & counterparty checks before execution |
| On-chain risk records & agent reputation | reads the SafeHands Registry & Attestation contracts via `eth_call` |

Every verdict is **computed by code, not guessed by an LLM** — the AI layer only handles conversation. Every analysis links to [Pharosscan](https://www.pharosscan.xyz) so users verify the evidence themselves. The engine is deterministic and dependency-free, so identical inputs always yield an identical verdict.

> **Why read-only is the feature, not the limitation:** a security layer that *could* move funds is a security risk. SafeHands holds no keys, signs nothing, and custodies nothing — which is exactly why every other agent can trust it in front of their transactions.

[![CI](https://github.com/SZtch/safehands-pharos/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SZtch/safehands-pharos/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Pharos Pacific Mainnet](https://img.shields.io/badge/Pharos_Pacific_Mainnet-1672-6d28d9)
![33 tools](https://img.shields.io/badge/tools-33-0891b2)
![Hosted mode: read-only](https://img.shields.io/badge/hosted-read--only-16a34a)
![License: MIT](https://img.shields.io/badge/license-MIT-black)

---

## Try it in 10 seconds

**One command, zero infrastructure** — no config, no wallet, no keys, no transactions:

```bash
npx -y github:SZtch/safehands-pharos --demo
# (after npm publish: npx safehands-pharos --demo · or locally: git clone → npm install → node dist/index.js --demo)
```

Watch the deterministic policy engine issue real `ALLOW` / `BLOCK` decisions against Pharos Pacific Mainnet. The hosted agent lives on [Anvita Flow](https://flow.anvita.xyz/home) — see the section above.

It runs twelve deterministic safety checks in your terminal (wallet health, ALLOW/BLOCK decisions, token-registry lookups, x402 preflight, SSRF blocking, risk scoring, RWA transfer-compliance and settlement-cap scenarios) and touches nothing on-chain.

<details>
<summary>Sample output — one of the twelve checks</summary>

```text
$ npx safehands-pharos --demo

🛡️  SafeHands-Pharos Deterministic Demo
   Environment: pacific-mainnet
   Chain ID: 1672
   Mode: non-destructive demo, no real transactions broadcast

  3. Unlimited Approval Preflight: BLOCK

safehands_preflight_check
{
  "success": true,
  "data": {
    "decision": "BLOCK",
    "riskLevel": "HIGH",
    "safeToExecute": false,
    "reasons": ["Unlimited approval requested."],
    "requiredActions": ["Use a limited approval amount."]
  },
  "error": null
}
```

</details>

---

## Run the API yourself (optional self-host)

The hosted agent lives on Anvita Flow (see above). To exercise the HTTP API directly, self-host the zero-custody reference backend locally against Pharos Pacific Mainnet — no API key needed for the public surface:

```bash
npm install --include=dev && npm run build
node dist/api/server.js   # read-only API on http://localhost:4022 (PORT env to change)
```

```bash
# Health + network config
curl -s http://localhost:4022/health
curl -s http://localhost:4022/public-config

# Real preflight decision from the live policy engine
curl -s -X POST http://localhost:4022/tools/safehands_preflight_check \
  -H "content-type: application/json" \
  -d '{"actionType":"approve_token","chainId":1672,"approvalToken":"USDC","spender":"0x000000000000000000000000000000000000dEaD","approvalAmount":"max"}'

# On-chain reputation read (live attestation contract)
curl -s -X POST http://localhost:4022/tools/get_agent_reputation \
  -H "content-type: application/json" \
  -d '{"address":"0x6730d3a2A217108AB53CCFe60ffdAd05D3C124e5"}'

# x402-gated endpoint — returns a real HTTP 402 challenge (mainnet USDC, eip155:1672)
curl -s -i http://localhost:4022/paid/risk-report
```

Interactive browser demo (while the local API runs): **http://localhost:4022/demo**.

---

## What it does

SafeHands sits between an agent's *intent* and the *signature*. Before any action, the agent calls `safehands_preflight_check` (or one of the specialized preflight tools) and gets back a decision:

<p align="center">
  <img src="assets/architecture.svg" alt="SafeHands architecture — agent intent flows through the deterministic policy engine to a four-value decision; the user signs with their own wallet; Pharos mainnet records the attestation audit trail, risk registry, and composable reputation" width="100%">
</p>

The decision is **deterministic**: the policy engine decides, not a model. An LLM can advise, but it cannot override a policy it dislikes.

### What it catches

| Risk | Without SafeHands | With SafeHands |
|------|-------------------|----------------|
| Unlimited token approval | Agent grants a malicious spender forever | `BLOCK` — unlimited approvals off by default |
| Unsupported chain | Agent targets a non-Pharos network (e.g. Ethereum) | `BLOCK` — chain-ID guard |
| Malicious x402 endpoint | Agent pays a localhost / private-IP URL | `BLOCK` — SSRF + redirect guard |
| Wallet drain | Agent overspends in one session | `BLOCK` — per-agent + daily spend cap |
| Unknown token | Agent swaps an unverified contract | `REQUIRE_CONFIRMATION` |
| Arbitrary contract call | Agent calls an unknown contract | `REQUIRE_CONFIRMATION` |
| Bad input | Agent passes `-1` or the zero address | `VALIDATION_ERROR` |
| Unregistered tokenized asset | Agent approves an unknown asset contract to an unverified spender | `REQUIRE_CONFIRMATION` — human review required |
| Oversized settlement | Agent settles a real-world invoice above the policy cap | `BLOCK` — deterministic spend limit |

---

## Why this matters for Real-Fi & RWA

Pharos is a Real-Fi chain, and tokenized real-world assets carry real-world obligations that memecoins do not: asset legitimacy, transfer restrictions, audit trails, settlement discipline, counterparty trust. SafeHands provides that layer — live on mainnet today, not as a mock:

| RWA requirement | SafeHands capability (live) |
|---|---|
| Asset legitimacy | Token-registry classification + GoPlus security checks (mint backdoors, honeypots) |
| Transfer restrictions | Deterministic per-agent policy: caps, approval limits, human-in-the-loop `REQUIRE_CONFIRMATION` |
| Audit trail | On-chain attestation of every relayed verified broadcast — hash-only, privacy-preserving |
| Composable risk memory | Merkle risk roots + `verifyRiskRecord` on-chain view + keyless inclusion proofs |
| Counterparty trust | `get_agent_reputation` — on-chain verified-safe track record per address |
| Settlement discipline | x402/USDC rails with SSRF guards, token allowlist, per-call and daily caps |

Demo scenarios 11–12 show the RWA flows end-to-end. Full mapping, with an honest live-vs-roadmap split: **[docs/REALFI_RWA_ALIGNMENT.md](docs/REALFI_RWA_ALIGNMENT.md)**.

---

## What it is — and is not

SafeHands is a **safety layer**, not a wallet. It is not a custody service, a private-key manager, a signer, a DEX, or a bridge.

In hosted mode (Anvita Flow) it is **read-only and zero-custody**: it holds no keys, signs nothing, and broadcasts nothing. It reads chain state, evaluates policy, and returns decisions. You always sign and send with your own wallet.

Execution tools (`execute_swap`, `send_payment`, `approve_token`, …) exist in the codebase but are gated behind explicit environment flags and are only meant to run **self-hosted and single-tenant**, on a machine you control. The public server refuses to enable them: a boot guard fails fast if managed execution is configured on a public host.

---

## Execution modes

| Mode | Key / wallet | Where it runs | Use for |
|------|--------------|---------------|---------|
| **Read-only preflight** *(default)* | none | hosted or local | Safety checks, risk analysis, demos |
| **User-signed** | your own wallet | anywhere | SafeHands validates; you sign externally, then it verifies + relays the broadcast |
| **Managed execution** | local encrypted wallet | self-hosted only | Full agent autonomy on mainnet, opt-in |
| **Env wallet** *(advanced)* | `PRIVATE_KEY` in env | local dev | Local mainnet development |

Read-only usage needs no `.env`, no private key, and no authorization.

---

## Install

```bash
npx skills add SZtch/safehands-pharos
```

### Claude Desktop (or any MCP client)

Add to `claude_desktop_config.json` and restart. The default is read-only, with no keys, wallet, or setup:

```json
{
  "mcpServers": {
    "safehands": {
      "command": "npx",
      "args": ["-y", "github:SZtch/safehands-pharos"]
    }
  }
}
```

Then ask: *"Run a SafeHands preflight on this payment."*

To run **self-hosted managed execution** on your own machine, add an `env` block. SafeHands creates a local AES-256-GCM–encrypted wallet on first run; you fund it from a faucet and authorize it before write tools unlock:

```json
{
  "mcpServers": {
    "safehands": {
      "command": "npx",
      "args": ["-y", "github:SZtch/safehands-pharos"],
      "env": { "WALLET_MODE": "managed-mainnet", "WRITE_TOOLS_ENABLED": "true" }
    }
  }
}
```

### CLI

```bash
npx github:SZtch/safehands-pharos skill safehands_preflight_check \
  '{"actionType":"approve_token","chainId":1672,"approvalToken":"USDC","spender":"0x000000000000000000000000000000000000dEaD","approvalAmount":"max"}'
```

Every tool returns the same envelope: `{ "success": true, "data": { … }, "error": null, "timestamp": "…" }`.

---

## The 33 tools

### Safety preflight — public, no key or auth

| Tool | What it does |
|------|--------------|
| `safehands_preflight_check` | Policy preflight → the public decision (ALLOW / BLOCK / REQUIRE_CONFIRMATION / PREPARE_ONLY) |
| `safehands_x402_preflight` | URL + payment safety before an x402 call |
| `safehands_risk_report` | Human-readable risk summary with on-chain registry data |
| `safehands_wallet_health` | Wallet, signer, gas, and x402 readiness |
| `explain_risk` | Translate a decision into plain English |
| `token_registry_status` | Canonical / custom / unknown token check |
| `query_risk_registry` | Read an on-chain risk record from the registry |
| `verify_risk_inclusion` | Prove a target's risk record is in the committed Merkle root (local rebuild + on-chain `verifyRiskRecord` view). Keyless |
| `get_agent_reputation` | Read an address's on-chain verified-safe track record (count + recency). Keyless, composable |

### Risk + analysis

| Tool | What it does |
|------|--------------|
| `assess_risk` | 5-dimension risk score (0–100) |
| `check_token_security` | Token security via GoPlus (mainnet) |
| `simulate_transaction` | Dry-run before broadcasting |
| `estimate_gas` | Gas estimate + sufficiency check |
| `check_allowance` | ERC-20 allowance check |

### Market + chain data

| Tool | What it does |
|------|--------------|
| `get_token_price` | Token price via DODO |
| `get_wallet_balance` | PROS / USDC / USDT balances |
| `get_gas_price` | Current gas price |
| `get_pool_info` | Pool info via DODO |
| `get_transaction_status` | Transaction status by hash |
| `get_execution_history` | Wallet transfer history |
| `query_goldsky_subgraph` | Query indexed attestation / registry events (Goldsky) |
| `get_spv_proof` | `eth_getProof` state-trie proof against a block state root |

### Execution — gated: `WRITE_TOOLS_ENABLED` + policy + managed auth

| Tool | What it does |
|------|--------------|
| `safehands_safe_execute` | Preflight + execute in one call |
| `execute_swap` | Swap via FaroSwap / DODO routing |
| `send_payment` | Send native PROS |
| `approve_token` | ERC-20 approval (unlimited blocked by default) |
| `publish_risk_score` | Publish a risk record (legacy) |
| `x402_pay_and_fetch` | Fetch an x402 resource, pay after the 402 |

### Agent policy

| Tool | What it does |
|------|--------------|
| `get_agent_policy` | Read an agent's active safety policy |
| `set_agent_policy` | Set/update policy (conservative / balanced / advanced / custom) |

### Managed wallet

| Tool | What it does |
|------|--------------|
| `create_agent_wallet` | Create a managed wallet (AES-256-GCM encrypted) |
| `get_agent_wallet` | Wallet address + metadata |
| `get_agent_wallet_balance` | Managed wallet balances |

---

## Per-agent policy

Different agents can carry different risk thresholds. Hard safety rules (mainnet guard, zero address, SSRF, unauthorized managed execution) are never overridable by any profile.

| Profile | Max payment | Max swap | Daily spend | x402 | Approval |
|---------|-------------|----------|-------------|------|----------|
| `conservative` | 0.1 PROS | 1 PROS | 5 PROS | 0.01 USDC | 10 USDC |
| `balanced` *(default)* | 1 PROS | 10 PROS | 25 PROS | 0.1 USDC | 50 USDC |
| `advanced` | 100 PROS | 1000 PROS | 5000 PROS | 1 USDC | 500 USDC |
| `custom` | user-defined | user-defined | user-defined | user-defined | user-defined |

Policies live in `.agents/policies/`. Raising a limit requires an explicit saved config; runtime or prompt injection cannot silently widen it.

---

## x402

SafeHands makes agent-driven x402 payments safer by validating the HTTP 402 requirement before anything is signed or settled:

- `safehands_x402_preflight` — no payment, no auth, URL + amount safety
- `x402_pay_and_fetch` — gated execution behind policy limits
- SSRF and redirect-SSRF are blocked; payment amount, token, and per-agent caps are enforced
- Replay/idempotency is backed by a durable store (Upstash Redis when configured, local JSON fallback)

---

## On-chain registry + attestation

SafeHands deploys two contracts to Pharos Pacific Mainnet: a **registry** (authorized operators/agents, Merkle risk roots, `verifyRiskRecord` view) and an **attestation** contract (privacy-preserving verified-safe records + reputation).

| | |
|---|---|
| Registry | [`0x428e02bf85412e7242d991cd6725ec59e8b06c8d`](https://www.pharosscan.xyz/address/0x428e02bf85412e7242d991cd6725ec59e8b06c8d) |
| Attestation | [`0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c`](https://www.pharosscan.xyz/address/0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c) |
| Network | Pharos Pacific Mainnet (chain `1672`) |
| Source | `contracts/SafeHandsRegistry.sol`, `contracts/SafeHandsAttestation.sol` |

The addresses above are the canonical live deployment (verify on the explorer). The backend reads them from `SAFEHANDS_REGISTRY_ADDRESS` / `SAFEHANDS_ATTESTATION_ADDRESS`, so you can point at your own redeploy without touching code.

**Attested broadcast.** If SafeHands relays a broadcast, it attests it. When the attested-broadcast path is enabled and a user-signed transaction is broadcast successfully, an attestation is written on-chain. The record publishes only hashed context (`preparedTransactionHash`, `policyHash`, `metadataHash`) plus the `txHash`, never raw calldata, keys, amounts, recipients, or intent. Attestation gas is paid by a dedicated `SAFEHANDS_ATTESTER_PRIVATE_KEY` that is separate from any user wallet and never signs a user transaction. If attestation is required but unconfigured, the transaction is rejected before broadcast; if the broadcast succeeds but attestation lags, the `txHash` is returned honestly with `attestationStatus: pending_retry`.

---

## Network

| | Pharos Pacific Mainnet |
|---|---|
| Chain ID | `1672` |
| Native token | `PROS` |
| RPC | `https://rpc.pharos.xyz` |
| Explorer | `https://www.pharosscan.xyz` |

Pharos Atlantic Testnet (`688689`) remains readable for legacy checks but is deprecated for execution.

---

## Security defaults

SafeHands ships closed. Nothing runs without an explicit opt-in:

- `WRITE_TOOLS_ENABLED=false` — no write tools
- `WALLET_MODE=none` — no wallet created (`managed-mainnet` is opt-in, self-hosted only)
- Unlimited approvals blocked
- Mainnet execution disabled until write/signing env gates are set
- SSRF-sensitive URLs blocked
- Private keys never returned in responses or logs
- Per-agent policy limits and daily spend caps enforced
- Managed execution gated by on-chain registry authorization
- A boot guard refuses managed/write execution on a public host

---

## Testing

```bash
npm run build           # compile
npm test                # mainnet integration smoke tests (live read-only RPC; no wallet, never broadcasts)
npm run demo            # live safety checks in the terminal
npm run test:contracts  # Hardhat contract tests (offline smoke fallback)
npm run test:all        # build + test + demo + contracts
```

`npm test` needs no wallet or key and never broadcasts — it runs live read-only checks against Pharos mainnet RPC. To exercise the live user-signed broadcast path on mainnet, opt in explicitly:

```bash
SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED=true SAFEHANDS_LIVE_BROADCAST_TEST=true npm run test:live-broadcast
```

An optional self-hosted helper (`scripts/local-wallet-helper.mjs`) lets operators sign locally with their own wallet over the standard verified-broadcast path. It requires `SAFEHANDS_LOCAL_WALLET_HELPER_ENABLED=true` and a key that stays in the local environment. Use a dedicated test wallet.

---

## Configuration

```env
# Read-only defaults — preflight works with no .env at all
PHAROS_ENVIRONMENT=pacific-mainnet
PHAROS_CHAIN_ID=1672
PHAROS_RPC_URL=https://rpc.pharos.xyz
WRITE_TOOLS_ENABLED=false

# Live SafeHands contracts on Pharos Pacific (1672)
SAFEHANDS_REGISTRY_ADDRESS=0x428e02bf85412e7242d991cd6725ec59e8b06c8d
SAFEHANDS_ATTESTATION_ADDRESS=0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c

# Self-hosted managed execution (opt-in)
WALLET_MODE=managed-mainnet     # none | env | managed-mainnet
WRITE_TOOLS_ENABLED=true
DODO_API_KEY=                   # required for price / pool / swap
```

See [.env.example](.env.example) for the full reference.

---

## Known limitations

- Managed-wallet encryption is AES-256-GCM, not KMS/Vault-grade — not intended for custody of large amounts.
- User-signed broadcast (`POST /broadcast/signed`) is live but disabled by default; without `SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED=true` it runs verify-only.
- GoPlus token security does not cover Pharos testnet (`688689`).
- DODO reverse routes can occasionally lack liquidity for exotic pairs.

---

## Roadmap

The goal is simple: be the safety check every AI agent runs *before* it acts on-chain. One rule holds at every phase: **the ALLOW/BLOCK decision stays deterministic. The model advises; the policy engine decides.**

**Shipped (v2.3.0):**

- 33-tool agent surface across MCP, HTTP, and CLI: preflight, risk scoring, on-chain reputation oracle, Merkle inclusion verifier, market/chain data, gated execution, per-agent policy, managed wallet
- Deterministic policy engine: mainnet guard, approval limits, SSRF guard, spend caps
- Registry + attestation contracts live on Pharos Pacific Mainnet, verifiable on-chain
- GoPlus token-security and Goldsky indexing integrations
- x402 preflight and gated `pay_and_fetch` with SSRF/redirect protection

**Next:** L1 risk-root committer automation, a data-availability serving endpoint, broader cross-agent reputation reads, and compliance-provider integrations for RWA flows (TRM Labs screening, Circle CCTP settlement — currently roadmap, not integrated).

---

## License

MIT © [SZtch](https://github.com/SZtch)
