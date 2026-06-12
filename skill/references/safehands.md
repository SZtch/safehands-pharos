# SafeHands Guard Reference

## Overview

SafeHands Guard is a Transaction Safety Firewall / Guardrail Skill for Pharos Skill Engine. It lets an AI agent run policy-based preflight checks before execution. The CLI adapter returns the same standard response envelope as the MCP tools.

```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": "ISO_DATE_STRING"
}
```

Failure responses use:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "retryable": false,
    "source": "source_name"
  },
  "timestamp": "ISO_DATE_STRING"
}
```

## Command Template

```bash
npx safehands-pharos skill <tool_name> --input-json '<json>'
```

All outputs are valid JSON. Do not parse stdout as prose.

## SafeHands Preflight Check

### Overview

Use this command before any payment, token approval, swap, x402 payment, registry publish, or custom contract call. It returns `ALLOW`, `WARN`, `BLOCK`, `REQUIRE_CONFIRMATION`, `REQUIRE_FUNDING`, or `REQUIRE_TOKEN_REVIEW`.

### Command Template

```bash
npx safehands-pharos skill safehands_preflight_check --input-json '<action_json>'
```

Example:

```bash
npx safehands-pharos skill safehands_preflight_check --input-json '{"actionType":"approve_token","chainId":688689,"tokenAddress":"0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8","spenderAddress":"0x0000000000000000000000000000000000000001","amount":"1"}'
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| actionType | string | Yes | `send_payment`, `approve_token`, `execute_swap`, `x402_pay_and_fetch`, `publish_risk_score`, `custom_contract_call` |
| chainId | number | Yes | Must be `688689` for Pharos Atlantic Testnet |
| walletAddress | address | Optional | Agent wallet address |
| targetAddress | address | Optional | Recipient, spender, or contract target |
| tokenAddress | address | Optional | Token involved in the action |
| amount | string | Optional | Amount to send, approve, swap, or pay |
| url | string | Optional | x402 URL for x402 actions |
| approvalAmount | string | Optional | Approval amount, including `max` for unlimited approval |
| recipient | address | Optional | Payment recipient |
| spender | address | Optional | Token spender |

### Output Parsing

| Field | Meaning |
|---|---|
| decision | `ALLOW`, `WARN`, `BLOCK`, `REQUIRE_CONFIRMATION`, `REQUIRE_FUNDING`, `REQUIRE_TOKEN_REVIEW` |
| riskLevel | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, `UNKNOWN` |
| safeToExecute | `true` or `false` |
| reasons | Why SafeHands made the decision |
| requiredActions | What user/agent should do next |
| checks | Individual policy checks |
| environment | Expected to be `atlantic-testnet` |
| chainId | Expected to be `688689` |
| isMainnet | Expected to be `false` |

### Error Handling

| Error code | Meaning | Agent action |
|---|---|---|
| `TOOL_EXECUTION_FAILED` | Input failed schema validation or handler threw | Fix the JSON input and retry |
| `CHAIN_ID_MISMATCH` | Action targets the wrong chain | Switch to Pharos Atlantic Testnet |
| `MAINNET_NOT_SUPPORTED` | Mainnet action was requested | Do not execute |
| `POLICY_BLOCKED` | Safety policy blocked execution | Explain reasons to the user |

### Agent Guidelines

1. Always run preflight before write actions.
2. If decision is `BLOCK`, do not execute the action.
3. If decision is `WARN`, explain the risk and ask for user confirmation.
4. If decision is `REQUIRE_CONFIRMATION`, ask for explicit user approval.
5. If decision is `ALLOW`, the action may continue through Pharos Skill Engine or MCP execution.

## SafeHands x402 Preflight

### Overview

Use this command before paying any x402 resource. It checks URL safety, SSRF protection, endpoint probing when requested, payment amount, token, signer readiness, `MAX_X402_PAYMENT_USDC`, and whether payment appears required.

