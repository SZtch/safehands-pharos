---
name: safehands
description: Pre-execution security layer for autonomous agent finance on Pharos. Use this skill to analyze wallet, token, contract, or transaction intent risk before execution, query on-chain SafeHands risk records and agent reputation, check whether an address, wallet, token, or contract is safe or a scam before a swap, transfer, or approval, or protect autonomous finance agents from unsafe on-chain actions.
---

# SafeHands

## Overview

SafeHands is a pre-execution security layer for autonomous agent finance on **Pharos Pacific Mainnet (chainId 1672)**. Before an agent signs, approves, swaps, pays, or calls a contract, this Skill checks the proposed action and returns a structured risk report: a **riskScore (0–100)**, an **allow / warn / block** recommendation, detected **riskFactors**, a plain-English **explanation**, and a suggested **nextAction**.

This Skill is **fully hosted**: it reads Pharos directly via public JSON-RPC (`https://rpc.pharos.xyz`) using the bundled engine at `scripts/safehands-engine.js`. Contract analysis cross-checks the **official Pharos Token Registry and Canonical Contracts** (baked into `assets/safehands/known-pharos.json`) to catch token impersonation (fake USDC/WPROS/WETH/LINK) and recognize canonical infrastructure. It is further enriched with **GoPlus threat intelligence** (public keyless API: honeypot, buy/sell tax, hidden owner, malicious-address flags) with graceful fallback to on-chain heuristics if GoPlus is unreachable. It requires no backend, holds no keys, and performs **read-only** chain access exclusively (`eth_call`, `eth_get*`). It never signs, never pays, never custodies.

## When to use this Skill

Use SafeHands when the user or a calling agent wants to:
- Check whether a wallet address is safe to interact with before sending funds or transacting.
- Vet a token or contract address before an agent swaps into it or calls it.
- Review a proposed transfer or swap intent and get an allow/warn/block verdict before execution.
- Query existing SafeHands on-chain risk records or an agent's verified-action reputation.
- Understand what an allow/warn/block recommendation means and what to do next.

## Required inputs

| Input | Needed for | Notes |
|---|---|---|
| wallet address | wallet analysis | 0x + 40 hex chars. |
| token/contract address | contract analysis, swap intent | 0x + 40 hex chars. |
| action (`transfer` or `swap`) | intent analysis | Plus `toAddress` (transfer) or `tokenIn`/`tokenOut` (swap). |
| amount | transfer intent (optional) | Human-readable decimal string, e.g. `"1.5"`. |
| acting wallet address | intent analysis (required) | The wallet that would execute — required so balance checks are real. |
| subject address | query | Address whose risk records / reputation to look up. |

If a required input is missing, ask a follow-up question before running the engine.

## Safety rules (non-negotiable)

1. Never sign, broadcast, pay, or execute anything. This Skill is analysis and read-only queries ONLY.
2. Never request, accept, store, or forward private keys, seed phrases, or mnemonics. The engine rejects key-like input (`KEY_MATERIAL_REJECTED`).
3. Only Pharos pacific-mainnet (chainId **1672**) is supported. Refuse other chains (`CHAIN_NOT_SUPPORTED`).
4. Report scores and factors EXACTLY as the engine returns them. Never invent, soften, or inflate a score.
5. A **block** verdict means stop: advise the user against the action. Do not suggest workarounds.
6. Be honest about depth: the engine combines on-chain heuristics with GoPlus threat intelligence (honeypot, taxes, hidden owner, malicious-address flags) when GoPlus is reachable — check the `intel` field and say when it was unreachable. Bespoke sell-simulation and source-level audits are still not performed.
7. Publishing new risk records or attestations on-chain is **not available** in this hosted deployment (see Unsupported requests).

## Capability Index

| # | Capability | How | Reference |
|---|---|---|---|
| 1 | Check engine & RPC health | `node scripts/safehands-engine.js health` | safehands.md §A |
| 2 | Analyze wallet risk | `analyze {"subjectType":"wallet","address":…}` | safehands.md §B |
| 3 | Analyze token/contract risk | `analyze {"subjectType":"contract","address":…}` | safehands.md §B |
| 4 | Analyze transfer/swap intent before execution | `analyze {"subjectType":"intent",…}` | safehands.md §B |
| 5 | Query on-chain SafeHands risk records | `query <address>` | safehands.md §C |
| 6 | Query agent reputation (verified actions) | `query <address>` (same call) | safehands.md §C |
| 7 | Explain allow/warn/block recommendation | No engine call needed | safehands.md §D |

For every operation, read `references/safehands.md` and follow the matching section exactly — it contains command templates, parameter tables, output parsing, error handling, and agent guidelines.

## Flows

**Analyze flow:** collect inputs → run `safehands-engine.js analyze '<json>'` → parse JSON from stdout → present riskScore, recommendation, riskFactors, explanation, nextAction. On `block`, stop and advise against.

**Query flow:** validate address → run `safehands-engine.js query '<address>'` → present registry status, matching records (with `expired` flags), and reputation. An empty result is neutral ("no record"), not proof of safety.

**Health flow:** run `safehands-engine.js health` → confirm `ok:true` and `chainId:1672`. Run this first if any other call fails with an RPC error.

## Unsupported requests

Politely decline and explain:
- **Publishing risk records or attestations on-chain** — requires the SafeHands operator backend, which is not part of this hosted deployment. Analysis and read-only queries only.
- Executing, signing, or preparing any transaction; recovering funds; financial advice; guaranteeing an asset is safe.
- Any chain other than Pharos pacific-mainnet (1672).
- Full source-code audits (recommend deeper review for high-value actions; honeypot/tax flags ARE covered via GoPlus when reachable).
