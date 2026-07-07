> [!NOTE]
> Pharos Pacific Mainnet (chain `1672`) is the default and live network. Any Atlantic Testnet (`688689`) references below are legacy/secondary context.

# SafeHands × Pharos — Implemented vs Roadmap (Phase 5D)

> A single honest separation of what SafeHands **actually does** (code + tests) from
> what it is merely **aware of**. The guiding rule: `implemented` requires code **and**
> tests; everything else is `experimental` / `roadmap` / `to_verify` / `not_implemented`.
>
> Sources: [`PHAROS_IMPLEMENTATION_MAP.md`](./PHAROS_IMPLEMENTATION_MAP.md),
> [`PHAROS_ECOSYSTEM_INTEGRATIONS.md`](../PHAROS_ECOSYSTEM_INTEGRATIONS.md).

---

## ✅ Implemented (code + tests)

- **4-decision SafeHands contract** — ALLOW / BLOCK / REQUIRE_CONFIRMATION / PREPARE_ONLY.
- **Mainnet-first network registry** — Pacific Mainnet (1672) default; Atlantic (688689) supported; `executionAllowed:false`.
- **Read-only analyzers** — EVM call, tx-hash, contract intelligence (canonical recognition), ERC-20 approval, Safe/MultiSend decode (experimental), x402 preflight.
- **Pacific Mainnet token registry + canonical-contract recognition** (Phase 5B).
- **Read-only RPC alignment** (Phase 5C) — method matrix, fail-closed adapter, `rpcEvidence` / `gasEvidence`; `eth_sendRawTransaction` blocked in hosted mode.
- **Read-only HTTP API + SafeHands Agent + A2A** — secret-free, `readOnly:true`, `executionAvailable:false`.
- **Ecosystem-aware evidence layer** (Phase 5D) — registry + classifier + escalate-only impact.
- **Honest capability flags** (Phase 5E) — `getCapabilityFlags()` on `/infra/status` + `/public-config` (live read/check/analyze = `true`; write/sign/custody = `false`); deploy-ready server (`0.0.0.0` + `PORT`).
- **x402 preflight** — analysis only (testnet-only; never signs/settles).
- **ZAN + Public Pharos RPC** — optional/default read-only providers (env-only, secrets redacted).

## 🧪 Experimental

- **Safe / MultiSend decode** — canonical Safe/SafeL2 recognition + batch decode; pre-sign verdicts only, **no keys**.
- **EVM ↔ WASM interop (Dora VM)** — recognized + escalated (`REQUIRE_CONFIRMATION`); **no WASM analyzer**. Mainnet TO_VERIFY.
- **`eth_getProof` capability** — exposed as experimental read-only capability; **SPV verification not implemented**.

## 🛣️ Roadmap (awareness only — NOT integrated)

- **Chainlink Price Feeds (CRE)** — oracle awareness by official address; **no Chainlink call, no oracle analyzer**.
- **Chainlink CCIP / Circle CCTP / LayerZero** — cross-chain awareness; bridge-like → `REQUIRE_CONFIRMATION`; **no provider call**.
- **Goldsky indexing** — optional future read-only data source; **no live indexing, no API key**.
- **Fordefi** — external MPC-custody awareness; SafeHands holds **no keys**.

## ❓ To-verify

- **LI.FI** and **Jumper** — **not named** on the official Pharos cross-chain page (Phase 5A); treated as generic cross-chain intents (`REQUIRE_CONFIRMATION`). Not listed as integrations.
- **Mainnet WASM interop** and a few exact official doc paths remain to verify.

## ⛔ Not implemented / out of scope (hard rules)

- ❌ Transaction **execution**, **signing**, **managed wallets**, **private-key handling**.
- ❌ **Web UI / SDK / CLI**.
- ❌ Calling external ecosystem APIs by default; requiring Chainlink/Goldsky/LayerZero/CCTP/LI.FI/Jumper API keys.
- ❌ Any claim of a **live direct ecosystem integration** not proven by code + tests.

---

### One-line summary

> SafeHands is a **read-only, mainnet-first SafeHands** that is **ecosystem-aware, not
> directly integrated**. Ecosystem evidence explains risk and may only **escalate** a
> decision — it never bypasses policy, never custodies keys, and never signs or sends.

