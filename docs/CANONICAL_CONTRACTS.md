# Canonical Pharos Contracts

SafeHands is the pre-execution transaction firewall for AI agents on Pharos. A critical part of its Policy Engine is distinguishing between random unverified contracts and official, audited ecosystem infrastructure.

This document serves as the ground truth for the official Pharos canonical contracts recognized natively by the SafeHands Preflight Engine (§1) and the canonical token registry (§3). Registry-**VERIFIED** ecosystem protocol contracts (e.g. Morpho Blue, verified from first-party evidence) live in the canonical ecosystem registry, `src/data/ecosystemRegistry.data.ts` — that registry is the single source of address-level trust.

> [!TIP]
> Recognition here is **counterparty recognition, never payload leniency**: a canonical contract is a known counterparty, but a risky payload stays risky — an unlimited approval to Permit2 still requires confirmation, and a decoded drainer pattern still blocks regardless of the target being listed on this page.

## 1. Account Abstraction & Infrastructure (Canonical Contracts)

### Pacific Mainnet
| Contract Name | Description | Address |
| --- | --- | --- |
| Create2Deployer | Helper for CREATE2 opcode usage | `0x13b0D85CcB8bf860b6b79AF3029fCA081AE9beF2` |
| Foundry Deterministic Deploy | Integrated with Foundry for deterministic deployments | `0x4e59b44847b379578588920ca78fbf26c0b4956c` |
| MultiCall3 | Allows bundling multiple transactions | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| GnosisSafe (v1.3.0) | Multisignature wallet | `0x69f4D1788e39c87893C980c06EdF4b7f686e2938` |
| GnosisSafeL2 (v1.3.0) | Events-based implementation of GnosisSafe | `0xfb1bffC9d739B8D520DaF37dF666da4C687191EA` |
| SafeSingletonFactory | Safe's deterministic deployment proxy | `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` |
| CreateX | Advanced cross-chain deployment factory | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` |
| MultiSendCallOnly (v1.3.0) | Batches multiple transactions (calls only) | `0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B` |
| MultiSend (v1.3.0) | Batches multiple transactions | `0x998739BFdAAdde7C933B942a68053933098f9EDa` |
| Permit2 | Next-generation token approval system | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| ERC-4337 EntryPoint (v0.7) | ERC-4337 entry point for account abstraction | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| ERC-4337 SenderCreator (v0.7) | Helper for EntryPoint | `0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C` |
| ERC-4337 EntryPoint (v0.6) | Account abstraction entry point (v0.6) | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| ERC-4337 SenderCreator (v0.6) | Helper contract used by EntryPoint v0.6 | `0x7fc98430eAEdbb6070B35B39D798725049088348` |

### Atlantic Testnet
| Contract Name | Description | Address |
| --- | --- | --- |
| Create2Deployer | Helper for CREATE2 opcode usage | `0x13b0D85CcB8bf860b6b79AF3029fCA081AE9beF2` |
| DeterministicDeploymentProxy | Integrated with Foundry for deterministic deployments | `0x4e59b44847b379578588920ca78fbf26c0b4956c` |
| MultiCall3 | Allows bundling multiple transactions | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| GnosisSafe (v1.3.0) | Multisignature wallet | `0x69f4D1788e39c87893C980c06EdF4b7f686e2938` |
| GnosisSafeL2 (v1.3.0) | Events-based implementation of GnosisSafe | `0xfb1bffC9d739B8D520DaF37dF666da4C687191EA` |
| MultiSendCallOnly (v1.3.0) | Batches multiple transactions (calls only) | `0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B` |
| MultiSend (v1.3.0) | Batches multiple transactions | `0x998739BFdAAdde7C933B942a68053933098f9EDa` |
| Permit2 | Next-generation token approval system | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| EntryPoint (v0.7.0) | ERC-4337 entry point for account abstraction | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| SenderCreator (v0.7.0) | Helper for EntryPoint | `0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C` |

---

## 2. DODO / FaroSwap routing addresses — restriction-only containment, NOT trust

The self-hosted swap path fetches quotes from the DODO route API (which serves
FaroSwap liquidity on Pharos). Before any gated execution, `execute_swap` checks the
quote's router (`to`) and approval target against **operator-configurable
allowlists** — `DODO_ROUTER_ALLOWLIST` / `DODO_SPENDER_ALLOWLIST` (defaults in
`src/lib/constants.ts`). A quote pointing anywhere outside the allowlist **fails
closed**.

**These allowlists are containment, not verification** (the enforcement code says
exactly that): being on the list means "the only addresses a swap is *permitted* to
touch", never "this address is trusted/safe". They grant no risk relaxation anywhere —
`spenderVerified` is derived from the canonical ecosystem registry only, and FaroSwap
remains **UNVERIFIED** there until its own documentation publishes citable Pharos
mainnet addresses. The shipped defaults are testnet-provenance; mainnet operators
should set the allowlists themselves after verifying the route API's actual targets.

---

## 3. Token Registry

SafeHands maintains strict token canonicalization to prevent agents from interacting with malicious honeypot tokens.

### Pacific Mainnet Tokens
| Symbol | Name | Pharos Address |
| --- | --- | --- |
| WPROS | Wrapped PROS | `0x52c48d4213107b20bc583832b0d951fb9ca8f0b0` |
| USDC | USDC (Circle Deployed) | `0xc879c018db60520f4355c26ed1a6d572cdac1815` |
| LINK | Chainlink Token | `0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29` |
| WETH | Wrapped ETH | `0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9` |

### Atlantic Testnet Tokens
| Symbol | Name | Pharos Address |
| --- | --- | --- |
| USDC | USD Coin | `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` |
| USDT | Tether USD | `0xE7E84B8B4f39C507499c40B4ac199B050e2882d5` |
| WBTC | Wrapped BTC | `0x0c64F03EEa5c30946D5c55B4b532D08ad74638a4` |
| WETH | Wrapped ETH | `0x7d211F77525ea39A0592794f793cC1036eEaccD5` |
| WPROS | Wrapped PROS | `0x838800b758277CC111B2d48Ab01e5E164f8E9471` |
