# SafeHands Reviewer Demo Script

Current as of v2.4.1: Pharos Pacific Mainnet (chain `1672`), Anvita Flow hosted agent, live contracts.

## 1. Project one-liner

SafeHands is the transaction firewall for AI agent finance on Pharos Pacific Mainnet: a deterministic policy engine that evaluates every agent action (payments, approvals, swaps, x402 calls, tokenized-asset moves) *before* the signature and returns `ALLOW` / `BLOCK` / `REQUIRE_CONFIRMATION` / `PREPARE_ONLY` with a plain-English reason. The hosted deployment is **read-only and zero-custody**: it holds no keys, signs nothing, and broadcasts nothing on its own.

For the Real-Fi & RWA angle (how the attestation ledger, risk registry, token verification, and USDC settlement rails serve tokenized real-world assets), see [REALFI_RWA_ALIGNMENT.md](./REALFI_RWA_ALIGNMENT.md).

## 2. Fastest paths for a reviewer

### No-install path: Anvita Flow hosted agent

The fully-hosted, zero-custody agent is being published to [Anvita Flow](https://flow.anvita.xyz/home) (Agent Carnival Phase 2). Once published, any Steward Agent on the marketplace can discover and call it: no server, no keys, no custody. To try the engine on your own machine without cloning:

```bash
npx -y github:SZtch/safehands-pharos --demo
```

### Self-host the HTTP API (read-only; no keys, no tx)

Run the read-only reference backend locally, then hit it over HTTP:

```bash
npm ci && npm run build
node dist/api/server.js   # read-only API on http://localhost:4022

# Service health
curl -s http://localhost:4022/health

# Public network config (chain 1672)
curl -s http://localhost:4022/public-config

# A real preflight decision: unlimited approval → BLOCK
curl -s -X POST http://localhost:4022/tools/safehands_preflight_check \
  -H "content-type: application/json" \
  -d '{"actionType":"approve_token","chainId":1672,"approvalToken":"USDC","spender":"0x000000000000000000000000000000000000dEaD","approvalAmount":"max"}'

# On-chain reputation of the deployer (live attestation contract)
curl -s -X POST http://localhost:4022/tools/get_agent_reputation \
  -H "content-type: application/json" \
  -d '{"address":"0x6730d3a2A217108AB53CCFe60ffdAd05D3C124e5"}'

# x402 paid endpoint. Fail-closed by default: without x402 config this returns 503.
# With X402_PAY_TO and a reachable external X402_FACILITATOR_URL set, it returns a
# real HTTP 402 challenge (mainnet USDC, eip155:1672).
curl -s -i http://localhost:4022/paid/risk-report
```

Interactive browser demo (while the local API runs): **http://localhost:4022/demo**.

## 3. Why SafeHands matters

AI agents making on-chain transactions need guardrails. Without safety checks, an agent could:

- Send funds to the wrong address or chain
- Approve unlimited token spending
- Sign drainer-crafted calldata it never actually decoded
- Execute swaps above policy limits
- Pay x402 invoices to SSRF targets
- Move a tokenized asset to an unvetted counterparty with no audit trail

SafeHands sits between the agent and the blockchain. Every action goes through preflight, risk scoring, policy checks, and authorization gates before execution is allowed; and, on the opt-in relayed-broadcast path (off by default), the broadcasts it relays are attested on-chain.

## 4. Execution modes

| Mode | Wallet | Where | Use case |
|------|--------|-------|----------|
| Read-only preflight *(default)* | none | hosted or local | Safety checks, risk analysis, demos |
| User-signed | user's own | anywhere | SafeHands validates; user signs externally; verified broadcast + attestation |
| Managed execution | local encrypted wallet | self-hosted only | Full agent autonomy, opt-in; refused on public hosts by a boot guard |
| Env wallet (advanced) | `PRIVATE_KEY` in env | local dev | Local mainnet development |

## 5. Live contracts: Pharos Pacific Mainnet

```
Network:      Pharos Pacific Mainnet
Chain ID:     1672
Registry:     0x428e02bf85412e7242d991cd6725ec59e8b06c8d
Attestation:  0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c
Owner:        0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5
Explorer:     https://www.pharosscan.xyz
```

- **SafeHandsRegistry**: authorized operators, Merkle risk roots, `verifyRiskRecord` on-chain view.
- **SafeHandsAttestation**: immutable, privacy-preserving verified-safe records plus `reputationOf()` per-address reputation. Only hashed context is published (`preparedTransactionHash`, `policyHash`, `metadataHash`, `txHash`); never raw calldata, amounts, recipients, or keys.

Both are verifiable on the explorer; the reputation oracle has live attestations recorded by a dedicated attester key (`0xe9F1d28C7136BbB1a57DA9852F216b8Cb39Eb888`) that never signs user transactions.

## 6. Demo commands

### Quick demo (no setup required)

```bash
npm ci && npm run build
npm run demo          # or: npx -y github:SZtch/safehands-pharos --demo
```

### The firewall reading raw calldata (v2.4.0, 60-second demonstration)

The hosted engine decodes approval/transfer/admin calldata **offline**: no simulation service, no third-party API. Feed it a drainer-style transaction and watch it block from the raw bytes:

```bash
# Unlimited approve to an unknown spender, hidden inside a "vault deposit": BLOCK
node anvita/safehands/scripts/safehands-engine.js analyze '{
  "subjectType":"intent","action":"vault_deposit",
  "walletAddress":"0x1111111111111111111111111111111111111111",
  "vault":"0xcA11bde05977b3631167028862bE2a173976CA11",
  "to":"0xc879C018Db60520f4355C26eD1a6D572CDAC1815",
  "data":"0x095ea7b3000000000000000000000000000000000000000000000000000000000000deadffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}'
# -> recommendation: block, riskScore >= 90
# -> "UNLIMITED approve to an UNKNOWN spender (0x…dead); the spender could move the entire … balance"
```

Contrast with a **registry-verified** protocol: trust comes only from first-party evidence (the project's own docs + on-chain checks, cited in the registry):

```bash
# Morpho Blue on Pharos, verified 2026-07-11 from Morpho's own addresses page
node anvita/safehands/scripts/safehands-engine.js analyze '{"subjectType":"contract","address":"0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb"}'
# -> recommendation: allow, riskScore 5
# -> "Canonical registry contract: Morpho Blue (verified via official-docs citation + on-chain check)"
```

Ecosystem names the registry recognizes but whose addresses are **not** yet published in their own docs (FaroSwap, Stargate, …) stay fail-closed: an unlimited approval to them blocks. That is policy, not a bug: recognition is never proof.

### Test suites

```bash
npm test               # hermetic deterministic suite (no wallet, no RPC, no network needed)
npm run demo           # 12 non-destructive demo scenarios
npm run test:contracts # 25 Hardhat Solidity tests (offline smoke fallback without a compiler)
npm run test:all       # all combined
```

Focused suites also exist: `test/x402-gate.test.ts` (x402 payment gate with a mock facilitator) and `test/risk-inclusion.test.ts` (Merkle inclusion proof path), runnable via `tsx --test <file>`.

## 7. Expected outputs

### Safe small payment → ALLOW

```
Action: send_payment
Chain ID: 1672 (Pharos Pacific Mainnet)
Amount: 0.001 PROS
-> Decision: ALLOW
```

### Non-Pharos chain → BLOCK

```
Action: send_payment
Chain ID: 1 (Ethereum Mainnet)
-> Decision: BLOCK
-> Reason: chain 1 is not the configured Pharos target
```

### Unlimited approval → BLOCK

```
Action: approve_token
Amount: unlimited / max
-> Decision: BLOCK
-> Reason: Unlimited approvals are blocked by default
```

### Unknown / unregistered token → REQUIRE_CONFIRMATION

```
Action: approve_token (finite amount, token not in the active registry)
-> Decision: REQUIRE_CONFIRMATION
-> tokenRegistry.status: unknown; human confirmation required
```

### x402 SSRF / invalid amount → BLOCK

```
Action: x402_pay_and_fetch
URL: http://169.254.169.254/metadata (internal IP)
-> SSRF_BLOCKED

Action: x402_pay_and_fetch
Amount: -1 USDC
-> VALIDATION_ERROR
```

### Policy: advanced allows a large swap, conservative does not

```
Policy: advanced
Action: swap 1000 PROS
-> within advanced maxSwapPROS: 1000

Policy: conservative
Action: swap 1000 PROS
-> exceeds conservative maxSwapPROS: 1
```

### Hard safety rules override any policy

```
Policy: advanced · Action: payment on chainId 1  -> BLOCK (non-Pharos chain, regardless of policy)
Policy: advanced · Action: unlimited approval    -> BLOCK (regardless of policy)
Policy: advanced · Action: x402 to internal IP   -> BLOCK (SSRF, regardless of policy)
```

## 8. The 33 tools (grouped)

| Category | Tools |
|----------|-------|
| Safety preflight | `safehands_preflight_check`, `safehands_x402_preflight`, `safehands_risk_report`, `safehands_wallet_health`, `explain_risk`, `token_registry_status` |
| Risk registry (on-chain) | `publish_risk_score`, `query_risk_registry`, `verify_risk_inclusion`, `get_agent_reputation` |
| Risk + analysis | `assess_risk`, `check_token_security`, `simulate_transaction`, `estimate_gas`, `check_allowance` |
| Market + chain data | `get_token_price`, `get_wallet_balance`, `get_gas_price`, `get_pool_info`, `get_transaction_status`, `get_execution_history`, `query_goldsky_subgraph`, `get_spv_proof` |
| Execution (gated) | `safehands_safe_execute`, `execute_swap`, `send_payment`, `approve_token`, `x402_pay_and_fetch` |
| Agent policy | `get_agent_policy`, `set_agent_policy` |
| Managed wallet | `create_agent_wallet`, `get_agent_wallet`, `get_agent_wallet_balance` |

All 33 are exposed identically across MCP, HTTP, and CLI.

## 9. Limitations (honest)

- Hosted mode (Anvita Flow) and the self-hosted read-only backend are zero-custody; execution, signing, managed wallets, and on-chain publishing are gated and disabled by default. A boot guard refuses managed/write execution on a public host.
- Managed-wallet encryption is AES-256-GCM, not KMS/Vault-grade; not intended for custody of large amounts, and not audited for production custody.
- GoPlus token security does not cover Pharos Atlantic Testnet (`688689`).
- DODO reverse routes can occasionally lack liquidity for exotic pairs.
- L1 risk-root committer automation and the DA-serving endpoint are roadmap; the on-chain read/verify path (`verify_risk_inclusion`) is live.
- The risk-root pipeline (queue, batch flush, `commitRiskRoot`, inclusion verify) is functional end to end and the first production batch is committed on-chain: a registry `query` reports `hasCommittedRoot:true` and returns a risk record sourced from the committed data-availability pointer. The attestation contract also has live on-chain usage.
