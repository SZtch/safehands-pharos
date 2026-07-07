# SafeHands Engine — Operations Manual (AI instruction manual)

All operations run the bundled zero-dependency engine (Node ≥ 18):

```
node scripts/safehands-engine.js <health|analyze|query> ['<json-or-address>']
```

Output is always a single JSON object on stdout; exit code 0 = success, 1 = failure. Chain access is read-only JSON-RPC to Pharos pacific-mainnet (chainId 1672, RPC `https://rpc.pharos.xyz`, overridable via `PHAROS_RPC_URL`). Score bands: **allow ≤ 30 < warn < 70 ≤ block**.

---

## §A — Health Check

**Overview:** verifies RPC reachability and that it really is chainId 1672. Run first when any other call fails with an RPC error.

**Command Template:**
```bash
node scripts/safehands-engine.js health
```

**Output Parsing:** success shape `{success:true, ok:true, chainId:1672, blockNumber, rpc, registryConfigured, attestationConfigured}`. Treat `registryConfigured:false` as "query features limited", not an error.

**Error Handling:** `CHAIN_MISMATCH` → RPC endpoint is wrong network — do NOT analyze; `PHAROS_RPC_UNAVAILABLE`/`RPC_TIMEOUT` (retryable:true) → retry once after ~3 s, then report the outage honestly.

**Agent Guidelines:** never claim "healthy" without running this; include `blockNumber` when reporting health so the user sees live data.

---

## §B — Analyze (wallet / contract / intent)

**Overview:** pre-execution risk analysis combining live on-chain reads (balance, nonce, code, ERC-20 surface) with GoPlus threat intelligence (honeypot, buy/sell tax, mintable, hidden owner, proxy, malicious-address flags — public keyless API). Check the `intel` field: when GoPlus is unreachable the engine falls back to on-chain heuristics and honestly reports reduced depth in `limits`.

**Command Templates:**
```bash
# wallet
node scripts/safehands-engine.js analyze '{"subjectType":"wallet","address":"<0xADDR>"}'
# token / contract
node scripts/safehands-engine.js analyze '{"subjectType":"contract","address":"<0xADDR>"}'
# transfer intent (walletAddress REQUIRED)
node scripts/safehands-engine.js analyze '{"subjectType":"intent","action":"transfer","toAddress":"<0xTO>","amount":"1.5","walletAddress":"<0xACTING>"}'
# swap intent
node scripts/safehands-engine.js analyze '{"subjectType":"intent","action":"swap","tokenIn":"<0xTOKEN>","tokenOut":"<0xTOKEN>","walletAddress":"<0xACTING>"}'
```

**Parameters:**

| Param | Type | Required for | Notes |
|---|---|---|---|
| subjectType | wallet\|contract\|intent | all | tx-hash analysis is NOT supported fully-hosted. |
| address | 0x-address | wallet, contract | Subject to analyze. |
| action | transfer\|swap | intent | |
| toAddress | 0x-address | transfer | Recipient. |
| amount | decimal string | transfer (optional) | e.g. `"1.5"` PROS; checked against acting wallet balance. |
| tokenIn / tokenOut | 0x-address | swap | Both required. |
| walletAddress | 0x-address | intent (all) | Acting wallet — required for balance/history checks. |
| chainId | number | optional | If present must be 1672. |

**Output Parsing:** top-level `{success:true, riskScore, recommendation, riskLevel, riskFactors[], explanation, nextAction, analysisDepth, subject, onChain?/components?}`. For intents, `components` holds per-part sub-reports (recipient / tokenIn / tokenOut) — cite the dominant factor, don't dump raw JSON.

**Error Handling:** `VALIDATION_ERROR` → fix the input (message says which field) — never guess addresses; `CHAIN_NOT_SUPPORTED` → refuse, mainnet-only; `KEY_MATERIAL_REJECTED` → tell the user secrets must never be shared, do not retry with the secret; `PHAROS_RPC_UNAVAILABLE`/`RPC_TIMEOUT` → run §A, retry once, then report outage.

