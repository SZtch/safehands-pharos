# Pharos Ecosystem Evidence: Awareness Registry, Classifier & Decision Impact

> **Awareness, not integration.** SafeHands is *ecosystem-aware*: it recognizes Pharos
> ecosystem providers and uses that recognition as **evidence** to explain risk. The
> awareness registry below does **not** mean SafeHands integrates with, calls, holds
> keys for, or settles through a provider. Implementation:
> `src/lib/pharos/ecosystem.ts` (registry) + `src/lib/pharos/ecosystemEvidence.ts`
> (classifier). Pure and deterministic: **no RPC, no keys, no external API calls** in
> this subsystem.
>
> *(This document consolidates the former `PHAROS_ECOSYSTEM_INTEGRATIONS.md`.)*
>
> **Product-level status vs subsystem status.** The registry rows mirror the awareness
> subsystem. Three capabilities have since shipped **elsewhere in the product** and are
> NOT captured by the rows below: live Chainlink Push price reads (`get_token_price`
> via `eth_call`; `src/lib/price/priceResolver.ts`), SPV/Merkle inclusion verification
> (`verify_risk_inclusion`, `spvVerifier.ts`), and opt-in self-hosted x402 mainnet USDC
> settlement (`/paid/*`; hosted mode still never pays). The ecosystem-awareness rows
> remain accurate for what *this subsystem* does: recognition-as-evidence only.

---

## 1. Hard boundary (applies to every entry)

- SafeHands is **ecosystem-aware, not directly integrated**.
- Ecosystem evidence is **additive and escalate-only**. It may *raise* a decision
  (cross-chain / WASM-interop → `REQUIRE_CONFIRMATION`) but it can **never** relax one,
  bypass policy, or make a risky action safe. An unlimited approval to an unknown
  spender stays **BLOCK** regardless of any ecosystem hint.
- SafeHands **does not custody keys**, never creates/imports/exports/manages private
  keys, and does **not sign or send** in hosted/read-only mode.
- The awareness subsystem calls **no** external ecosystem API and requires **no**
  Chainlink / Goldsky / LayerZero / CCTP / LI.FI / Jumper API keys.

---

## 2. Awareness registry

> Status legend: **implemented** · **experimental** · **roadmap** · **to_verify** ·
> **not_implemented**: statuses describe the awareness subsystem (see the
> product-level note above). **No contract address is invented**: only official
> addresses are listed.

| Provider | Category | Status | Source | SafeHands behavior |
|----------|----------|--------|--------|--------------------|
| Chainlink Price Feeds (CRE) | oracle | roadmap *(subsystem)* | official_docs | Recognize the Pharos-native price-feed cache by official address; **evidence only** in this subsystem. *(Product level: live Chainlink Push price reads shipped in `get_token_price`.)* |
| Chainlink CCIP | cross_chain | roadmap | official_docs | Bridge-like → `REQUIRE_CONFIRMATION` unless trusted. No CCIP call. |
| Circle CCTP | cross_chain | roadmap | official_docs | Bridge-like → `REQUIRE_CONFIRMATION` unless trusted. No CCTP call. |
| LayerZero | cross_chain | roadmap | official_docs | Bridge-like → `REQUIRE_CONFIRMATION` unless trusted. No LayerZero call. |
| **LI.FI** | cross_chain | **to_verify** | **to_verify** | **Not named** on the official Pharos cross-chain page. Treated as a generic cross-chain intent → `REQUIRE_CONFIRMATION`. **No integration.** |
| **Jumper** | cross_chain | **to_verify** | **to_verify** | **Not named** officially. Generic cross-chain intent → `REQUIRE_CONFIRMATION`. **No integration.** |
| Goldsky | indexing | roadmap | official_docs | Optional future read-only data source (Subgraphs/Mirror). **No live indexing; no API key.** |
| Safe (Safe MultiSig) | wallet_infrastructure | experimental | official_docs | Recognize canonical Safe/SafeL2 + decode Safe/MultiSend (experimental). **Holds no keys, never co-signs, never custodies.** |
| Fordefi | custody_infrastructure | roadmap | official_docs | External MPC-custody **awareness only**. SafeHands holds no keys. |
| Dora VM (EVM ↔ WASM interop) | evm_wasm_interop | experimental | official_docs | EVM analysis is implemented; EVM↔WASM interop is experimental. WASM-interop intent → `REQUIRE_CONFIRMATION`. **No WASM analyzer.** |
| x402 payments | payment | implemented | official_docs | Route to the existing x402 preflight analyzer. Hosted mode **never signs/settles**. *(Product level: mainnet USDC settlement exists as an opt-in self-hosted `/paid/*` path.)* |
| ZAN RPC | rpc_provider | implemented | official_docs | Optional read-only RPC provider. Env-only; URL/key never exposed (redacted name only). |
| Public Pharos RPC | rpc_provider | implemented | official_docs | Default hosted read-only RPC; read methods only. No keys. |

### Official addresses (none invented)

