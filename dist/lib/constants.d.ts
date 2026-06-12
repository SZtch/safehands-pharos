export declare const PHAROS_ENVIRONMENT: string;
export declare const CHAIN_ID: number;
export declare const RPC_URL: string;
export declare const EXPLORER_BASE: string;
export declare const IS_MAINNET = false;
export declare const CHAIN_REGISTRY: {
    readonly pharosAtlanticTestnet: {
        readonly environment: "atlantic-testnet";
        readonly chainId: 688689;
        readonly isMainnet: false;
        readonly rpcUrlEnv: "PHAROS_RPC_URL";
        readonly defaultRpcUrl: "https://atlantic.dplabs-internal.com/";
        readonly explorerUrl: "https://atlantic.pharosscan.xyz/";
        readonly docsSource: "https://docs.pharosnetwork.xyz/developer-guide/hardhat/write-your-first-nft";
    };
};
/** Native PHRS — sentinel address used by DODO API for native token */
export declare const PHRS_ADDRESS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export declare const USDT_ADDRESS: "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5";
/** Primary USDC for Pharos Skill Engine (from official tokens.json) */
export declare const USDC_ADDRESS: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
/** Alternate USDC listed by Circle's contract addresses page (not in Skill Engine tokens.json) */
export declare const CIRCLE_USDC_ADDRESS: "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B";
/** @deprecated Use USDC_ADDRESS instead. Kept for backward compatibility. */
export declare const X402_DEMO_USDC_ADDRESS: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
export declare const TEST_USDC_ADDRESS: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
export declare const WBTC_ADDRESS: "0x0c64F03EEa5c30946D5c55B4b532D08ad74638a4";
export declare const WETH_ADDRESS: "0x7d211F77525ea39A0592794f793cC1036eEaccD5";
export declare const WPHRS_ADDRESS: "0x838800b758277CC111B2d48Ab01e5E164f8E9471";
export declare const TOKEN_REGISTRY: {
    readonly PHRS: {
        readonly symbol: "PHRS";
        readonly address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        readonly decimals: 18;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "native PHRS sentinel address for DODO route API";
        readonly docsSource: "https://docs.pharos.xyz/";
    };
    readonly USDC: {
        readonly symbol: "USDC";
        readonly address: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";
        readonly decimals: 6;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "Pharos Skill Engine USDC — the USDC listed in the official pharos-skill-engine-0.1.0 assets/tokens.json for atlantic-testnet";
        readonly docsSource: "pharos-skill-engine-0.1.0/assets/tokens.json";
        readonly verificationStatus: "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE";
    };
    readonly CIRCLE_USDC: {
        readonly symbol: "CIRCLE_USDC";
        readonly address: "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B";
        readonly decimals: 6;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "Alternate USDC listed by Circle contract addresses page and Pharos docs token registry; not the primary token in Skill Engine tokens.json";
        readonly docsSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses and https://docs.pharos.xyz/getting-started/token-registry";
        readonly verificationStatus: "CIRCLE_REFERENCED_USDC";
    };
    readonly USDT: {
        readonly symbol: "USDT";
        readonly address: "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5";
        readonly decimals: 6;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "canonical Pharos Atlantic Testnet USDT (Tether USD)";
        readonly docsSource: "https://docs.pharos.xyz/getting-started/token-registry";
        readonly verificationStatus: "DOCS_VERIFIED";
    };
    readonly WBTC: {
        readonly symbol: "WBTC";
        readonly address: "0x0c64F03EEa5c30946D5c55B4b532D08ad74638a4";
        readonly decimals: 18;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "canonical Pharos Atlantic Testnet WBTC (Wrapped BTC)";
        readonly docsSource: "https://docs.pharos.xyz/getting-started/token-registry";
        readonly verificationStatus: "DOCS_VERIFIED";
    };
    readonly WETH: {
        readonly symbol: "WETH";
        readonly address: "0x7d211F77525ea39A0592794f793cC1036eEaccD5";
        readonly decimals: 18;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "canonical Pharos Atlantic Testnet WETH (Wrapped ETH)";
        readonly docsSource: "https://docs.pharos.xyz/getting-started/token-registry";
        readonly verificationStatus: "DOCS_VERIFIED";
    };
    readonly WPHRS: {
        readonly symbol: "WPHRS";
        readonly address: "0x838800b758277CC111B2d48Ab01e5E164f8E9471";
        readonly decimals: 18;
        readonly chainId: number;
        readonly environment: string;
        readonly isMainnet: false;
        readonly isCanonical: true;
        readonly isTestToken: true;
        readonly purpose: "canonical Pharos Atlantic Testnet WPHRS (Wrapped PHRS)";
        readonly docsSource: "https://docs.pharos.xyz/getting-started/token-registry";
        readonly verificationStatus: "DOCS_VERIFIED";
    };
};
export declare const TOKEN_DECIMALS: Record<string, number>;
export declare const TOKEN_MAP: Record<string, `0x${string}`>;
export declare const DODO_APPROVE_ADDRESS: "0x4Cf317b8918FbE8A890c01eDAb7d548555Ac2cE9";
export declare const DODO_ROUTE_PROXY_ADDRESS: "0x819829e5CF6e19F9fED92F6b4CC1edF45a2cC4A2";
export declare const POSITION_MANAGER_ADDRESS: "0x1c430d84DD6185b1Ea2d4693e0033799d193542f";
export declare const DODO_API_BASE: string;
export declare const DODO_API_KEY: string | undefined;
export declare const DODO_DEFAULT_SLIPPAGE = 3.225;
export declare const DODO_ROUTE_ENDPOINT = "/route-service/v2/widget/getdodoroute";
export declare const RISK_BLOCK_THRESHOLD = 80;
export declare const RISK_WARN_THRESHOLD = 60;
export declare const MAX_SLIPPAGE_PCT = 5;
export declare const MAX_BALANCE_USAGE_PCT = 90;
export declare const MAX_TX_AMOUNT_PHRS: string;
export declare const MAX_APPROVAL_AMOUNT_USDC: string;
export declare const MAX_DAILY_SPEND_USD: string;
export declare const MAX_X402_PAYMENT_USDC: string;
export declare const X402_PAYMENT_TOKEN_ADDRESS: `0x${string}`;
export declare const RISK_WEIGHTS: {
    readonly liquidityRisk: 0.25;
    readonly slippageRisk: 0.25;
    readonly counterpartyRisk: 0.2;
    readonly balanceRisk: 0.15;
    readonly marketConditionRisk: 0.15;
};
export declare const ERC20_ABI: readonly [{
    readonly name: "approve";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "allowance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "account";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "decimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
}, {
    readonly name: "symbol";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
    }];
}, {
    readonly name: "transfer";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}];