**Agent Guidelines:** never invent or adjust scores; on **block**, stop and advise against — no workarounds; a low score is "no adverse signals found at heuristic depth", never a guarantee — for high-value actions recommend an additional deep review; always surface `riskFactors` verbatim (they are the evidence).

---

## §C — Query on-chain risk records & reputation

**Overview:** reads the SafeHands Registry (current Merkle root, dataURI, agent authorization) and Attestation reputation directly via `eth_call`, and — when the dataURI is an HTTP(S) batch file — fetches it and filters records for the subject.

**Command Template:**
```bash
node scripts/safehands-engine.js query '<0xADDRESS>'
```

**Output Parsing:** `{success:true, subject, registry:{configured, contractAddress?, currentMerkleRoot?, hasCommittedRoot?, currentDataURI?, isAuthorizedAgent?}, records[], recordsSource, reputation:{configured, verifiedActionCount?, lastVerifiedActionAt?, interpretation?}}`. Each record: `{riskScore, riskLevel, recommendation, expiresAt, expired}` — flag expired records as historical.

**Error Handling:** `registry.configured:false` / top-level `note` → contract addresses not baked into `assets/safehands/contracts.json`; say on-chain queries are unavailable but analysis still works. `recordsSource:"dataURI-unreachable"` → root exists but batch file couldn't be fetched; report registry state without records. RPC errors → §A flow.

**Agent Guidelines:** empty records = **neutral**, phrase as "no SafeHands record found", never "verified safe"; `verifiedActionCount:0` is also neutral; when a record exists, lead with its recommendation and whether it's expired.

---

## §D — Explaining allow / warn / block

No engine call needed. **allow** (score ≤ 30): no adverse signals at heuristic depth — proceed with normal caution. **warn** (31–69): concrete risk factors found — get explicit user confirmation before proceeding, list the factors. **block** (≥ 70): serious signals — advise against; do not help execute the action anyway. Always remind that SafeHands informs the decision, it does not guarantee outcomes.

---

## §E — Unsupported operations (decline honestly)

- **Publish risk record / attestation on-chain:** requires the SafeHands operator backend (signing writes `commitRiskRoot`/`attest`); not part of this hosted deployment. Never fabricate a txHash.
- **tx-hash deep analysis, approval-graph analysis, bespoke sell-simulation:** backend analyzer suite features — recommend them as follow-up, do not simulate their output.
- **Any signing/execution/custody, other chains, fund recovery, financial advice.**

---

## §F — Fallback: read-only Foundry `cast` (only if Node is unavailable)

**Overview:** every read the engine performs can also be done with `cast` if the runtime has Foundry but not Node. READ-ONLY only — **never use `cast send`** from this Skill under any circumstances.

**Command Templates:**
```bash
RPC=https://rpc.pharos.xyz
cast chain-id --rpc-url $RPC                                   # must print 1672
cast balance <0xADDR> --rpc-url $RPC                           # wei
cast nonce <0xADDR> --rpc-url $RPC                             # tx count
cast code <0xADDR> --rpc-url $RPC                              # 0x = not a contract
cast call <0xTOKEN> "symbol()(string)" --rpc-url $RPC          # ERC-20 probes: name()/decimals()/totalSupply()
# SafeHands contracts (only if addresses configured in assets/safehands/contracts.json):
cast call <REGISTRY> "currentMerkleRoot()(bytes32)" --rpc-url $RPC
cast call <REGISTRY> "currentDataURI()(string)" --rpc-url $RPC
cast call <REGISTRY> "isAuthorizedAgent(address)(bool)" <0xADDR> --rpc-url $RPC
cast call <ATTESTATION> "reputationOf(address)(uint256,uint64)" <0xADDR> --rpc-url $RPC
```

**Output Parsing:** interpret raw values with the same heuristics as §B (nonce 0 = fresh wallet, empty code where a contract is expected = high risk, etc.) and the same score bands. State clearly that scoring via fallback is manual heuristic application.

**Error Handling:** `chain-id` ≠ 1672 → stop (wrong network); connection errors → report RPC outage honestly.

> **Agent Guidelines:** prefer the Node engine (§A–§C) — it validates inputs and formats reports consistently. Use `cast` only as a last resort, never with `send`, never with any key material.
