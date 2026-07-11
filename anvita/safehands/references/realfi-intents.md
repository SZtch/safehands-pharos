# SafeHands RealFi Intent Templates

RealFi intents map a natural-language request to **real read-only checks** — they are routing/analysis templates, **not** mocked data. Each evidence block runs only when its inputs are present; anything missing is reported in `missingInputs`, and an unknown or unverified target contract fails closed (warn/block). Provider data that is not configured is reported as unavailable — never invented.

All intents run via:

```bash
node scripts/safehands-engine.js analyze '{"subjectType":"intent","action":"<action>", …}'
```

Output (all intents): standard `report()` fields (`riskScore`, `recommendation`, `riskFactors`, `explanation`, `nextAction`) plus `components{}`, `evidenceUsed[]`, `missingInputs[]`, and `intentNotes[]`.

## Shared evidence blocks

| Block | Runs when | Check |
|---|---|---|
| acting-wallet probe | `walletAddress` present | balance / nonce / code |
| token analysis | `token`/`tokenAddress`/`tokenIn` present | `analyzeContract` (registry + impersonation + GoPlus) |
| target analysis | target contract present | `analyzeContract`; **no code → block (~95)**; not canonical & unverified → fail-closed floor (deposit-class 45, else 31) |
| allowance exposure | `token` + `owner`(defaults to wallet) + `spender`(defaults to target) | live `allowance(owner,spender)`; unlimited flagged |
| simulation + gas | `to`/`data` tx object present | `eth_call` (revert = major risk) + `eth_estimateGas`; both dry-run |
| calldata decode | tx object carries `data` | **offline** decode of approve/permit/Permit2/setApprovalForAll/transfer/admin/MultiSend selectors → `components.calldata`; escalate-only floors (unlimited-to-unknown & blanket-operator → block, denylisted recipient → block, malformed/unknown → held); recipient denylist from `SAFEHANDS_RECIPIENT_DENYLIST` (empty by default) |
| target reputation | Attestation configured | `reputationOf(target)` (neutral when zero) |
| URL risk | url-centric intents | **static string inspection only — never fetched**; `payTo` recipients are also checked against the operator denylist |

**Fund-moving intents** (`bridge`, `yield_deposit`, `vault_deposit`, `staking`, `tokenized_asset`) require a valid `walletAddress`. **URL-centric intents** (`fiat_ramp`, `reward_campaign`, `x402_payment`) do not.

Target contract key by action: `bridge`→`bridgeContract`/`router`, `yield_deposit`→`targetContract`, `vault_deposit`→`vault`, `staking`→`stakingContract`, `tokenized_asset`→`market`. `contract` is accepted as a generic fallback for any of them.

## bridge_intent

> "Before my agent bridges USDC through Stargate, check the risk."
> "Cek risiko sebelum agen saya bridge USDC lewat Stargate."

Inputs: `walletAddress` (req), `token`, `bridgeContract`/`router`, optional `owner`/`spender`, optional tx object (`to`,`data`,`value`).
Checks: token canonical/known · router known-or-unknown (fail-closed) · allowance exposure · gas estimate · simulation · reputation → allow/warn/block. No published Stargate router is bundled, so unlisted routers warn/block. **SafeHands never bridges.**

## yield_deposit_intent

> "Before my agent deposits PROS into stPROS Pre-Mint, check the risk."
> "Sebelum agen saya deposit PROS ke stPROS Pre-Mint, cek risikonya."

Inputs: `walletAddress` (req), `token`, `targetContract`, optional owner/spender, optional tx object.
Checks: input token known/canonical · target verified-or-unknown (fail closed if unverified) · allowance · gas · simulation · reputation. Adds `vaultRiskScore` (interaction risk, not APY) and `vaultProviderData` (TVL/cap/paused/APY = `not_configured` unless a vault-status provider is set — never invented).

## vault_deposit_intent

> "Check this vault before my agent deposits."

Inputs: `walletAddress` (req), `vault`, `token`, optional owner/spender, optional tx object.
Checks: vault contract status · deposit token status · allowance · simulation · reputation. Paused/cap/TVL/APY only if a provider is configured — otherwise reported unavailable, never invented. Adds `vaultRiskScore`.

## staking_intent

> "Is it safe for my agent to stake into this contract?"

Inputs: `walletAddress` (req), `stakingContract`, `token`, optional owner/spender, optional tx object.
Checks: staking contract known/unknown (fail closed) · token status · allowance · gas · simulation · reputation. **SafeHands never stakes.**

## tokenized_asset_intent

> "Vet this tokenized-asset market before my agent buys in."

Inputs: `walletAddress` (req), `market`/`token`, optional tx object.
Checks: token/market contract known/unknown · reputation · token security (GoPlus) · allowance/transfer risk · missing-evidence handling. Note: on-chain surface only — offering documents and real-world asset backing are **not** verifiable from the hosted engine.

## fiat_ramp_intent

> "Is this on-ramp link safe for my agent to open?"

Inputs: `url` (req), optional `payTo`, optional `token`.
Checks: static URL risk (non-HTTPS, embedded credentials, IP/local host, punycode, odd port) · payTo address risk · token status. **SafeHands does not process or approve fiat on/off-ramp payments** and cannot attest an operator's legitimacy.

## reward_campaign_intent

> "Is this airdrop/reward campaign link legit for my agent?"

Inputs: `url` (req), optional `payTo`/`token`, optional contract + tx object for interaction risk.
Checks: campaign link risk · contract interaction risk if address/calldata given · approval/transfer risk. **SafeHands cannot confirm a campaign or reward is legitimate** — no adverse signal is not an endorsement.

## x402_payment_intent

> "Run SafeHands preflight before this agent pays this x402 API."

Inputs: `url` (req), optional `payTo`, `token`, `amount`.
Checks: static URL/x402 link safety · recipient (`payTo`) analysis · token status · amount-vs-balance if wallet given. The x402 fetch/payment is **NOT executed** — string and address checks only. **SafeHands never pays.**