| Provider | Network | chainId | Address |
|----------|---------|---------|---------|
| Chainlink price-feed cache | pacific-mainnet | 1672 | `0xc71f7d98d3d9a000Fdfe307fBdb9d94AbD56424B` |
| Chainlink price-feed cache | atlantic-testnet | 688689 | `0x5456fD07A1622d33969f833d52aA5AD2c68C3Fa2` |

*(Ecosystem dApp protocol addresses, e.g. the registry-VERIFIED Morpho deployments,
live in the canonical ecosystem registry, `src/data/ecosystemRegistry.data.ts`, which
is the single source of truth for address-level trust.)*

---

## 3. The evidence object

`ecosystemEvidenceForRequest(req)` / `classifyEcosystem(input)` returns:

```ts
interface EcosystemEvidence {
  category: EcosystemCategory;            // oracle | cross_chain | indexing | wallet_infrastructure
                                          // | custody_infrastructure | evm_wasm_interop | payment
                                          // | rpc_provider | unknown
  providerName: string | null;
  status: EcosystemStatus;                // implemented | experimental | roadmap | to_verify | not_implemented
  confidence: "high" | "medium" | "low";
  source: EvidenceSource;                 // official_docs | existing_registry | to_verify
  officialDocsUrl: string | null;
  riskRelevance: string;
  safehandsBehavior: string;              // honest behavior; never an integration claim
  recommendedDecisionImpact: "REQUIRE_CONFIRMATION" | "none";  // escalate-only hint
  network: NetworkName | null;
  chainId: number | null;
  address: string | null;
}
```

## 4. Classification priority

1. **Known official address** (e.g. the Chainlink price-feed cache) → `confidence: high`.
2. **Recognized canonical contract** (Safe/SafeL2) → wallet infrastructure, `high`.
3. **Provider name / alias hint** (e.g. `"LayerZero"`, `"cctp"`) → `medium`.
4. **Category hint** (e.g. `ecosystemCategory: "cross_chain"`) → `low`.
5. **Nothing recognized** → `category: unknown`, `status: not_implemented`, impact `none`.

## 5. Decision impact (escalate-only)

`applyEcosystemEscalation(decision, evidence)` returns the **more severe** of the
current decision and the evidence's recommended impact. It **never** downgrades.

| Category | Recommended impact | Rationale |
|----------|--------------------|-----------|
| `cross_chain` | **REQUIRE_CONFIRMATION** | Bridge/relayer/finality trust: cross-chain & unknown bridge-like intents require confirmation unless explicitly trusted. |
| `evm_wasm_interop` | **REQUIRE_CONFIRMATION** | WASM↔EVM interop can bypass EVM-only assumptions; experimental, no analyzer. |
| `oracle` | none | Evidence only: no direct oracle analyzer; price-dependency is explained, not auto-escalated. |
| `indexing` | none | Optional read-only data source; not an execution path. |
| `wallet_infrastructure` | none | Pre-sign awareness; SafeHands holds no keys. |
| `custody_infrastructure` | none | External custody awareness; SafeHands holds no keys. |
| `payment` | none | Routed to the existing x402 preflight analyzer (its own policy applies). |
| `rpc_provider` | none | Read-only RPC infra; secrets redacted. |
| `unknown` | none | Base analyzers + policy still fully govern the decision. |

> **Unknown ecosystem contracts that affect execution risk** are already handled by the
> existing intent/policy path (`unknown_contract_call` → `REQUIRE_CONFIRMATION`); the
> ecosystem layer adds explanation, never relaxation.

## 6. The critical invariants (proven by tests)

- **Ecosystem evidence does not make risky actions safe.** A known token/canonical/oracle
  contract does **not** relax any existing risk rule.
- **A BLOCK stays a BLOCK.** Escalation only raises severity; `applyEcosystemEscalation`
  on a `BLOCK` returns `BLOCK` for any evidence; pinned by
  `test/truth-model.test.ts` ("a hard BLOCK is NEVER downgraded by ecosystem evidence").
- **Unlimited approval → unknown spender remains BLOCK** even with a bridge-like provider
  hint (the unlimited-approval hard fail in `test/action-policy.test.ts` combined with the
  escalate-only rule above).
- **No external calls / no secrets.** Classification is offline; evidence is secret-free
  (only a redacted RPC provider name is ever surfaced).
- **readOnly = true, executionAvailable = false** are preserved on every response.

## 7. Where it surfaces

- `POST /guardian/check`: `ecosystemEvidence` + escalate-only impact on the aggregate decision.
- `POST /analyze/tx | /analyze/contract | /analyze/approval | /analyze/safe | /analyze/x402`: `ecosystemEvidence`.
- `POST /agent/check`, `POST /agent/a2a/check`: `evidence.ecosystemEvidence` (via the decision formatter).
- `GET /infra/status`, `GET /public-config`: `ecosystem` registry summary (counts only, secret-free).

Alongside the existing `analyzer`, `pharosEvidence`/`rpcEvidence`, `gasEvidence`, and
`tokenRegistry` evidence; additive, no response shape removed.
