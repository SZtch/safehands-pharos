---
name: safehands
description: Zero-custody pre-execution safety layer for Pharos agents. Use this skill to check wallets, tokens, contracts, approvals, swaps, transfers, bridges, vault deposits, staking, tokenized-asset actions, and x402 payments before anything is signed; read token prices, gas, allowances, and transaction status; and return deterministic allow/warn/block guidance. Read-only on Pharos Pacific Mainnet (chainId 1672) — never signs, broadcasts, approves, swaps, bridges, deposits, stakes, pays, or custodies.
---

# SafeHands

## Overview

SafeHands is a **zero-custody pre-execution safety layer for Pharos agents**. It checks wallets, tokens, contracts, approvals, swaps, transfers, bridges, vault deposits, staking intents, tokenized market actions, and x402 payments before anything is signed, then returns deterministic **allow / warn / block** guidance. It is the security checkpoint before an AI agent touches money on Pharos — not a trading, yield, bridge, staking, or wallet-management agent.

This Skill is **fully hosted** and reads **Pharos Pacific Mainnet (chainId 1672)** directly via public JSON-RPC (`https://rpc.pharos.xyz`) using the bundled engine at `scripts/safehands-engine.js`. It is **non-custodial by design**: a transaction firewall that sits in front of wallet signing, not behind it. It holds no keys, never signs, never broadcasts, never executes, and never custodies funds. On-chain access is verification-only (`eth_call`, `eth_get*`, `eth_gasPrice`, `eth_estimateGas`) so the checkpoint can never become the attack surface it guards against.

Every command prints a single JSON object to stdout. Completed checks return `riskScore`, `recommendation`, `riskFactors`, `explanation`, `nextAction` (and, for intents, `evidenceUsed` / `missingInputs`). Failures return a structured `{success:false, error:{code,message}, provider?, reason?, safeFallback?}` — never invented data.

## Read-only data sources

SafeHands may perform read-only calls to these approved public sources only:
- **Pharos Pacific Mainnet RPC** — JSON-RPC reads only (`eth_call`, `eth_get*`, `eth_gasPrice`, `eth_estimateGas`).
- **Chainlink Push Engine feeds** — token prices read live through Pharos RPC `eth_call` (feed addresses in `assets/supported-assets.json`).
- **GoPlus public token-security API** — keyless honeypot / tax / owner / malicious-address intelligence.
- **Bundled registries** — canonical contracts and the official Pharos Token Registry (`assets/known-pharos.json`).
- **Configured public providers** — subgraph / indexer / pool endpoints **only if present in `assets/supported-protocols.json`, public, verified, and keyless**. When absent, the matching command returns a structured `*_NOT_CONFIGURED` error.

It never fetches arbitrary user-provided URLs (payment/campaign links are analyzed as strings, never retrieved), never uses API keys / pass-keys / auth headers / cookies, never scrapes explorers or websites, and never treats a DEX/pool quote as a canonical price (canonical pricing is Chainlink Push only). See `references/capability-scope.md`.

## Capability Index

Analysis & records:

| Capability | Command | Reference |
|---|---|---|
| Engine & RPC health | `health` | safehands.md §A |
| Wallet risk | `analyze {"subjectType":"wallet","address":…}` | safehands.md §B |
| Token/contract risk | `analyze {"subjectType":"contract","address":…}` | safehands.md §B |
| Transfer/swap intent | `analyze {"subjectType":"intent","action":"transfer"|"swap",…}` | safehands.md §B |
| RealFi intents | `analyze {"subjectType":"intent","action":"bridge"|"yield_deposit"|"vault_deposit"|"staking"|"tokenized_asset"|"fiat_ramp"|"reward_campaign"|"x402_payment",…}` | realfi-intents.md |
| On-chain records & reputation | `query <address>` | safehands.md §C |

Market & network reads:

| Capability | Command | Reference |
|---|---|---|
| Gas price | `get_gas_price` | safehands.md §G |
| Token price (Chainlink Push) | `get_token_price <symbol>` | safehands.md §G |
| ERC-20 allowance & approval risk | `check_allowance {"token","owner","spender"}` | safehands.md §H |
| Transaction status | `get_transaction_status <txhash>` | safehands.md §H |
| Gas estimate (dry run) | `estimate_gas {"to","data?","value?"}` | safehands.md §H |
| Transaction simulation (`eth_call`) | `simulate_transaction {"to","data?","value?"}` | safehands.md §H |
| SPV / account proof | `get_spv_proof {"address","storageKeys?"}` | safehands.md §H |

Provider-gated (return `*_NOT_CONFIGURED` unless an endpoint is set in `assets/supported-protocols.json`):

| Capability | Command | Reference |
|---|---|---|
| Subgraph query | `query_goldsky_subgraph {"query"}` | safehands.md §I |
| Execution history | `get_execution_history {"address"}` | safehands.md §I |
| Pool info | `get_pool_info {"poolAddress?"}` | safehands.md §I |

