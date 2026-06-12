export interface StoredWallet {
    agentId: string;
    address: string;
    encryptedKey: string;
    environment: "atlantic-testnet";
    chainId: 688689;
    isMainnet: false;
    createdAt: string;
}
export interface WalletStoreInterface {
    get(agentId: string): Promise<StoredWallet | null>;
    set(agentId: string, wallet: StoredWallet): Promise<void>;
    has(agentId: string): Promise<boolean>;
}
export declare function obfuscateKey(privateKey: string, encryptionKey: string): string;
export declare function deobfuscateKey(obfuscated: string, encryptionKey: string): string;
export declare function usesPersistentWalletStore(): boolean;
export declare const walletStore: WalletStoreInterface;
//# sourceMappingURL=index.d.ts.map