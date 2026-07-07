# Pharos Ecosystem Evidence — Classifier & Decision Impact (Phase 5D)

> How SafeHands turns ecosystem **awareness** (the registry in
> [`PHAROS_ECOSYSTEM_INTEGRATIONS.md`](./PHAROS_ECOSYSTEM_INTEGRATIONS.md)) into a
> per-request **evidence object** and an **escalate-only** decision impact.
>
> Implementation: `src/lib/pharos/ecosystemEvidence.ts`. Pure and deterministic —
> **no RPC, no keys, no external API calls.**

---

## 1. The evidence object

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
  safehandsBehavior: string;              // honest behavior — never an integration claim
  recommendedDecisionImpact: "REQUIRE_CONFIRMATION" | "none";  // escalate-only hint
  network: NetworkName | null;
  chainId: number | null;
  address: string | null;
}
```

## 2. Classification priority

1. **Known official address** (e.g. the Chainlink price-feed cache) → `confidence: high`.
2. **Recognized canonical contract** (Safe/SafeL2, Phase 5B) → wallet infrastructure, `high`.
3. **Provider name / alias hint** (e.g. `"LayerZero"`, `"cctp"`) → `medium`.
4. **Category hint** (e.g. `ecosystemCategory: "cross_chain"`) → `low`.
5. **Nothing recognized** → `category: unknown`, `status: not_implemented`, impact `none`.

## 3. Decision impact (escalate-only)

`applyEcosystemEscalation(decision, evidence)` returns the **more severe** of the
current decision and the evidence's recommended impact. It **never** downgrades.

| Category | Recommended impact | Rationale |
|----------|--------------------|-----------|
| `cross_chain` | **REQUIRE_CONFIRMATION** | Bridge/relayer/finality trust — cross-chain & unknown bridge-like intents require confirmation unless explicitly trusted. |
| `evm_wasm_interop` | **REQUIRE_CONFIRMATION** | WASM↔EVM interop can bypass EVM-only assumptions; experimental, no analyzer. |
| `oracle` | none | Evidence only — no direct oracle analyzer; price-dependency is explained, not auto-escalated. |
| `indexing` | none | Optional read-only data source; not an execution path. |
| `wallet_infrastructure` | none | Pre-sign awareness; SafeHands holds no keys. |
| `custody_infrastructure` | none | External custody awareness; SafeHands holds no keys. |
| `payment` | none | Routed to the existing x402 preflight analyzer (its own policy applies). |
| `rpc_provider` | none | Read-only RPC infra; secrets redacted. |
| `unknown` | none | Base analyzers + policy still fully govern the decision. |

> **Unknown ecosystem contracts that affect execution risk** are already handled by the
> existing intent/policy path (`unknown_contract_call` → `REQUIRE_CONFIRMATION`); the
> ecosystem layer adds explanation, never relaxation.

## 4. The critical invariants (proven by tests)

- **Ecosystem evidence does not make risky actions safe.** A known token/canonical/oracle
  contract does **not** relax any existing risk rule.
- **A BLOCK stays a BLOCK.** Escalation only raises severity; `applyEcosystemEscalation`
  on a `BLOCK` returns `BLOCK` for any evidence.
- **Unlimited approval → unknown spender remains BLOCK** even with a bridge-like provider
  hint (see the 5D smoke test "unlimited→unknown spender stays BLOCK").
- **No external calls / no secrets.** Classification is offline; evidence is secret-free
  (only a redacted RPC provider name is ever surfaced).
- **readOnly = true, executionAvailable = false** are preserved on every response.

## 5. Where it surfaces

- `POST /guardian/check` — `ecosystemEvidence` + escalate-only impact on the aggregate decision.
- `POST /analyze/tx | /analyze/contract | /analyze/approval | /analyze/safe | /analyze/x402` — `ecosystemEvidence`.
- `POST /agent/check`, `POST /agent/a2a/check` — `evidence.ecosystemEvidence` (via the decision formatter).
- `GET /infra/status`, `GET /public-config` — `ecosystem` registry summary (counts only, secret-free).

Alongside the existing `analyzer`, `pharosEvidence`/`rpcEvidence`, `gasEvidence`, and
`tokenRegistry` evidence — additive, no response shape removed.

