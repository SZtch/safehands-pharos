# Security Policy: SafeHands-Pharos

## Scope

SafeHands is a **mainnet-first, read-only-by-default** transaction firewall for AI agents on **Pharos Pacific (chain 1672)**: read/check/analyze runs on mainnet, and the hosted backend holds no keys. **Attestations publish on Pacific Mainnet using a segregated operational key**. The safety architecture is production-inspired but is **not audited for mainnet custody**, which is why user execution/signing remains strictly offline/self-hosted.

## Threat Model

SafeHands protects agents from:

- Unintended **execution/signing on mainnet**, blocked **by default**: the hosted/default posture ships `WRITE_TOOLS_ENABLED=false` and holds no keys, so only read-only checks run on Pacific Mainnet. Self-hosted operators can opt in to execution via explicit env flags (see "Self-Hosted Backend"); those write paths are experimental and unaudited.
- Unlimited token approvals (blocked by default)
- SSRF via x402 URLs (localhost, private IPs, metadata IPs, IPv6 local all blocked)
- Overspending (per-tx + daily caps enforced; swaps of tokens that cannot be priced against the USD caps, outside PROS/WPROS/USDC/USDT and the official registry, are denied by default rather than silently uncounted)
- Executing/approving a token whose **security intelligence is missing** (GoPlus outage or token not yet indexed): the direct write path fails closed with `TOKEN_INTEL_UNAVAILABLE`; a caller `confirm` cannot substitute for a review that never happened. Registry-canonical tokens (identity verified on the official token registry) remain confirmable.
- Unauthorized managed wallet execution for the heavier write paths: swap/payment/approve via a custodial wallet require SafeHandsRegistry authorization (`REQUIRE_AUTHORIZED_AGENT_FOR_WRITE`, default on). x402 is permissionless-first: self-signed x402 needs no authorization, and managed x402 is allowlist-gated only when `REQUIRE_AUTHORIZED_AGENT_FOR_X402=true` is opted in.
- Invalid amounts, zero addresses, unknown tokens (strict validation)
- Sends/approvals to operator-denylisted recipients (hard-BLOCK via `SAFEHANDS_RECIPIENT_DENYLIST`; empty by default, no fabricated scam list. Deeper address-poisoning / first-time-recipient checks are indexer-backed and deferred, not faked.)
- Prompt/runtime injection of policy limits (policy stored in files, not runtime params)

**Confirmation trust anchor.** The `confirm=true` flag accepted by the soft decision tiers (`REQUIRE_CONFIRMATION` / `REQUIRE_TOKEN_REVIEW`) is **caller-attested**: it is supplied by the calling agent, the very party SafeHands is guarding. The real trust anchor is therefore the **MCP host / human operator** who relays that confirmation; SafeHands cannot verify that a human actually reviewed the action. Hard stops (`BLOCK`, `REQUIRE_FUNDING`, missing token intel) never accept it, and the HTTP broadcast relay refuses confirmation-tier records entirely (no trusted confirmation channel exists there). See `docs/DECISION_CONTRACT.md`.

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

## Self-Hosted Backend: Security Profile

If you optionally self-host the reference backend on a public host, run it under the
**Mainnet Production Profile** and keep it zero-custody. A startup guard
(`src/lib/productionGuards.ts`) enforces this when `NODE_ENV=production`:

- **Zero-custody, enforced.** The public host must set `WALLET_MODE=none` and
  `WRITE_TOOLS_ENABLED=false`. Managed execution (`WALLET_MODE=managed-mainnet` +
  `WRITE_TOOLS_ENABLED=true`) **fails fast at boot** on a public host unless the
  operator explicitly accepts the custody risk with
  `SAFEHANDS_ALLOW_MANAGED_ON_PUBLIC=true` (self-hosted single-tenant only).
- **Wallet separation (three roles).**
  - **Owner / deployer wallet**: governs the contracts. **Never store it on
    a container host (Docker / VPS / Fly)** or any hosted env; use it locally for
    deployment only.
  - **Attester wallet** (`SAFEHANDS_ATTESTER_PRIVATE_KEY`): gas-only, dedicated,
    **low balance**; only publishes attestations / risk records after validation.
  - **x402 facilitator wallet** (`X402_FACILITATOR_PRIVATE_KEY`): gas-only,
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
  with no persistent volume). Run a single instance; no horizontal replicas
  (single authoritative state domain).
- **Not formally audited.** The safety architecture is production-inspired but has
  **not** undergone a formal external security audit.

See [`docs/PRODUCTION_BACKEND.md`](docs/PRODUCTION_BACKEND.md) for the self-hosted backend profile and its single-instance, single-state-domain deployment posture.

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

**Operator-trust caveat.** The registry/attestation contracts are the intended trust anchor, but they are *operator-permissioned*: any address the owner has authorized can call `commitRiskRoot` (SafeHandsRiskRegistry) or `attest` (SafeHandsAttestation). A compromised or malicious authorized operator could therefore publish a poisoned risk root or mint a reputation attestation. The contracts are otherwise sound (`Ownable2Step`, `renounceOwnership` disabled, double-hashed Merkle leaves, write-once attestations, no reentrancy), so the centralization of the *authorized-operator set* is the real residual trust assumption whenever the registry is presented as an oracle. Consumers should treat published risk roots as **operator-attested, not trustless**, and pin/verify the operator set they rely on.

## Reporting Vulnerabilities

If you discover a security issue, please open a GitHub issue at [github.com/SZtch/safehands-pharos/issues](https://github.com/SZtch/safehands-pharos/issues) or contact the maintainer directly.

## Network & Execution Disclaimer

SafeHands is **mainnet-first for read/check/analyze on Pharos Pacific (1672)** and holds no keys in hosted mode. **Execution and signing are kept entirely offline**: mainnet *execution* is blocked by design on the hosted server. The safety architecture is production-inspired but has not undergone formal security audit.

## Runtime dependency audit note

`npm audit` currently reports vulnerabilities in the Hardhat/Mocha developer-tooling tree (`@nomicfoundation/hardhat-toolbox-viem`, `hardhat-ignition`, `mocha`, and transitive packages such as `lodash-es`, `serialize-javascript`, and `elliptic`). These packages are used for local contract testing and deployment tooling, not by the production SafeHands API/x402 runtime path.

For the Mainnet Production Profile (Single-Instance Production Architecture), deploy with:

```bash
npm ci                                  # dev deps included: tsc lives there; the prepare hook compiles dist/
npm prune --omit=dev                    # then drop dev tooling (Hardhat/Mocha/tsc) from the host
NODE_ENV=production npm run start:api   # the boot guards only run with NODE_ENV=production; always set it
```

(`npm ci --omit=dev` alone cannot work here: the `prepare` hook runs `tsc`, which is a devDependency. On container hosts, prefer the repo `Dockerfile`; its multi-stage build does the same compile-then-prune split.)

Do not run Hardhat/Mocha tooling on the public API host. A forced audit fix can downgrade/change Hardhat toolbox versions and may break the Hardhat 3 setup, so it is intentionally not applied blindly. Track these as dev-tooling findings and re-run `npm audit` after Hardhat/Mocha publish compatible patched releases.
