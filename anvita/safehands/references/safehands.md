# SafeHands Engine — Operations Manual (AI instruction manual)

All operations run the bundled zero-dependency engine (Node ≥ 18):

```
node scripts/safehands-engine.js <health|analyze|query> ['<json-or-address>']
```

Output is always a single JSON object on stdout; exit code 0 = success, 1 = failure. Chain access is read-only JSON-RPC to Pharos pacific-mainnet (chainId 1672, RPC `https://rpc.pharos.xyz`, overridable via `PHAROS_RPC_URL`). Score bands: **allow ≤ 30 < warn < 70 ≤ block**.

**Output format:** for meaningful checks (analyze wallet/contract/intent, allowance, transaction introspection), render the engine JSON as the **SafeHands Safety Report** defined in `assets/output-template.md`; compact single-value reads and structured errors stay concise.

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

**Overview:** pre-execution risk analysis combining live on-chain reads (balance, nonce, code, ERC-20 surface) with GoPlus threat intelligence (honeypot, buy/sell tax, mintable, hidden owner, proxy, malicious-address flags — public keyless API). Check the `intel` field: when GoPlus is unreachable the engine falls back to on-chain heuristics and honestly reports reduced depth in `limits`. Intents that carry a raw tx object additionally get an **offline calldata decode** (approve / permit / Permit2 / setApprovalForAll / transfer / transferFrom / dangerous-admin / MultiSend selectors): an unlimited approval or blanket operator grant to an unknown counterparty blocks, a recipient on the operator denylist blocks, and unrecognized or malformed calldata is held — escalate-only floors that can raise the score but never relax it.

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
| action | transfer\|swap\|bridge\|yield_deposit\|vault_deposit\|staking\|tokenized_asset\|fiat_ramp\|reward_campaign\|x402_payment | intent | transfer/swap below; RealFi actions in `references/realfi-intents.md`. |
| toAddress | 0x-address | transfer | Recipient. |
| amount | decimal string | transfer (optional) | e.g. `"1.5"` PROS; checked against acting wallet balance. |
| tokenIn / tokenOut | 0x-address | swap | Both required. |
| walletAddress | 0x-address | intent (all) | Acting wallet — required for balance/history checks. |
| chainId | number | optional | If present must be 1672. |

**Output Parsing:** top-level `{success:true, riskScore, recommendation, riskLevel, riskFactors[], explanation, nextAction, analysisDepth, subject, onChain?/components?, goplusTokenIdentity?}`. For intents, `components` holds per-part sub-reports (recipient / tokenIn / tokenOut) — cite the dominant factor, don't dump raw JSON. For tx-carrying intents, `components.calldata` holds the decoded call: `{decoded, method, category:"approval"|"transfer"|"admin"|"batch"|"unknown", selector, token?, spender?, operator?, recipient?, from?, amountRaw?, unlimited, isRevoke, approved?, counterpartyKnown, counterpartyLabel?, recipientDenylisted, dangerous, factors[], notes[]}` — its `factors` are already merged into the top-level `riskFactors`; use `notes` for context (e.g. permit-signature caveats). `goplusTokenIdentity` (contract analysis, when GoPlus reports it) is display-only `{tokenName?, tokenSymbol?}` — identity context for the user, never part of the score.

**Recipient denylist (operator config, local deployments):** `SAFEHANDS_RECIPIENT_DENYLIST` — comma-separated 0x addresses the operator wants hard-blocked as fund recipients (calldata transfer/transferFrom recipients, transfer-intent `toAddress`, URL-intent `payTo`). **EMPTY by default** — SafeHands never ships a fabricated scam list, so an empty denylist means "no operator list configured", never "no scam risk".

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

**Error Handling:** `registry.configured:false` / top-level `note` → contract addresses not baked into `assets/contracts.json`; say on-chain queries are unavailable but analysis still works. `recordsSource:"dataURI-unreachable"` → root exists but batch file couldn't be fetched; report registry state without records. RPC errors → §A flow.

**Agent Guidelines:** empty records = **neutral**, phrase as "no SafeHands record found", never "verified safe"; `verifiedActionCount:0` is also neutral; when a record exists, lead with its recommendation and whether it's expired.

---

## §D — Explaining allow / warn / block