### Command Template

```bash
npx safehands-pharos skill safehands_x402_preflight --input-json '<x402_action_json>'
```

Example:

```bash
npx safehands-pharos skill safehands_x402_preflight --input-json '{"url":"https://example.com/assess-risk","paymentAmountUsdc":"0.001","probeEndpoint":false}'
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| url | string | Yes | x402 resource URL |
| method | string | Optional | HTTP method, default `GET` |
| paymentAmountUsdc | string | Optional | Estimated USDC payment amount |
| paymentTokenAddress | address | Optional | x402 payment token address |
| agentId | string | Optional | Managed wallet agent ID for signer readiness |
| probeEndpoint | boolean | Optional | If true, SafeHands probes the endpoint to detect HTTP 402 |

### Output Parsing

| Field | Meaning |
|---|---|
| decision | Safety decision for payment |
| safeToExecute | Whether the agent may continue |
| safeToPay | Interpret as true only when `decision` is `ALLOW` |
| paymentAmountUsdc | Estimated payment amount |
| maxPaymentUsdc | Configured `MAX_X402_PAYMENT_USDC` |
| signerAvailable | Whether a signer is available if payment is required |
| probe.paymentRequired | `true`, `false`, or `unknown` |

### Error Handling

| Error code | Meaning | Agent action |
|---|---|---|
| `SSRF_BLOCKED` | URL points to local/private/unsafe host | Do not fetch or pay |
| `NO_SIGNER_AVAILABLE` | Payment may require signer but none is ready | Ask user to configure managed wallet or signer |
| `POLICY_BLOCKED` | Amount, URL, token, or chain failed policy | Do not pay |

### Agent Guidelines

1. Run x402 preflight before paying any x402 resource.
2. If the endpoint is free, do not request a private key.
3. If HTTP 402/payment is required, verify amount, token, URL, and signer readiness.
4. If decision is `BLOCK`, do not pay.
5. If signer is unavailable, ask user to configure managed wallet or signer.

## SafeHands Wallet Health

### Overview

Use this command to check whether the current or managed agent wallet can pay gas, pay x402 resources, and execute write tools safely.

### Command Template

```bash
npx safehands-pharos skill safehands_wallet_health --input-json '{}'
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| agentId | string | Optional | Managed wallet agent ID |
| walletAddress | address | Optional | Explicit wallet address for read-only balance checks |

### Output Parsing

| Field | Meaning |
|---|---|
| status | `READY`, `DEGRADED`, or `NOT_READY` |
| walletReady | Treat as true only when status is `READY` |
| walletMode | `none`, `env`, `managed-testnet`, or future signer mode |
| writeToolsEnabled | Whether execution tools can broadcast |
| readiness.canPayGas | PHRS gas readiness |
| readiness.canPayX402 | USDC x402 readiness |
| readiness.canExecuteWrites | Signer + gas + write-tool readiness |
| balances.PHRS | Native gas balance if RPC is available |
| balances.USDC | USDC balance if RPC is available |

### Error Handling

| Error code | Meaning | Agent action |
|---|---|---|
| `RPC_UNAVAILABLE` | RPC balance read failed | Treat wallet health as degraded and retry later |
| `NO_SIGNER_AVAILABLE` | No signer mode configured | Ask user to configure wallet mode |
| `WALLET_ENCRYPTION_KEY_REQUIRED` | Persistent managed wallet needs encryption key | Ask user to configure testnet wallet storage |

### Agent Guidelines

1. Run wallet health before x402 payment or write execution.
2. Do not execute writes if `writeToolsEnabled` is false.
3. If RPC is unavailable, report degraded status rather than assuming the wallet is funded.
4. If signer is unavailable, do not ask the user to paste a key into chat.

## Token Registry Status

### Overview

Use this command to classify whether a token is canonical, test liquidity, custom/non-registry, unknown, or invalid. The exact user-provided token address is checked; SafeHands does not silently replace it.

