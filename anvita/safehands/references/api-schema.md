# SafeHands Engine: I/O Schema (fully hosted)

Single entrypoint: `node scripts/safehands-engine.js <command> ['<arg>']`. All outputs are one JSON object on stdout.

Cross-command fields:
- `rpcNote` (any command): present only when the primary RPC failed at transport level and the read was served by the chain-identity-verified fallback endpoint; failover is always disclosed, never silent.
- `verdictBinding` (intent analyze, estimate_gas, simulate_transaction): `{ boundTo:"calldata"|"intent", digest, algorithm:"keccak256", preimageFormat, issuedAt, expiresAt, note }`. The digest covers exactly what was analyzed (documented UTF-8 preimage `SafeHandsVerdict:v1:…`), so acting on different bytes, or after `expiresAt`, means the verdict no longer applies. Recompute it to detect drift between what was checked and what is being signed.

## health
In: none. Out (success):
```json
{ "success": true, "ok": true, "service": "safehands", "mode": "fully-hosted",
  "status": "healthy", "chainId": 1672, "blockNumber": 123456, "rpc": "https://rpc.pharos.xyz",
  "rpcPrimary": "https://rpc.pharos.xyz", "rpcFallbackConfigured": true,
  "registryConfigured": false, "attestationConfigured": false, "timestamp": "…" }
```

## analyze '<json>'
In (one of):
```json
{ "subjectType": "wallet",   "address": "0x…40hex" }
{ "subjectType": "contract", "address": "0x…40hex" }
{ "subjectType": "vault",    "address": "0x…40hex" }   // ERC-4626 surface; onChain.vault + components.underlyingAsset
{ "subjectType": "pool",     "address": "0x…40hex" }   // v2 pair / DODO machine; onChain.pool + components per token
{ "subjectType": "intent", "action": "transfer", "toAddress": "0x…", "amount": "1.5", "walletAddress": "0x…" }
{ "subjectType": "intent", "action": "swap", "tokenIn": "0x…", "tokenOut": "0x…", "walletAddress": "0x…" }
```
`transfer` and `swap` intents also accept an optional tx object (`to`, `data`): when `data` is full calldata hex, the engine runs the same offline approval/transfer/admin decode as every other intent (unlimited-approval and drainer detection, escalate-only floor), so an unlimited approve carried on a swap is caught exactly as on any other action. transfer/swap skip the read-only eth_call simulation (they already probe the recipient / tokenIn / tokenOut); the decode itself needs no RPC.
RealFi intent actions (`bridge`, `yield_deposit`, `vault_deposit`, `staking`, `tokenized_asset`, `fiat_ramp`, `reward_campaign`, `x402_payment`) share the intent shape and add per-action fields (target contract key, `url`, `payTo`, optional tx object). Their output adds `evidenceUsed[]`, `missingInputs[]`, `intentNotes[]`, and, for vault/yield, `vaultRiskScore` + `vaultProviderData`. Full spec: `references/realfi-intents.md`.
Out (success):
```json
{ "success": true, "riskScore": 45, "recommendation": "warn", "riskLevel": "medium",
  "riskFactors": ["…"], "explanation": "…", "nextAction": "…",
  "analysisDepth": "hosted-heuristic (on-chain reads + offline calldata decode; not the full SafeHands analyzer suite)",
  "subject": { "type": "wallet", "address": "0x…" },
  "onChain": { "balanceWei": "0", "txCount": 0, "isContract": false,
               "codeHash": "(contract analysis) keccak256 of the deployed bytecode",
               "codeRecognizedAs": "(contract analysis) { label, protocol } when the bytecode is byte-identical to a registry-verified contract at another address: recognition, NOT canonical trust",
               "codeHashMatchesRegistry": "(registry-verified addresses only) false = live code no longer matches the code verified at registration (silent-change guard, fails closed)",
               "proxy": "(contract analysis only) { isProxy, implementation?, implementationHasCode?, implementationLabel?, implementationCodeMatch?, admin?, beacon? } from direct EIP-1967 slot reads; implementationCodeMatch names a verified contract when the impl bytecode is recognized; isProxy:null when the storage reads failed" },
  "intel": "on-chain + GoPlus threat intelligence | on-chain only (GoPlus unreachable)",
  "explorer": "https://www.pharosscan.xyz/address/0x…  (verify the subject yourself)",
  "components": { "recipient|tokenIn|tokenOut|calldata": "sub-report (intent only)" },
  "network": "pacific-mainnet", "chainId": 1672, "timestamp": "…" }
```
Bands: allow ≤ 30 < warn < 70 ≤ block. Levels: low ≤30, medium ≤60, high ≤85, critical >85.

`components.calldata` (tx-carrying intents; offline decode, escalate-only floors):
```json
{ "decoded": true, "method": "approve", "category": "approval|transfer|admin|batch|unknown",
  "selector": "0x095ea7b3", "token": "0x…?", "spender": "0x…?", "operator": "0x…?",
  "recipient": "0x…?", "from": "0x…?", "amountRaw": "…?", "unlimited": false, "isRevoke": false,
  "approved": null, "counterpartyKnown": false, "counterpartyLabel": null,
  "recipientDenylisted": false, "dangerous": false, "factors": ["…"], "floor": 0, "notes": ["…"] }
```
Recognized selectors: approve, permit (ERC-2612), Permit2 approve, setApprovalForAll, transfer, transferFrom, increase/decreaseAllowance, transferOwnership, renounceOwnership, upgradeTo(AndCall), changeAdmin, MultiSend, Safe execTransaction. The recipient denylist is operator-supplied via `SAFEHANDS_RECIPIENT_DENYLIST` (empty by default, never a shipped list).