No engine call needed. **allow** (score ≤ 30): no adverse signals at heuristic depth — proceed with normal caution. **warn** (31–69): concrete risk factors found — get explicit user confirmation before proceeding, list the factors. **block** (≥ 70): serious signals — advise against; do not help execute the action anyway. Always remind that SafeHands informs the decision, it does not guarantee outcomes.

---

## §G — Market & network reads (gas, token price)

**Overview:** live read-only market data. Gas from `eth_gasPrice`; token price from **Chainlink Push Engine** feeds read via `eth_call` (`latestAnswer()` + `latestTimestamp()`). Feed addresses, aliases, and heartbeat live in `assets/supported-assets.json`. **Never hardcode a price, including stablecoins.**

**Command Templates:**
```bash
node scripts/safehands-engine.js get_gas_price
node scripts/safehands-engine.js get_token_price PROS
node scripts/safehands-engine.js get_token_price '{"symbol":"PHAROS"}'
```

**Supported symbols:** PROS, BTC, ETH, WBTC, USDT, USDC, LINK, BNB, SOL, XRP. **Aliases:** `WPROS`→PROS, `WETH`→ETH, `PHAROS`→PROS (leading `$` stripped). **USDT is feed-only** — price is supported, but there is no official Pacific token address, so do NOT claim USDT wallet-balance or token-contract analysis.

**Output Parsing:** `get_gas_price` → `{wei, gwei, source}`. `get_token_price` (ok) → `{price, requestedSymbol, symbol, pair, aliased, aliasNote?, feedAddress, feedDecimals, answerRaw, updatedAt, feedAgeSeconds, heartbeatSeconds, stale:false, sourceStatus:"ok"}`.

**Error Handling:** `FEED_NOT_CONFIGURED` → symbol has no configured feed (offer `supportedSymbols`, do not guess); `FEED_STALE` → heartbeat violated (report as stale; `lastKnownAnswer` is NOT a current price); `PROVIDER_UNAVAILABLE` → feed answered non-positive/unreadable; RPC errors → §A flow. **Price-staleness rule:** stale means the feed heartbeat was violated — nothing else.

**Agent Guidelines:** for "harga 1 pharos berapa?" / "PROS price" / "$PROS", call `get_token_price` with `PHAROS`/`PROS` and state plainly that Pharos is the network and PROS is the token. Quote the `price` and `pair` verbatim; if the call errors, report the error — never a guessed number.

---

## §H — Transaction introspection (allowance, status, estimate, simulate, proof)

**Overview:** read-only inspection of approvals, transactions, and would-be transactions. **Nothing here signs, broadcasts, or changes state.**

**Command Templates:**
```bash
node scripts/safehands-engine.js check_allowance '{"token":"0x…","owner":"0x…","spender":"0x…"}'
node scripts/safehands-engine.js get_transaction_status 0x<64-hex-tx-hash>
node scripts/safehands-engine.js estimate_gas '{"from":"0x…","to":"0x…","data":"0x…","value":"1.5"}'
node scripts/safehands-engine.js simulate_transaction '{"to":"0x…","data":"0x…"}'
node scripts/safehands-engine.js get_spv_proof '{"address":"0x…","storageKeys":["0x…"]}'
```

**Output Parsing:**
- `check_allowance` → `{allowanceRaw, allowanceFormatted?, tokenSymbol?, tokenDecimals?, approvalRisk:"none"|"scoped"|"unlimited", approvalRiskHint}`. **unlimited** (≥2²⁵⁵) is high risk — spender controls the whole balance.
- `get_transaction_status` → `{status:"pending"|"success"|"failed"|"not_found", blockNumber?, gasUsed?, from?, to?, explorer}`.
- `estimate_gas` → `{estimatedGas, calldata?, broadcast:false}` or `ESTIMATE_FAILED` (`reverted?`, sanitized reason).
- `simulate_transaction` → `{reverted:false, returnData, calldata?, broadcast:false}` or `SIMULATION_REVERTED` (sanitized reason).
- `calldata?` (when `data` decodes) is a **label-only** block `{method, category, selector, unlimited, spender?/operator?/recipient?, counterpartyKnown, dangerous, hints[]}` — surface its hints (e.g. "UNLIMITED approve to an UNKNOWN spender") next to the estimate/simulation; scoring stays with §B analyze.
- `get_spv_proof` → `{proof}` or `NOT_SUPPORTED` when the RPC lacks `eth_getProof`.

