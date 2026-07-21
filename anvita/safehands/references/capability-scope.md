# SafeHands Capability Scope (hosted Anvita deployment)

SafeHands is a **zero-custody, read-only, pre-execution safety gateway**. This file is the authoritative boundary of what it may and may not do. Mode note: this hosted deployment issues verdicts only; in self-hosted integrations the same policy model can gate execution; that write path does not exist here.

## Allowed read-only data sources

| Source | Access | Config |
|---|---|---|
| Pharos Pacific Mainnet RPC (chainId 1672) | `eth_call`, `eth_get*`, `eth_gasPrice`, `eth_estimateGas` only | `assets/networks.json`, `PHAROS_RPC_URL` |
| Fallback Pharos RPC (availability only) | same read-only methods; used ONLY when the primary fails at transport level; every endpoint must pass the eth_chainId 1672 identity check before any read from it is reported, and failover is disclosed via `rpcNote` | built-in `https://pharos.drpc.org`, `PHAROS_RPC_FALLBACK_URL` (empty disables) |
| Chainlink Push Engine feeds | token prices via `eth_call` (`latestAnswer`/`latestTimestamp`) | `assets/supported-assets.json` |
| GoPlus public token-security API | keyless honeypot / tax / owner / malicious-address intel | built-in (`GOPLUS_API_BASE`) |
| Bundled registries | canonical contracts + official Pharos Token Registry; also power `resolve_alias` (name-to-address, exact match, no network call) and codehash recognition (keccak256 of verified bytecode, so a byte-identical copy at another address is recognized and a silent code change at a verified address is caught: recognition, never canonical trust) | `assets/known-pharos.json`, `assets/supported-protocols.json`, `assets/known-code.json` |
| Configured public providers | subgraph / indexer / pool, **only if public, verified, keyless, DNS-resolvable** | `assets/supported-protocols.json` |
| Registry-committed risk-batch file | the `query` command fetches the batch file at the `currentDataURI` the SafeHands registry owner committed on-chain; **https only**, 8 s timeout, response size capped. The fetched batch is then rebuilt into a Merkle tree and matched against the on-chain `currentMerkleRoot` before any record is shown: a batch that does not match is withheld entirely, so records are proven, never merely fetched | on-chain `SafeHandsRegistry.currentDataURI` + `currentMerkleRoot` |

## Forbidden

- **No writes of any kind**: never sign, broadcast, approve, swap, bridge, deposit, stake, pay x402, create/manage wallets, or publish records/attestations.
- **No arbitrary URL fetching.** Payment/campaign links are analyzed as strings, never retrieved. (There is no hosted x402 fetcher.) The single non-RPC, non-provider fetch is the registry-committed dataURI batch listed above: an https URL the registry owner committed on-chain, not caller input.
- **No secrets, ever**: no private keys, seed phrases, mnemonics, signatures, API keys, pass-keys, auth headers, or cookies, on input or to any provider.
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

To enable one, set a public, verified, keyless `https` endpoint in `assets/supported-protocols.json`. Until then the command returns a structured `*_NOT_CONFIGURED` error; it never invents data.

## Error-code contract

Every failure is structured JSON: `{success:false, error:{code,message}, provider?, providerStatus?, reason?, safeFallback?}`.

| Situation | Code |
|---|---|
| Bad/missing input field | `VALIDATION_ERROR` |
| Non-1672 chain | `CHAIN_NOT_SUPPORTED` |
| Key-like material in input | `KEY_MATERIAL_REJECTED` |
| Name/alias not in the bundled registry | `UNKNOWN_ALIAS` |
| Non-ASCII (lookalike) characters in an alias | `ALIAS_CHARSET_REJECTED` |
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
- **Unlimited approval or blanket operator grant (`setApprovalForAll`) to an unknown counterparty → block.** "Known" means canonical Pharos infrastructure, registry-VERIFIED protocol contracts (own-docs citation + on-chain check, e.g. Morpho Blue), or the Permit2 singleton; this is policy, not breakage: an UNVERIFIED ecosystem protocol (FaroSwap included) is an unknown counterparty until its addresses are verified in the registry.
- **Transfer/payment recipient on the operator denylist → block.** The denylist is operator-supplied via `SAFEHANDS_RECIPIENT_DENYLIST` (comma-separated 0x addresses, local config) and **empty by default**; SafeHands never ships a fabricated scam list.
- **Unrecognized or malformed calldata → held** (warn floor), never decoded-as-safe.