export declare const RISK_REGISTRY_ADDRESS: `0x${string}`;
export declare const RISK_REGISTRY_ABI: readonly [{
    readonly name: "publish";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "wallet";
        readonly type: "address";
    }, {
        readonly name: "score";
        readonly type: "uint256";
    }, {
        readonly name: "riskLevel";
        readonly type: "string";
    }, {
        readonly name: "recommendation";
        readonly type: "string";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "query";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "wallet";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "score";
            readonly type: "uint256";
        }, {
            readonly name: "riskLevel";
            readonly type: "string";
        }, {
            readonly name: "recommendation";
            readonly type: "string";
        }, {
            readonly name: "timestamp";
            readonly type: "uint256";
        }, {
            readonly name: "assessedBy";
            readonly type: "address";
        }];
    }];
}, {
    readonly anonymous: false;
    readonly name: "RiskPublished";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly indexed: true;
        readonly name: "wallet";
        readonly type: "address";
    }, {
        readonly indexed: false;
        readonly name: "score";
        readonly type: "uint256";
    }, {
        readonly indexed: false;
        readonly name: "riskLevel";
        readonly type: "string";
    }, {
        readonly indexed: false;
        readonly name: "assessedBy";
        readonly type: "address";
    }];
}];
//# sourceMappingURL=constants.d.ts.map