**Value fields:** `value` is decimal PROS (e.g. `"1.5"`); `valueWei` is a base-10 integer string. `data` must be 0x-even-length hex.

**Error Handling:** `VALIDATION_ERROR` → fix the named field (only a 0x+64-hex **transaction hash** goes to `get_transaction_status`, never a key); `ESTIMATE_FAILED`/`SIMULATION_REVERTED` → the action would fail on-chain, treat as unsafe; `NOT_SUPPORTED` → the endpoint can't produce a proof — never fabricate one; RPC errors → §A flow.

**Agent Guidelines:** a reverting simulation or failed estimate is decisive evidence the action would fail — surface it and advise against executing as-is. Never broadcast; these are dry runs.

---

## §I — Provider-gated reads (subgraph, history, pool)

**Overview:** optional public data. An endpoint is honored ONLY if it is configured in `assets/supported-protocols.json`, public, verified, **keyless** (https, no API key / pass-key / auth header / cookie), and DNS-resolvable. Today all are unset → these commands return `*_NOT_CONFIGURED`.

**Command Templates:**
```bash
node scripts/safehands-engine.js query_goldsky_subgraph '{"query":"{ tokens { id } }"}'
node scripts/safehands-engine.js get_execution_history '{"address":"0x…"}'
node scripts/safehands-engine.js get_pool_info '{"poolAddress":"0x…"}'
```

**Output Parsing:** configured → `{provider, endpoint, data}`. Unconfigured → `{success:false, error.code:"GOLDSKY_NOT_CONFIGURED"|"HISTORY_PROVIDER_NOT_CONFIGURED"|"PROVIDER_NOT_CONFIGURED", provider, providerStatus:"not_configured", safeFallback}`.

**Error Handling:** `*_NOT_CONFIGURED` → say the data is unavailable in this deployment; do NOT scrape explorers, invent history, or substitute a DEX quote. `PROVIDER_UNAVAILABLE` → configured endpoint failed; report unavailable. Secret/auth fields in the input are rejected (`VALIDATION_ERROR`).

**Agent Guidelines:** pool/route data is liquidity context only — **never a canonical price** (use §G). Never treat a DODO/FaroSwap quote as authoritative pricing.

---

## §J — RealFi intents

**Overview:** natural-language RealFi requests (bridge, yield deposit, vault deposit, staking, tokenized asset, fiat ramp, reward campaign, x402 payment) route to `analyze subjectType:"intent"` with the matching `action`. Each intent composes the real read-only checks above; missing inputs are reported in `missingInputs`, and unknown/unverified target contracts fail closed (warn/block). Full per-intent parameters, evidence composition, and examples (EN + ID) are in **`references/realfi-intents.md`**. Vault/yield intents add `vaultRiskScore` (interaction risk, not APY) and never invent TVL/cap/paused/APY when no provider is configured.

---

## §E — Unsupported operations (decline honestly)

- **Publish risk record / attestation on-chain:** requires the SafeHands operator backend (signing writes `commitRiskRoot`/`attest`); not part of this hosted deployment. Never fabricate a txHash.
- **tx-hash deep analysis, historical approval-graph analysis, bespoke sell-simulation:** backend analyzer suite features — recommend them as follow-up, do not simulate their output. (Offline calldata/approval decoding of a *pending* transaction IS supported hosted as of v2.4.0 — that's §B/§H, not this list.)
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
# SafeHands contracts (only if addresses configured in assets/contracts.json):
cast call <REGISTRY> "currentMerkleRoot()(bytes32)" --rpc-url $RPC
cast call <REGISTRY> "currentDataURI()(string)" --rpc-url $RPC
cast call <REGISTRY> "isAuthorizedAgent(address)(bool)" <0xADDR> --rpc-url $RPC
cast call <ATTESTATION> "reputationOf(address)(uint256,uint64)" <0xADDR> --rpc-url $RPC
```

**Output Parsing:** interpret raw values with the same heuristics as §B (nonce 0 = fresh wallet, empty code where a contract is expected = high risk, etc.) and the same score bands. State clearly that scoring via fallback is manual heuristic application.

**Error Handling:** `chain-id` ≠ 1672 → stop (wrong network); connection errors → report RPC outage honestly.

> **Agent Guidelines:** prefer the Node engine (§A–§C) — it validates inputs and formats reports consistently. Use `cast` only as a last resort, never with `send`, never with any key material.
