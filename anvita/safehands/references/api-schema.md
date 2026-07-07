# SafeHands Engine — I/O Schema (fully hosted)

Single entrypoint: `node scripts/safehands-engine.js <command> ['<arg>']`. All outputs are one JSON object on stdout.

## health
In: none. Out (success):
```json
{ "success": true, "ok": true, "service": "safehands", "mode": "fully-hosted",
  "status": "healthy", "chainId": 1672, "blockNumber": 123456, "rpc": "https://rpc.pharos.xyz",
  "registryConfigured": false, "attestationConfigured": false, "timestamp": "…" }
```

## analyze '<json>'
In (one of):
```json
{ "subjectType": "wallet",   "address": "0x…40hex" }
{ "subjectType": "contract", "address": "0x…40hex" }
{ "subjectType": "intent", "action": "transfer", "toAddress": "0x…", "amount": "1.5", "walletAddress": "0x…" }
{ "subjectType": "intent", "action": "swap", "tokenIn": "0x…", "tokenOut": "0x…", "walletAddress": "0x…" }
```
Out (success):
```json
{ "success": true, "riskScore": 45, "recommendation": "warn", "riskLevel": "medium",
  "riskFactors": ["…"], "explanation": "…", "nextAction": "…",
  "analysisDepth": "hosted-heuristic (on-chain reads only — not the full SafeHands analyzer suite)",
  "subject": { "type": "wallet", "address": "0x…" },
  "onChain": { "balanceWei": "0", "txCount": 0, "isContract": false },
  "intel": "on-chain + GoPlus threat intelligence | on-chain only (GoPlus unreachable)",
  "explorer": "https://www.pharosscan.xyz/address/0x…  (verify the subject yourself)",
  "components": { "recipient|tokenIn|tokenOut": "sub-report (intent only)" },
  "network": "pacific-mainnet", "chainId": 1672, "timestamp": "…" }
```
Bands: allow ≤ 30 < warn < 70 ≤ block. Levels: low ≤30, medium ≤60, high ≤85, critical >85.

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
If `assets/safehands/contracts.json` addresses are empty, `registry.configured`/`reputation.configured` are false and a top-level `note` explains — analysis features are unaffected.

## Failure envelope (all commands)
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR|CHAIN_NOT_SUPPORTED|CHAIN_MISMATCH|KEY_MATERIAL_REJECTED|PHAROS_RPC_UNAVAILABLE|RPC_TIMEOUT|ENGINE_ERROR|USAGE",
  "message": "…" }, "retryable": true, "chainId": 1672, "timestamp": "…" }
```
`retryable:true` appears only on RPC availability/timeout errors.

## Not part of this deployment
Publishing risk records/attestations (operator backend write path), tx-hash deep analysis, honeypot sell-simulation. The engine performs read-only `eth_call`/`eth_get*` exclusively and never handles key material.