### Command Template

```bash
npx safehands-pharos skill token_registry_status --input-json '{"token":"<token_address>"}'
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| token | string | Yes | Token symbol or exact contract address to classify |

### Status Values

| Status | Meaning |
|---|---|
| `CANONICAL_TESTNET_TOKEN` | Token is recognized as canonical for this testnet config |
| `TEST_LIQUIDITY_TOKEN` | Token is a test/demo liquidity token |
| `CUSTOM_NON_REGISTRY` | Valid address but not in SafeHands registry |
| `UNKNOWN` | Unknown status |
| `INVALID_ADDRESS` | Input is not a valid EVM address or known symbol |

### Output Parsing

| Field | Meaning |
|---|---|
| status | Registry classification |
| normalizedAddress | Checksummed address when valid |
| verificationStatus | `DOCS_VERIFIED`, `PROJECT_CONFIGURED`, `UNVERIFIED_CUSTOM_TOKEN`, etc. |
| docsSource | Source used for classification, when available |

### Error Handling

| Error code | Meaning | Agent action |
|---|---|---|
| `TOOL_EXECUTION_FAILED` | Missing token input or malformed request | Ask for exact token address |

### Agent Guidelines

1. Never silently replace user-provided token addresses.
2. If token is custom, clearly say it is custom/non-registry.
3. If token is canonical, show `docsSource` or `verificationStatus`.

## Explain Risk

### Overview

Use this command to convert a policy result into a concise human-readable explanation.

### Command Template

```bash
npx safehands-pharos skill explain_risk --input-json '<risk_json>'
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| decision | string | Yes | Policy decision |
| riskLevel | string | Yes | Risk level |
| reasons | string[] | Optional | Reasons returned by policy engine |
| requiredActions | string[] | Optional | Required next actions |

### Output Parsing

| Field | Meaning |
|---|---|
| explanation | Human-readable explanation |
| decision | Original policy decision |
| riskLevel | Original risk level |

### Error Handling

| Error code | Meaning | Agent action |
|---|---|---|
| `TOOL_EXECUTION_FAILED` | Invalid risk JSON | Re-run with a policy result or valid fields |

### Agent Guidelines

1. Use this after a preflight result when the user asks “why?”.
2. Keep the explanation factual and tied to SafeHands reasons.
3. Do not override a `BLOCK` decision with reassuring language.

## SafeHands Risk Report

### Overview

Use this command to generate a judge/demo-friendly safety report. It runs preflight and returns a summary, reasons, required actions, checks, and environment.

### Command Template

```bash
npx safehands-pharos skill safehands_risk_report --input-json '<action_or_policy_result_json>'
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| actionType | string | Yes | Same action type list as preflight |
| chainId | number | Optional | Defaults to Pharos Atlantic Testnet |
| amount | string | Optional | Amount involved |
| tokenAddress | address | Optional | Token involved |
| url | string | Optional | x402 URL when relevant |
| includeChecks | boolean | Optional | Include detailed policy checks, default true |

### Output Parsing

| Field | Meaning |
|---|---|
| summary | Human-readable risk report |
| decision | Safety decision |
| riskLevel | Risk level |
| reasons | Reasons for decision |
| requiredActions | Next steps |
| checks | Detailed checks when requested |

### Error Handling

| Error code | Meaning | Agent action |
|---|---|---|
| `TOOL_EXECUTION_FAILED` | Invalid action JSON | Fix the action JSON and retry |
| `POLICY_BLOCKED` | Safety policy blocked the action | Do not execute the action |

### Agent Guidelines

1. Use this for demos, user-facing summaries, and audit trails.
2. If the report says `BLOCK`, stop execution.
3. If the report says `WARN` or `REQUIRE_CONFIRMATION`, ask for explicit user confirmation.
4. If the report says `ALLOW`, the action may continue through Pharos Skill Engine or MCP execution.
