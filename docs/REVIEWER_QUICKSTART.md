# SafeHands reviewer quickstart

SafeHands is the pre-execution transaction firewall for AI agent finance on Pharos, mainnet-first (Pacific, chain `1672`). It is read-only by default and only executes writes/payments after explicit environment flags, signer availability, policy checks, and authorization where required.

**No-install path:** the fully-hosted, zero-custody agent is live on [Anvita Flow](https://flow.anvita.xyz/home) as `safehands` (Agent Carnival Phase 2); any Steward Agent on the marketplace can discover and call it (no server, no keys). To try the safety engine on your own machine without cloning, run `npx -y github:SZtch/safehands-pharos --demo`. To exercise the HTTP API directly, self-host the read-only backend locally (`npm run build && node dist/api/server.js` → `http://localhost:4022`) and use the curl examples in [SAFEHANDS_REVIEWER_DEMO_SCRIPT.md](./SAFEHANDS_REVIEWER_DEMO_SCRIPT.md). For the fastest "firewall in action" moment (the engine blocking a drainer-style unlimited approve from raw calldata, offline), see the 60-second section in that script.

## 1. Install and build

```bash
npm ci
npm run build
```

No `.env`, private key, or wallet is required for default review.

## 2. Run validation

```bash
npm test
npm run demo
npm pack --dry-run
```

Expected:

- `npm run build` compiles TypeScript.
- `npm test` runs the hermetic deterministic suite: policy engine, write gate, x402 gate, token-security fail-closed behavior, execution hardening, SDK exports, wallet crypto, and risk inclusion; no network, never broadcasts. Live read-only RPC checks run separately via `npm run test:live`.
- `npm run demo` runs 12 non-destructive demo scenarios (no private key, no wallet, no broadcast).
- `npm pack --dry-run` includes `dist`, contracts, core docs, `SKILL.md`, and the default policy.

<details>
<summary>The 12 demo scenarios</summary>

1. `safehands_wallet_health` returns read-only/default wallet status.
2. `safehands_preflight_check` allows a small PROS payment intent on Pharos Pacific Mainnet.
3. `safehands_preflight_check` blocks an unlimited USDC approval.
4. `token_registry_status` recognizes Pacific Mainnet USDC from the active mainnet registry.
5. `safehands_x402_preflight` validates an x402 URL, amount, and Pacific USDC payment token without signing.
6. `x402_pay_and_fetch` fetches a free endpoint without payment.
7. `x402_pay_and_fetch` refuses paid execution while write tools are disabled.
8. SSRF protection blocks localhost/private-IP fetches by default.
9. `send_payment` fails closed because write tools are disabled by default.
10. `explain_risk` returns a human-readable reason for the blocked approval.
11. **Tokenized-asset (RWA) transfer compliance**: an approval on an unregistered asset token with an unverified spender returns `REQUIRE_CONFIRMATION` (risk `MEDIUM`).
12. **Real-Fi settlement cap**: an x402/USDC settlement over the active policy cap returns `BLOCK` (risk `HIGH`).

</details>

`npm run test:contracts` is available for Solidity tests when the Hardhat compiler is available. Some environments need network access or a cached compiler to run it.

## 3. What to check

### Read-only SafeHands behavior

- `safehands_preflight_check` returns ALLOW/BLOCK/REQUIRE_CONFIRMATION decisions.
- `token_registry_status` uses the active network registry.
- `safehands_x402_preflight` validates URL, amount, token, chain, and signer readiness without paying.
- `safehands_wallet_health` works without a private key.

### Gated execution behavior

Execution tools are disabled by default. To enable them intentionally, the operator must configure the relevant flags, signer mode, funding, policy limits, and authorization. Write/execution tools are **experimental and unaudited**: they ship disabled and are opt-in, self-hosted, single-tenant only.

Typical gates:

1. `WRITE_TOOLS_ENABLED=true`
2. signer or managed wallet available
3. funded wallet
4. per-agent policy limits
5. preflight decision not blocked
6. managed-wallet authorization when required

### Token consistency

Pacific Mainnet token-aware tools must use Pacific Mainnet token addresses. If a token such as USDT is not configured for Pacific Mainnet, tools should return `UNSUPPORTED_TOKEN` or a structured unsupported entry instead of querying an Atlantic/testnet address.

## 4. Key files

| File | Purpose |
|---|---|
| `src/index.ts` | MCP server registering 33 tools |
| `src/lib/constants.ts` | network/token/x402 constants and active-network helpers |
| `src/tools/tokenRegistryStatus.ts` | active-network token classification |
| `src/lib/policy/actionPolicyEngine.ts` | deterministic policy engine |
| `src/tools/safehandsX402Preflight.ts` | x402 preflight |
| `src/tools/x402PayAndFetch.ts` | gated x402 fetch/payment flow |
| `contracts/SafeHandsRegistry.sol` | operator/agent registry and risk-score lookup |
| `contracts/SafeHandsAttestation.sol` | immutable proof ledger |
| `anvita/safehands/SKILL.md` | Anvita hosted Skill metadata |
| `anvita/safehands/assets/` | Skill Engine network/token/contract assets |

## 5. Default network

```text
Network:  Pharos Pacific Mainnet
Chain ID: 1672
Native:   PROS
RPC:      https://rpc.pharos.xyz
Explorer: https://www.pharosscan.xyz
```

Atlantic Testnet remains available for compatibility through `SAFEHANDS_NETWORK=atlantic-testnet`, but Pacific Mainnet is the default.

## 6. Security defaults

```env
WALLET_MODE=none
WRITE_TOOLS_ENABLED=false
ALLOW_UNLIMITED_APPROVAL=false
ALLOW_LOCAL_X402_FETCH=false
```

These defaults make SafeHands safe to review without custody or transaction broadcast.
