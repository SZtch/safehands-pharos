# SafeHands Capability Scope (hosted Anvita deployment)

SafeHands is a **zero-custody, read-only, pre-execution safety gateway**. This file is the authoritative boundary of what it may and may not do. Mode note: this hosted deployment issues verdicts only; in self-hosted integrations the same policy model can gate execution — that write path does not exist here.

## Allowed read-only data sources

| Source | Access | Config |
|---|---|---|
| Pharos Pacific Mainnet RPC (chainId 1672) | `eth_call`, `eth_get*`, `eth_gasPrice`, `eth_estimateGas` only | `assets/networks.json`, `PHAROS_RPC_URL` |
| Chainlink Push Engine feeds | token prices via `eth_call` (`latestAnswer`/`latestTimestamp`) | `assets/supported-assets.json` |
| GoPlus public token-security API | keyless honeypot / tax / owner / malicious-address intel | built-in (`GOPLUS_API_BASE`) |
| Bundled registries | canonical contracts + official Pharos Token Registry | `assets/known-pharos.json` |
| Configured public providers | subgraph / indexer / pool — **only if public, verified, keyless, DNS-resolvable** | `assets/supported-protocols.json` |

## Forbidden

- **No writes of any kind**: never sign, broadcast, approve, swap, bridge, deposit, stake, pay x402, create/manage wallets, or publish records/attestations.
- **No arbitrary URL fetching.** Payment/campaign links are analyzed as strings, never retrieved. (There is no hosted x402 fetcher.)
- **No secrets, ever**: no private keys, seed phrases, mnemonics, signatures, API keys, pass-keys, auth headers, or cookies — on input or to any provider.
- **No keyed/quote APIs**: no DODO API keys; no FaroSwap pass-keys or internal frontend endpoints; no GraphQL hosts that don't resolve over public DNS.
- **No scraping** of explorers or websites.
- **No DEX/pool quote as canonical price.** Canonical pricing is Chainlink Push feeds only; pool/route data is liquidity context.
- **Mainnet-locked**: only chainId 1672; every other chain is refused.

## Provider matrix (today)

| Command | Provider | Status | Error when unset |
|---|---|---|---|
| `query_goldsky_subgraph` | Goldsky subgraph | `not_configured` | `GOLDSKY_NOT_CONFIGURED` |
| `get_execution_history` | execution-history indexer | `not_configured` | `HISTORY_PROVIDER_NOT_CONFIGURED` |
| `get_pool_info` | pool-info provider | `not_configured` | `PROVIDER_NOT_CONFIGURED` |
| vault status (yield/vault intents) | vault-status provider | `not_configured` | fields reported unavailable (never invented) |

To enable one, set a public, verified, keyless `https` endpoint in `assets/supported-protocols.json`. Until then the command returns a structured `*_NOT_CONFIGURED` error — it never invents data.

## Error-code contract

Every failure is structured JSON: `{success:false, error:{code,message}, provider?, providerStatus?, reason?, safeFallback?}`.

| Situation | Code |
|---|---|
| Bad/missing input field | `VALIDATION_ERROR` |
| Non-1672 chain | `CHAIN_NOT_SUPPORTED` |
| Key-like material in input | `KEY_MATERIAL_REJECTED` |
| Symbol has no feed | `FEED_NOT_CONFIGURED` |
| Feed heartbeat violated | `FEED_STALE` |
| Feed/provider reachable but unusable | `PROVIDER_UNAVAILABLE` |
| RPC method absent (e.g. `eth_getProof`) | `NOT_SUPPORTED` |
| Provider endpoint unset | `*_NOT_CONFIGURED` |
| Gas estimate reverts | `ESTIMATE_FAILED` |
| Simulation reverts | `SIMULATION_REVERTED` |
| RPC outage / timeout | `PHAROS_RPC_UNAVAILABLE` / `RPC_TIMEOUT` |

## Fail-closed defaults

- Unknown or unverified target contract → warn or block, never allow.
- Missing threat intel (GoPlus unreachable / token unindexed / schema drift) → score floored out of the allow band.
- Missing evidence → reported in `missingInputs`, never silently assumed safe.
- Stale price feed → reported stale; last answer is never quoted as current.
- **Unlimited approval or blanket operator grant (`setApprovalForAll`) to an unknown counterparty → block.** "Known" means canonical Pharos infrastructure, registry-VERIFIED protocol contracts (own-docs citation + on-chain check, e.g. Morpho Blue), or the Permit2 singleton — this is policy, not breakage: an UNVERIFIED ecosystem protocol (FaroSwap included) is an unknown counterparty until its addresses are verified in the registry.
- **Transfer/payment recipient on the operator denylist → block.** The denylist is operator-supplied via `SAFEHANDS_RECIPIENT_DENYLIST` (comma-separated 0x addresses, local config) and **empty by default** — SafeHands never ships a fabricated scam list.
- **Unrecognized or malformed calldata → held** (warn floor), never decoded-as-safe.
