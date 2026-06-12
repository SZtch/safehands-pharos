import { type PublicClient, type WalletClient, type Transport, type Chain, type Account } from "viem";
export declare const pharosAtlantic: {
    blockExplorers: {
        readonly default: {
            readonly name: "PharosScan";
            readonly url: string;
        };
    };
    blockTime?: number | undefined | undefined;
    contracts?: {
        [x: string]: import("viem").ChainContract | {
            [sourceId: number]: import("viem").ChainContract | undefined;
        } | undefined;
        ensRegistry?: import("viem").ChainContract | undefined;
        ensUniversalResolver?: import("viem").ChainContract | undefined;
        multicall3?: import("viem").ChainContract | undefined;
        erc6492Verifier?: import("viem").ChainContract | undefined;
    } | undefined;
    ensTlds?: readonly string[] | undefined;
    id: number;
    name: `Pharos ${string}`;
    nativeCurrency: {
        readonly name: "PHRS";
        readonly symbol: "PHRS";
        readonly decimals: 18;
    };
    experimental_preconfirmationTime?: number | undefined | undefined;
    rpcUrls: {
        readonly default: {
            readonly http: readonly [string];
        };
    };
    sourceId?: number | undefined | undefined;
    testnet: true;
    custom?: Record<string, unknown> | undefined;
    extendSchema?: Record<string, unknown> | undefined;
    fees?: import("viem").ChainFees<undefined> | undefined;
    formatters?: undefined;
    prepareTransactionRequest?: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | [fn: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | undefined, options: {
        runAt: readonly ("beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters")[];
    }] | undefined;
    serializers?: import("viem").ChainSerializers<undefined, import("viem").TransactionSerializable> | undefined;
    verifyHash?: ((client: import("viem").Client, parameters: import("viem").VerifyHashActionParameters) => Promise<import("viem").VerifyHashActionReturnType>) | undefined;
};
export declare const publicClient: PublicClient<Transport, Chain>;
/**
 * Creates a wallet client for signing and sending transactions.
 * Private key is passed per-request and NEVER stored.
 */
export declare function createPharosWalletClient(privateKey: `0x${string}`): WalletClient<Transport, Chain, Account>;
export declare function createPharosWalletClientFromAccount(account: Account): WalletClient<Transport, Chain, Account>;
export declare function getExplorerUrl(txHash: string): string;
//# sourceMappingURL=pharosClient.d.ts.map