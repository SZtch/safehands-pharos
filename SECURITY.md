# Security Policy — SafeHands-Pharos

## Scope

SafeHands is a **mainnet-first, read-only** safety gateway for AI agents on **Pharos Pacific (chain 1672)**: read/check/analyze runs on mainnet by default, and the hosted backend holds no keys. **Attestations publish on Pacific Mainnet using a segregated operational key**. The safety architecture is production-inspired but is **not audited for mainnet custody**, which is why user execution/signing remains strictly offline/self-hosted.

## Threat Model

SafeHands protects agents from:

- Unintended **execution/signing on mainnet** (mainnet execution/write/publish is blocked by design; only read-only checks run on Pacific Mainnet)
- Unlimited token approvals (blocked by default)
- SSRF via x402 URLs (localhost, private IPs, metadata IPs, IPv6 local all blocked)
- Overspending (per-tx + daily caps enforced)
- Unauthorized managed wallet execution for the heavier write paths — swap/payment/approve via a custodial wallet require SafeHandsRegistry authorization (`REQUIRE_AUTHORIZED_AGENT_FOR_WRITE`, default on). x402 is permissionless-first: self-signed x402 needs no authorization, and managed x402 is allowlist-gated only when `REQUIRE_AUTHORIZED_AGENT_FOR_X402=true` is opted in.
- Invalid amounts, zero addresses, unknown tokens (strict validation)
- Sends/approvals to operator-denylisted recipients (hard-BLOCK via `SAFEHANDS_RECIPIENT_DENYLIST`; empty by default — no fabricated scam list. Deeper address-poisoning / first-time-recipient checks are indexer-backed and deferred, not faked.)
- Prompt/runtime injection of policy limits (policy stored in files, not runtime params)

## What SafeHands Does NOT Protect Against

- Smart contract vulnerabilities in third-party tokens or pools
- Private key compromise at the OS/process level
- Denial of service against the RPC endpoint
- Social engineering of the human operator

## Key Management

- Managed wallets are encrypted with AES-256-GCM (not KMS/Vault grade)
- Private keys are never returned in tool responses or logged
- The `SAFEHANDS_ATTESTER_PRIVATE_KEY` is an operational-only key for publishing attestations and must never be committed
- `.env` is gitignored; `.env.example` uses placeholders only

## Self-Hosted Backend — Security Profile

If you optionally self-host the reference backend on a public host, run it under the
**Mainnet Production Profile** and keep it zero-custody. A startup guard
(`src/lib/productionGuards.ts`) enforces this when `NODE_ENV=production`:

- **Zero-custody, enforced.** The public host must set `WALLET_MODE=none` and
  `WRITE_TOOLS_ENABLED=false`. Managed execution (`WALLET_MODE=managed-mainnet` +
  `WRITE_TOOLS_ENABLED=true`) **fails fast at boot** on a public host unless the
  operator explicitly accepts the custody risk with
  `SAFEHANDS_ALLOW_MANAGED_ON_PUBLIC=true` (self-hosted single-tenant only).
- **Wallet separation (three roles).**
  - **Owner / deployer wallet** — governs the contracts. **Never store it on
    a container host (Docker / VPS / Fly)** or any hosted env; use it locally for
    deployment only.
  - **Attester wallet** (`SAFEHANDS_ATTESTER_PRIVATE_KEY`) — gas-only, dedicated,
    **low balance**; only publishes attestations / risk records after validation.
  - **x402 facilitator wallet** (`X402_FACILITATOR_PRIVATE_KEY`) — gas-only,
    dedicated, low balance; only settles x402 payments. `X402_PAY_TO` is a receiver
    **address** (no key on the host).
- **Access model.** Public users/agents pay via **x402** (no API-key onboarding).
  API keys (`SAFEHANDS_API_KEYS`) are **optional, admin/internal only**; the free
  read tier stays open (`SAFEHANDS_REQUIRE_API_KEY=false`).
- **CORS.** Tighten `CORS_ORIGIN` / `SAFEHANDS_CORS_ORIGIN` to your domain(s) for
  guarded/paid surfaces in production (wildcard is acceptable only for the public
  read tier; the guard warns on wildcard in production).
- **Durable state.** Mount a persistent volume and set `SAFEHANDS_STATE_DIR` (e.g.
  `/data`); the guard warns if state is ephemeral in production (an ephemeral host
  with no persistent volume). Run a single instance — no horizontal replicas
  (single authoritative state domain).
- **Not formally audited.** The safety architecture is production-inspired but has
  **not** undergone a formal external security audit.

See [`docs/deployment/ARCHITECTURE_DECISION.md`](docs/deployment/ARCHITECTURE_DECISION.md).

## SafeHandsRiskRegistry

| Field | Value |
|---|---|
| Registry Address | `0x428e02bf85412e7242d991cd6725ec59e8b06c8d` |
| Attestation Address | `0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c` |
| Network | Pharos Pacific Mainnet (1672) |
| Authorization | Required for attestation publishing only |

Both addresses are **live on Pharos Pacific Mainnet (1672)** and independently verifiable
(`eth_getCode` returns deployed bytecode; viewable on `https://www.pharosscan.xyz`). The
setup wizard (`src/init.ts`) writes them as defaults; redeploy with
`scripts/deploy-safehands.ts` to override.

Preflight, read-only, user-signed, and env wallet modes do **not** require RiskRegistry authorization.

## Reporting Vulnerabilities

If you discover a security issue, please open a GitHub issue at [github.com/SZtch/safehands-pharos/issues](https://github.com/SZtch/safehands-pharos/issues) or contact the maintainer directly.

## Network & Execution Disclaimer

SafeHands is **mainnet-first for read/check/analyze on Pharos Pacific (1672)** and holds no keys in hosted mode. **Execution and signing are kept entirely offline** — mainnet *execution* is blocked by design on the hosted server. The safety architecture is production-inspired but has not undergone formal security audit.

## Runtime dependency audit note

`npm audit` currently reports vulnerabilities in the Hardhat/Mocha developer-tooling tree (`@nomicfoundation/hardhat-toolbox-viem`, `hardhat-ignition`, `mocha`, and transitive packages such as `lodash-es`, `serialize-javascript`, and `elliptic`). These packages are used for local contract testing and deployment tooling, not by the production SafeHands API/x402 runtime path.

For the Mainnet Production Profile (Single-Instance Production Architecture), deploy with:

```bash
npm ci --omit=dev
npm run build
npm run start:api
```

Do not run Hardhat/Mocha tooling on the public API host. A forced audit fix can downgrade/change Hardhat toolbox versions and may break the Hardhat 3 setup, so it is intentionally not applied blindly. Track these as dev-tooling findings and re-run `npm audit` after Hardhat/Mocha publish compatible patched releases.
