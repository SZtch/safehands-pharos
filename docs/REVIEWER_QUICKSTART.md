# SafeHands Reviewer Quickstart

## Prerequisites

- Node.js >= 18
- Git

## 1. Clone and Build

```bash
git clone https://github.com/SZtch/safehands-pharos.git
cd safehands-pharos
npm ci
npm run build
```

No `.env` file, private key, or wallet is required for review.

## 2. Run Tests

```bash
npm test           # 75 smoke tests
npm run demo       # 10 live demo scenarios
npm run test:contracts  # 37 Solidity contract tests
npm run test:all   # All of the above combined
```

## 3. Quick Demo

```bash
npx safehands-pharos --demo
```

Runs 10 safety checks in your terminal — ALLOW/BLOCK decisions, wallet health, token registry, x402 preflight, risk scoring. No config required.

## 4. Package Inspection

```bash
npm pack --dry-run
```

Verify: 208 files, ~143 kB. No `.env`, no private keys, no `node_modules`.

## 5. What to Look For

### Preflight (no auth required)

SafeHands evaluates proposed on-chain actions and returns ALLOW/BLOCK/REQUIRE_CONFIRMATION decisions. Example tool calls via MCP:

- `safehands_preflight_check` — evaluate a payment, swap, approval, or x402 action
- `safehands_risk_report` — full risk analysis for a wallet or action
- `assess_risk` — quick risk score for an address
- `get_agent_policy` — view current policy limits

### Execution (gated)

Managed execution requires:
1. `WRITE_TOOLS_ENABLED=true` in env
2. RiskRegistry V2 authorization for managed wallets
3. Funding checks
4. Per-agent policy limits
5. Preflight approval (risk score below threshold)

### Security Controls

- Mainnet/Pacific: always blocked (chainId guard)
- Invalid tokens: blocked by validation
- Unlimited approvals: blocked by default
- SSRF/redirect: blocked by URL validation
- Zero address: blocked

## 6. Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | MCP server — 29 tools |
| `src/lib/policy/actionPolicyEngine.ts` | Core policy engine |
| `src/lib/policy/agentPolicy.ts` | Per-agent policy system |
| `src/lib/riskRegistryV2.ts` | V2 contract integration |
| `contracts/RiskRegistryV2.sol` | On-chain authorization + risk registry |
| `scripts/smoke-test.mjs` | 75 deterministic tests |
| `.agents/policies/default.json` | Default balanced policy |
| `SECURITY.md` | Threat model and security design |

## 7. RiskRegistry V2

```
Network:  Pharos Atlantic Testnet
Chain ID: 688689
Address:  0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
Owner:    0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5
```

## 8. Execution Modes

| Mode | Wallet | Auth | Use Case |
|------|--------|------|----------|
| Preflight / Read-only | None | None | Safety checks, demos |
| User-signed | User's own | None | User signs after SafeHands validates |
| Managed execution | Auto-created | V2 required | Full agent autonomy (testnet) |
| Env wallet (advanced) | `PRIVATE_KEY` in env | None | Local testnet dev |
| Operator / demo | Owner key | Auto-authorized | Onboarding flows |