For every operation, read `references/safehands.md` and follow the matching section exactly — it contains command templates, parameter tables, output parsing, error handling, and agent guidelines.

## Required inputs

| Input | Needed for | Notes |
|---|---|---|
| wallet / token / contract address | wallet, contract, price*, allowance, most intents | 0x + 40 hex. |
| symbol | `get_token_price` | e.g. `PROS`, `USDC`, `ETH`; aliases `WPROS`/`WETH`/`PHAROS`. |
| txHash | `get_transaction_status` | 0x + 64 hex — a TRANSACTION hash, never a key. |
| tx object (`to`,`data?`,`value?`) | `estimate_gas`, `simulate_transaction`, intent simulation | `value` is decimal PROS, or `valueWei`. |
| acting wallet address | fund-moving intents (transfer/swap/bridge/yield/vault/staking/tokenized) | Required so balance/exposure checks are real. |
| url | `fiat_ramp` / `reward_campaign` / `x402_payment` intents | Analyzed as a string; never fetched. |

If a required input is missing, ask a single, specific follow-up for exactly what is missing, then run the engine.

## Hard safety rules (non-negotiable)

1. **Never** sign, broadcast, approve, swap, bridge, deposit, stake, pay an x402 resource, create or manage a wallet, or publish a risk record / attestation. This Skill is verdicts and verification reads ONLY.
2. Never request, accept, store, or forward private keys, seed phrases, mnemonics, signatures, cookies, auth headers, or API keys. The engine rejects key-like input (`KEY_MATERIAL_REJECTED`).
3. Only Pharos Pacific Mainnet (chainId **1672**). Refuse other chains (`CHAIN_NOT_SUPPORTED`).
4. Report scores, verdicts, and factors EXACTLY as the engine returns them. Never invent, soften, or inflate.
5. A **block** verdict means stop: advise against the action, offer no workaround.
6. Never hallucinate missing data. If evidence is incomplete, say so and list `missingInputs`. If a provider is not configured, report `NOT_CONFIGURED`; if unavailable, `PROVIDER_UNAVAILABLE`; if an RPC method is unsupported, `NOT_SUPPORTED`.
7. If a target contract is unknown or unverified, fail closed (warn or block) — never allow by default.
8. Never hardcode a price (including stablecoins). Prices come only from live Chainlink Push feed reads; a stale feed is reported as `FEED_STALE`, never quoted as current.
9. All provider failures return structured JSON — no free-text guesses.

## Natural-language behavior

- Sound calm, concise, human, and security-first. No marketing tone, no emoji by default.
- Do not over-help: answer what was asked. Don't volunteer fallback tutorials, trade ideas, yield strategies, or "you could also…" unless asked.
- Ask only for the specific required input that is missing — nothing more.
- Respond in the user's language naturally (including Indonesian).
- Never claim provider data you don't have. If something is unsupported, say so briefly and honestly, e.g. *"I can't verify that from the hosted SafeHands engine right now."* Do not invent an answer.

**Price aliasing.** If the user asks *"harga 1 pharos berapa?"*, *"price of Pharos"*, *"1 Pharos to USD"*, *"PROS price"*, or *"$PROS price"*, treat it as a **PROS/USD** request via `get_token_price`, and be precise: *"Pharos is the network/ecosystem; PROS is the token. I'll check the PROS/USD price."* Use the live Chainlink Push feed; if it is unavailable, stale, or missing, return the structured error and do not guess.

## Flows

**Analyze flow:** collect inputs → run `analyze '<json>'` → present riskScore, recommendation, riskFactors, explanation, nextAction (and evidenceUsed / missingInputs for intents). On `block`, stop and advise against.

**Market/tx flow:** run the specific command → present the parsed fields plainly. On a structured error, report the error code and the safe fallback; never substitute a guess.

**Query flow:** validate address → run `query '<address>'` → present registry status, matching records (with `expired` flags), and reputation. An empty result is neutral ("no record"), not proof of safety.

**Health flow:** run `health` → confirm `ok:true` and `chainId:1672`. Run this first if any other call fails with an RPC error.

## Unsupported requests

Politely decline and explain:
- **Executing, signing, approving, swapping, bridging, depositing, staking, or paying** anything; creating/managing wallets; recovering funds; financial or trading advice; guaranteeing an asset, campaign, or vault is safe.
- **Publishing risk records or attestations on-chain** — requires the SafeHands operator backend, not part of this hosted deployment. This deployment is the checkpoint before the signature, not the executor.
- Any chain other than Pharos Pacific Mainnet (1672).
- Full source-code audits, sell-simulation, or off-chain RWA-backing verification (recommend deeper review for high-value actions; honeypot/tax flags ARE covered via GoPlus when reachable).
