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
/**
 * Encrypts a private key with AES-256-GCM.
 * Output format: <iv(12B)><tag(16B)><ciphertext> as hex string (no 0x prefix).
 */
export declare function encryptKey(privateKey: string, encryptionKey: string): string;
/**
 * Decrypts a private key. Handles both:
 * - New AES-256-GCM format (pure hex, no 0x prefix)
 * - Legacy XOR format (starts with "0x") — transparently supported for migration
 */
export declare function decryptKey(encrypted: string, encryptionKey: string): string;
/** @deprecated Use encryptKey / decryptKey. Kept for callers that haven't migrated yet. */
export declare function obfuscateKey(privateKey: string, encryptionKey: string): string;
/** @deprecated Use decryptKey. */
export declare function deobfuscateKey(obfuscated: string, encryptionKey: string): string;
/**
 * Returns the effective encryption key.
 * - Persistent store: WALLET_ENCRYPTION_KEY must be set (wallets won't survive restarts otherwise).
 * - In-memory store: falls back to a random per-process key.
 */
export declare function getEffectiveEncryptionKey(): string;
export declare function usesPersistentWalletStore(): boolean;
export declare const walletStore: WalletStoreInterface;
//# sourceMappingURL=index.d.ts.map