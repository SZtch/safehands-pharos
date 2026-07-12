# SafeHands × Real-Fi & RWA: How a Pre-Execution Transaction Firewall Serves Real-World Assets

Pharos is a Real-Fi chain: its thesis is tokenized real-world assets and real-world payments settled on a fast EVM L1. As AI agents start handling those workflows (payments, treasury actions, swaps, bridges, liquidity operations, and interactions with tokenized assets), they need a deterministic firewall *before* execution. SafeHands is that firewall: no-custody, read-only safety verdicts in hosted Anvita mode, and the same policy model available to gate execution itself in self-hosted integrations.

**The claim, in one sentence:** before any AI agent moves a tokenized asset or settles a real-world payment on Pharos, SafeHands is the deterministic check that verifies the asset, enforces the transfer policy, caps the settlement; and, on the opt-in attested-broadcast path, writes a privacy-preserving audit record on-chain.

Everything in the "Live today" column below is deployed and verifiable right now: contracts on Pharos Pacific Mainnet (chain `1672`), a read-only HTTP API you can self-host as a reference backend, and a runnable demo. The zero-custody hosted agent is being published to [Anvita Flow](https://flow.anvita.xyz/home) (Agent Carnival Phase 2). Nothing in that column is aspirational: every row is running code you can verify today (known limits are disclosed honestly in [SECURITY.md](../SECURITY.md) and [PHAROS_RPC.md](./PHAROS_RPC.md)).

---

## Why RWA flows need exactly this

A tokenized T-bill, invoice, or real-estate share is not a memecoin. Real-world assets carry real-world obligations:

| RWA requirement | What goes wrong without it |
|---|---|
| **Asset legitimacy**: is this token the registered asset, or a fake? | An agent buys a spoofed "tokenized bond" with a mint backdoor |
| **Transfer restrictions**: who may move it, how much, with whose sign-off? | An agent moves a restricted security to an unvetted counterparty |
| **Audit trail**: provable evidence each transfer was checked | No compliance story; no way to show a regulator or auditor what was verified |
| **Settlement discipline**: capped, verified stablecoin payments | An agent drains a treasury paying a malicious invoice endpoint |
| **Counterparty trust**: a track record you can query on-chain | Every agent-to-agent RWA trade starts from zero trust |

DeFi tolerates "code is law, oops". Real-Fi cannot. That is the gap SafeHands fills.

## What SafeHands provides: live today vs roadmap

| RWA requirement | SafeHands capability | Status |
|---|---|---|
| Asset legitimacy | Token registry classification (`token_registry_status`: canonical / custom / unknown) + GoPlus security checks (`check_token_security`: honeypot, mintable, ownership privileges) | **Live**: demo scenario 11 |
| Transfer restrictions | Deterministic per-agent policy engine: spend caps, approval limits, `REQUIRE_CONFIRMATION` human-in-the-loop, hard rules no profile can override | **Live**: `src/lib/policy/` |
| Audit trail | On-chain attestation of every relayed verified broadcast: [`SafeHandsAttestation`](https://www.pharosscan.xyz/address/0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c) publishes only hashed context (`preparedTransactionHash`, `policyHash`, `metadataHash`, `txHash`); never amounts, recipients, or intent. Privacy-preserving by construction, which regulated assets require | **Live, opt-in**: chain 1672; the relayed-broadcast path is off by default (verify-only) until `SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED=true` |
| Risk memory other contracts can compose on | [`SafeHandsRegistry`](https://www.pharosscan.xyz/address/0x428e02bf85412e7242d991cd6725ec59e8b06c8d) Merkle risk roots + on-chain `verifyRiskRecord` view + keyless `verify_risk_inclusion` proof tool | **Live, contract + verify path**: chain 1672; first production risk batch not yet committed |
| Counterparty trust | On-chain reputation oracle: `get_agent_reputation` reads `reputationOf()`: count + recency of verified-safe actions per address. Keyless, composable by any Pharos contract or agent | **Live**: attestations recorded on mainnet |
| Settlement discipline | x402/USDC payment rails with SSRF + redirect guards, token allowlist (Pacific USDC/WPROS), per-call and daily caps; paid `/paid/*` endpoints settle via a remote facilitator with a dedicated settlement key | **Live**: demo scenario 12; with `X402_PAY_TO` + an external `X402_FACILITATOR_URL` configured, `GET /paid/risk-report` returns a real HTTP 402 on mainnet USDC (503 fail-closed until then) |
| Compliance screening (sanctions, KYC-adjacent) | TRM Labs listed as integration-ready in the ecosystem alignment | **Roadmap, not integrated** |
| Cross-chain RWA settlement | Circle CCTP/USDC | **Roadmap, not integrated** |
| L1 risk-root committer automation + DA serving | Write-side automation for the risk registry | **Roadmap**: the read/verify path is live |

## See it in two minutes

```bash
# Terminal demo: scenarios 11 and 12 are the RWA/Real-Fi scenarios
npx -y github:SZtch/safehands-pharos --demo
```

- **Scenario 11: Tokenized-asset transfer compliance.** An agent asks to approve spending of an *unregistered* asset token to an *unverified* spender. SafeHands returns `REQUIRE_CONFIRMATION` (risk `MEDIUM`); not a blind block, but mandatory human review: the transfer-restriction behavior regulated assets require.
- **Scenario 12: Real-Fi settlement cap.** An agent tries to settle a 5 USDC x402 invoice while the active policy caps settlement at 0.1 USDC per call. SafeHands returns `BLOCK` (risk `HIGH`). The cap is enforced by the deterministic policy engine; an LLM cannot be prompt-injected into raising it.

Or call it as an agent: the hosted SafeHands agent is being published to [Anvita Flow](https://flow.anvita.xyz/home) (Agent Carnival Phase 2); once live, it will be discoverable and callable by any Steward Agent. To hit the HTTP API directly, self-host the read-only reference backend locally (`npm run build && node dist/api/server.js`, default port `4022`), then:

```bash
# Verify an asset token before an agent touches it
curl -s -X POST http://localhost:4022/tools/token_registry_status \
  -H "content-type: application/json" \
  -d '{"tokenAddress":"0xc879c018db60520f4355c26ed1a6d572cdac1815"}'

# Query a counterparty's on-chain verified-safe track record
curl -s -X POST http://localhost:4022/tools/get_agent_reputation \
  -H "content-type: application/json" \
  -d '{"address":"0x6730d3a2A217108AB53CCFe60ffdAd05D3C124e5"}'
```

## The position in one diagram

```
      tokenized asset / real-world payment intent (AI agent)
                             │
                             ▼
        ┌─────────────────────────────────────────┐
        │  SafeHands deterministic policy engine  │
        │  asset legitimacy · transfer policy ·   │
        │  settlement caps · SSRF/x402 guards     │
        └───────────────────┬─────────────────────┘
                            │ decision (ALLOW / BLOCK / REQUIRE_CONFIRMATION / PREPARE_ONLY)
                            ▼
              user signs with their own wallet
                            │
                            ▼
        ┌─────────────────────────────────────────┐
        │  Pharos Pacific Mainnet (1672)          │
        │  SafeHandsAttestation → audit trail     │
        │  SafeHandsRegistry   → risk memory      │
        │  reputationOf()      → counterparty     │
        │                        trust, composable │
        └─────────────────────────────────────────┘
```

SafeHands never holds keys and never signs for users; in Real-Fi terms: it is the pre-execution checkpoint and audit layer, not a custodian.

## Honest scope

SafeHands is not an RWA issuance platform, a KYC provider, or a licensed transfer agent. It does not issue tokenized assets, does not custody or manage real-world assets, and does not by itself make a flow compliant: deterministic pre-execution checks are one necessary layer of a compliance story, not the whole stack. What it is: the **infrastructure those flows sit on**: deterministic pre-signature verdicts, opt-in on-chain audit records, composable risk and reputation reads, and safe stablecoin settlement rails, live on Pharos Pacific Mainnet today, with compliance-provider integrations (TRM, Circle CCTP) as explicit roadmap items.
