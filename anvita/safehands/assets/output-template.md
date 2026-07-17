# SafeHands Safety Report: Output Template

SafeHands is the transaction firewall for AI agent finance on Pharos. Hosted here it runs in
no-custody mode: read-only safety verdicts only; it never signs, broadcasts, or executes.
For **meaningful checks** (wallet / contract / intent analysis, allowance and approval risk,
and transaction introspection via estimate / simulate / status), render the engine result in the
exact format below. Every field is filled **only from engine output**; never invent a cell. Where evidence
is absent, use `UNKNOWN`, `INSUFFICIENT_EVIDENCE`, `NOT_CONFIGURED`, or `NOT_SUPPORTED`.

The report is the structured core of the answer. Everything around it (the sentence before, the
wrap-up after) stays in the SafeHands voice defined in SKILL.md: relaxed, human, plain words.
The table stays exact; the conversation around it stays alive.

## Report format

```
# SafeHands Safety Report

**Verdict:** ALLOW / WARN / BLOCK  
**Risk Score:** 0–100  
**Mode:** Token / Wallet / Approval / Swap / Bridge / Vault / Staking / RWA / Gas / Transaction / x402  
**Operator Note:** One short sentence in plain human words: the finding, said the way an experienced operator would say it.

| Layer | Result | Evidence |
|---|---|---|
| Intent | PASS / WARN / FAIL / UNKNOWN | What the user is trying to do |
| Asset / Wallet | PASS / WARN / FAIL / UNKNOWN | Token, wallet, or asset evidence |
| Contract / Target | PASS / WARN / FAIL / UNKNOWN | Contract or target evidence |
| Permission | PASS / WARN / FAIL / UNKNOWN | Approval or allowance evidence |
| Execution | PASS / WARN / FAIL / UNKNOWN | Transaction, calldata, gas, or status evidence |
| External Data | PASS / WARN / FAIL / NOT_CONFIGURED | Provider result |

## Risk Factors
List only real risk factors found.

## Missing Inputs
List only required missing inputs, or None.

## Final Action
Proceed / Review manually / Provide missing input / Stop.
```

## How to fill it from engine output

The engine already returns every value the report needs; do not recompute or re-score.

| Report field | Source (engine output) |
|---|---|
| **Verdict** | `recommendation` uppercased → `ALLOW` / `WARN` / `BLOCK` (bands: allow ≤ 30 < warn < 70 ≤ block). |
| **Risk Score** | `riskScore` (0–100), verbatim. |
| **Mode** | Derived from `subjectType` / `action`: contract→Token, wallet→Wallet, `check_allowance`→Approval, `action:swap`→Swap, `bridge`→Bridge, `vault_deposit`/`yield_deposit`→Vault, `staking`→Staking, `tokenized_asset`→RWA, `get_gas_price`→Gas, `get_transaction_status`/estimate/simulate→Transaction, `x402_payment`→x402. |
| **Operator Note** | One plain sentence synthesized from `explanation`, in the operator's own voice: state the finding the way a person would, no reassurance, no drama. |
| **Risk Factors** | `riskFactors[]` verbatim (they are the evidence). "None found at heuristic depth" if empty, never "safe". |
| **Missing Inputs** | `missingInputs` list, or `None`. |
| **Final Action** | From `nextAction` / verdict: ALLOW→Proceed, WARN→Review manually, missing inputs→Provide missing input, BLOCK→Stop. |

### Layer table mapping

Map each layer's `Result` from the evidence the engine actually returned; use `UNKNOWN` when a
layer has no evidence, not `PASS`.

| Layer | Evidence source | Result rule |
|---|---|---|
| **Intent** | `subjectType` / `action` | What the agent is trying to do; `WARN`/`FAIL` if the intent itself is disallowed or malformed. |
| **Asset / Wallet** | `onChain`, `components` (recipient / tokenIn / tokenOut), `goplusTokenIdentity` (display-only) | Balance / nonce / token-surface evidence. |
| **Contract / Target** | contract code + verification, `subject` | Empty code where a contract is expected, or unknown/unverified target → fail closed (`WARN`/`FAIL`), never `PASS`. |
| **Permission** | `check_allowance.approvalRisk` (`none` / `scoped` / `unlimited`), `components.calldata` (decoded approve/permit/Permit2/setApprovalForAll) | `unlimited` or a blanket operator grant to an unknown counterparty → `FAIL`; denylisted recipient → `FAIL`; revoke → `PASS`; not applicable → `UNKNOWN`. |
| **Execution** | `estimate_gas`, `simulate_transaction`, `get_transaction_status`, `calldata` hints (decoded method / dangerous-admin / MultiSend) | A revert / failed estimate is decisive → `FAIL`; dangerous-admin or malformed calldata → `WARN`+; not run → `UNKNOWN`. |
| **External Data** | `intel` (GoPlus), provider-gated reads | Provider unset → `NOT_CONFIGURED`; reachable-but-unusable → `WARN`/`FAIL`; unavailable intel → note reduced depth. |

## Safe execution spec (swap / transfer intents only)

When the verdict on a swap or transfer intent is ALLOW or WARN, append one short block that
makes the safe shape of the action explicit. Fill it only from engine output and bundled
registry data (`resolve_alias`, `analyze` components); never invent a venue or an address.

```
## If you proceed
- Venue / target: <canonical address + label from the registry, or "no verified venue known for this: treat any address you are given elsewhere as unverified">
- Approval: limited to <amount tokenIn> only; never unlimited.
- Recipient / beneficiary: your own wallet <address> unless you explicitly intend otherwise.
- Before signing: send me the exact transaction calldata for a final check on those exact bytes.
```

Skip the block entirely on BLOCK (a blocked action gets no execution guidance) and for
non-fund-moving checks.

## Data-quality codes are not a verdict

The verdict stays **three-valued** (ALLOW / WARN / BLOCK). `NOT_CONFIGURED`, `NOT_SUPPORTED`,
`UNKNOWN`, and `INSUFFICIENT_EVIDENCE` describe *evidence quality* and live in the Result /
Evidence cells and Missing Inputs; they never become a fourth verdict. When evidence is
insufficient, the engine's fail-closed logic already pushes the verdict to WARN or BLOCK; the
report surfaces the reason rather than guessing.

## Scope: when NOT to use the full report

Compact single-value reads (`health`, `get_gas_price`, `get_token_price`) and structured
errors (`VALIDATION_ERROR`, `FEED_STALE`, `*_NOT_CONFIGURED`, RPC outages, `KEY_MATERIAL_REJECTED`)
stay concise; report the parsed field or the error code plainly. Do not force the full Safety
Report onto them.