## query '<0xaddress>'
Out (success):
```json
{ "success": true, "subject": "0x…",
  "registry": { "configured": true, "contractAddress": "0x…", "currentMerkleRoot": "0x…",
                "hasCommittedRoot": true, "currentDataURI": "https://…", "isAuthorizedAgent": false },
  "records": [ { "target": "0x…", "riskScore": 72, "riskLevel": "high",
                 "recommendation": "warn", "expiresAt": "…", "expired": false } ],
  "recordsSource": "dataURI|dataURI-unreachable|null",
  "reputation": { "configured": true, "verifiedActionCount": 3, "lastVerifiedActionAt": 1710000000,
                  "interpretation": "…" },
  "network": "pacific-mainnet", "chainId": 1672, "timestamp": "…" }
```
If `assets/contracts.json` addresses are empty, `registry.configured`/`reputation.configured` are false and a top-level `note` explains; analysis features are unaffected.

## Market & network read commands
```text
get_gas_price                    → { wei, gwei, source }
get_token_price <symbol|json>    → { price, pair, symbol, aliased, aliasNote?, feedAddress, feedDecimals,
                                     answerRaw, updatedAt, feedAgeSeconds, heartbeatSeconds, stale, sourceStatus }
get_token_balance {address,token?}  → { address, token:"native"|0x…, tokenSymbol?, tokenDecimals?,
                                     balanceRaw, balanceFormatted? }
                                   (token = 0x address, bundled symbol, or PROS/pharos for native;
                                    unresolvable name → UNKNOWN_ALIAS; no data → TOKEN_READ_FAILED,
                                    balance reported UNKNOWN, never zero)
get_portfolio {address}             → { assets[{symbol,address,balanceRaw,balanceFormatted,priceUsd,valueUsd,stale?,note?}],
                                     totals:{priceableUsd,unpriceableCount}, valuation, limits }
                                   (canonical assets only; unpriceable assets disclosed and excluded
                                    from the total, never guessed)
check_allowance {token,owner,spender}
                                 → { allowanceRaw, allowanceFormatted?, tokenSymbol?, tokenDecimals?,
                                     approvalRisk:"none|scoped|unlimited", approvalRiskHint }
get_active_approvals {address}   → { summary:{activeApprovals,unlimited,pairsChecked,readFailures},
                                     approvals[{token,tokenSymbol,spender,spenderLabel,protocol,
                                     allowanceRaw,allowanceFormatted,unlimited,note}], scope, limits, nextAction }
                                   (live allowance() sweep: canonical tokens x registry-verified
                                    protocol contracts; spenders outside the registry are disclosed
                                    as uncheckable, never assumed clean; all-reads-failed → UNKNOWN)
get_transaction_status <txhash>  → { status:"pending|success|failed|not_found", blockNumber?, gasUsed?, from?, to?, explorer }
estimate_gas {from?,to,data?,value?|valueWei?}
                                 → { estimatedGas, estimatedGasHex, calldata?, verdictBinding, broadcast:false }
simulate_transaction {…tx…}      → { reverted:false, returnData, calldata?, verdictBinding, broadcast:false }
get_spv_proof {address,storageKeys?,blockTag?}
                                 → { proof, blockTag, storageKeys }
query_goldsky_subgraph {query,variables?}   → { provider, endpoint, data }   (gated)
get_execution_history {address,limit?}      → { provider, endpoint, data }   (gated)
get_pool_info {poolAddress?,tokenA?,tokenB?} → { provider, endpoint, data }   (gated)
resolve_alias {alias}            → { query, normalized, ambiguous, matches[], rule }
                                   (registry-only exact match, no network; UNKNOWN_ALIAS /
                                    ALIAS_CHARSET_REJECTED on failure)
```
Symbols/aliases and the feed-staleness rule: see `references/safehands.md` §G. Gated commands return `*_NOT_CONFIGURED` until an endpoint is set in `assets/supported-protocols.json`.

## Failure envelope (all commands)
```json
{ "success": false,
  "error": { "code": "VALIDATION_ERROR|CHAIN_NOT_SUPPORTED|CHAIN_MISMATCH|KEY_MATERIAL_REJECTED|FEED_NOT_CONFIGURED|FEED_STALE|PROVIDER_UNAVAILABLE|NOT_SUPPORTED|ESTIMATE_FAILED|SIMULATION_REVERTED|GOLDSKY_NOT_CONFIGURED|HISTORY_PROVIDER_NOT_CONFIGURED|PROVIDER_NOT_CONFIGURED|UNKNOWN_ALIAS|ALIAS_CHARSET_REJECTED|PHAROS_RPC_UNAVAILABLE|RPC_TIMEOUT|ENGINE_ERROR|USAGE",
    "message": "…" },
  "provider": "…?", "providerStatus": "not_configured?", "reason": "…?", "safeFallback": "…?",
  "retryable": true, "chainId": 1672, "timestamp": "…" }
```
`retryable:true` appears only on RPC availability/timeout errors. `provider`/`providerStatus`/`reason`/`safeFallback` appear on provider/feed failures. No failure ever carries fabricated data.

## Not part of this deployment
Publishing risk records/attestations (operator backend write path), tx-hash deep analysis, honeypot sell-simulation, and any signing/execution/bridging/deposit/staking/payment. The engine performs read-only `eth_call`/`eth_get*`/`eth_gasPrice`/`eth_estimateGas` exclusively and never handles key material. Arbitrary URLs are never fetched; provider endpoints are keyless or absent.
