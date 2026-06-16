# Security Policy — SafeHands-Pharos

## Scope

SafeHands is a **Pharos Atlantic Testnet-only** safety gateway for AI agents. It features production-inspired safety architecture but is **not audited for mainnet custody**.

## Threat Model

SafeHands protects agents from:

- Executing on mainnet or Pacific (blocked by chain ID guard)
- Unlimited token approvals (blocked by default)
- SSRF via x402 URLs (localhost, private IPs, metadata IPs, IPv6 local all blocked)
- Overspending (per-tx + daily caps enforced)
- Unauthorized managed wallet execution (RiskRegistry V2 authorization required)
- Invalid amounts, zero addresses, unknown tokens (strict validation)
- Prompt/runtime injection of policy limits (policy stored in files, not runtime params)

## What SafeHands Does NOT Protect Against

- Smart contract vulnerabilities in third-party tokens or pools
- Private key compromise at the OS/process level
- Denial of service against the RPC endpoint
- Social engineering of the human operator

## Key Management

- Managed wallets are encrypted with AES-256-GCM (not KMS/Vault grade)
- Private keys are never returned in tool responses or logged
- The `RISK_REGISTRY_OWNER_PRIVATE_KEY` is operator-only and must never be committed
- `.env` is gitignored; `.env.example` uses placeholders only

## RiskRegistry V2

| Field | Value |
|---|---|
| Address | `0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25` |
| Network | Pharos Atlantic Testnet (688689) |
| Authorization | Required for managed wallet writes only |

Preflight, read-only, user-signed, and env wallet modes do **not** require RiskRegistry authorization.

## Reporting Vulnerabilities

If you discover a security issue, please open a GitHub issue at [github.com/SZtch/safehands-pharos/issues](https://github.com/SZtch/safehands-pharos/issues) or contact the maintainer directly.

## Testnet Disclaimer

SafeHands is designed for Pharos Atlantic Testnet. Mainnet and Pacific are blocked by design. Do not use SafeHands with real funds. The safety architecture is production-inspired but has not undergone formal security audit.
