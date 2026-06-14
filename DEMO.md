# SafeHands Preflight — Live Examples

These are real outputs from `safehands_preflight_check` run against the built package on Pharos Atlantic Testnet (chain 688689). Nothing is fabricated.

---

## Scenario 1 — ALLOW (payment within limit)

**Command:**

```bash
npx safehands-pharos skill safehands_preflight_check --input-json \
  '{"actionType":"send_payment","chainId":688689,"amount":"0.001","recipient":"0x1234567890123456789012345678901234567890"}'
```

**Output:**

```json
{
  "success": true,
  "data": {
    "decision": "ALLOW",
    "riskLevel": "LOW",
    "safeToExecute": true,
    "reasons": [],
    "requiredActions": [],
    "checks": [
      { "name": "mainnet_guard", "status": "pass", "message": "Action is not targeting mainnet." },
      { "name": "chain_id", "status": "pass", "message": "Chain ID is Pharos Atlantic Testnet (688689)." },
      { "name": "environment", "status": "pass", "message": "Environment is atlantic-testnet." },
      { "name": "payment_limit", "status": "pass", "message": "Payment is within 0.1 PHRS limit." }
    ],
    "environment": "atlantic-testnet",
    "chainId": 688689,
    "isMainnet": false,
    "tokenRegistry": null,
    "source": "safehands_preflight_check"
  },
  "error": null,
  "timestamp": "2026-06-14T07:28:31.000Z"
}
```

**What happened:** All four checks passed. The payment (0.001 PHRS) is within the configured `MAX_TX_AMOUNT_PHRS=0.1` limit, the chain is correct, and this is not a mainnet action. SafeHands returned `ALLOW` — the agent may proceed.

---

## Scenario 2 — BLOCK (payment over spend limit)

**Command:**

```bash
npx safehands-pharos skill safehands_preflight_check --input-json \
  '{"actionType":"send_payment","chainId":688689,"amount":"1","recipient":"0x1234567890123456789012345678901234567890"}'
```

**Output:**

```json
{
  "success": true,
  "data": {
    "decision": "BLOCK",
    "riskLevel": "HIGH",
    "safeToExecute": false,
    "reasons": [
      "Payment exceeds configured PHRS limit."
    ],
    "requiredActions": [
      "Reduce amount or increase MAX_TX_AMOUNT_PHRS consciously for testnet."
    ],
    "checks": [
      { "name": "mainnet_guard", "status": "pass", "message": "Action is not targeting mainnet." },
      { "name": "chain_id", "status": "pass", "message": "Chain ID is Pharos Atlantic Testnet (688689)." },
      { "name": "environment", "status": "pass", "message": "Environment is atlantic-testnet." },
      { "name": "payment_limit", "status": "fail", "message": "Payment 1 PHRS exceeds limit 0.1 PHRS." }
    ],
    "environment": "atlantic-testnet",
    "chainId": 688689,
    "isMainnet": false,
    "tokenRegistry": null,
    "source": "safehands_preflight_check"
  },
  "error": null,
  "timestamp": "2026-06-14T07:28:36.000Z"
}
```

**What happened:** The `payment_limit` check failed — 1 PHRS exceeds the default `MAX_TX_AMOUNT_PHRS=0.1`. SafeHands returned `BLOCK` with a plain-English reason. The agent must stop. No transaction is sent.

---

## Response Field Reference

| Field | Type | Meaning |
|-------|------|---------|
| `decision` | `ALLOW` \| `WARN` \| `BLOCK` \| `REQUIRE_CONFIRMATION` | The final policy verdict. Agents must stop if `BLOCK`. |
| `riskLevel` | `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL` | Severity of the detected risk. |
| `safeToExecute` | `boolean` | Convenience flag: `true` only when decision is `ALLOW`. |
| `reasons` | `string[]` | Plain-English explanation of why the action was blocked or warned. Empty on `ALLOW`. |
| `requiredActions` | `string[]` | What the user or agent must do to resolve the block. |
| `checks` | `object[]` | Per-check breakdown. Each check has `name`, `status` (`pass`/`fail`), and `message`. |
