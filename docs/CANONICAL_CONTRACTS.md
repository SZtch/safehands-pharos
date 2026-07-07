# Canonical Pharos Contracts

SafeHands acts as an intelligent firewall for AI Agents on Pharos. A critical part of its Policy Engine is distinguishing between random unverified contracts and official, audited ecosystem infrastructure.

This document serves as the ground truth for all canonical contracts recognized natively by the SafeHands Preflight Engine.

> [!TIP]
> When an agent interacts with any of these contracts, SafeHands recognizes it as **Trusted Infrastructure** and evaluates the payload intelligently, drastically reducing false positives.

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

## 2. DODO & FaroSwap Infrastructure (DEX)

SafeHands natively integrates with DODO / FaroSwap for price discovery and agent swaps. 

> **Background:** FaroSwap is powered by DODO Dexpert, built on top of a robust infrastructure refined over five years of on-chain trading activity. This architecture combines flexibility, gas efficiency, and modular design — enabling FaroSwap to adapt quickly to new use cases, especially within the emerging RWA narrative. The core team behind FaroSwap brings together former operators from top-tier exchanges, wallets, and L1 blockchains, combining technical depth with proven go-to-market expertise.

These contracts are verified as safe routing infrastructure.

| Version | Description | Address |
| --- | --- | --- |
| DODOV2 | Multicall | `0x0246DffDa649e877CFd0951837332B4690fAD1EB` |
| DODO | MulticallWithValid | `0x701855ae3a8b2A989DC8ACCf02Dd2b96f8B21671` |
| DODO | DODOSellHelper | `0x27D4236CF46842E5eC1A21C585654F07B00932a1` |
| DODO | DODOSwapCalcHelper | `0xF8FCF810B5DC0715655A1Ed2ef75d6e35e3C0f25` |
| DODO | ERC20Helper | `0x9AC12A5a3AAF3d71b2beFE1F3eE8bA9820F4a591` |
| DODO | DODOCalleeHelper | `0x091341395E94517E6960c5fAF95e81CdAD92Fe0d` |
| DODO | DODOV1PmmHelper | `0x75EF0F8c1c31dD307451B3A11B324b3125471Ee2` |
| DODO | DODOV2RouteHelper | `0xe9Fc1c26901AF258EdCC60a258A7f0228b3639d8` |
| DODO | CloneFactory | `0x114CD7D3f8a994139620aF07a4cEA444ab28968c` |
| DODO | DODOApprove | `0x73CAfc894dBfC181398264934f7Be4e482fc9d40` |
| DODO | DODOApproveProxy | `0x7c25C06777305e632218aDFF9763E3fC049Dd0Db` |
| DODO | DODOV2Proxy02 | `0x4b177AdEd3b8bD1D5D747F91B9E853513838Cd49` |
| DODO | DODODspProxy | `0x3b5C0f0ca61d9C92e676C369B31545f4Fe003b56` |
| Uniswap | UniswapV2Router02 | `0xf05Af5E9dC3b1dd3ad0C087BD80D7391283775e0` |
| Uniswap | SwapRouter | `0x259C9EBBE307bb0aF410e103202662667254d062` |

*(This registry includes factories, fee models, and adapters which are recognized by the policy engine as DEX infrastructure).*

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
