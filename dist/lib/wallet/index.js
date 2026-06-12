// ─── WalletStore ────────────────────────────────────────────────────────
// Abstraction for storing managed testnet agent wallets.
// Private keys are XOR-obfuscated with encryption key before storage.
// NOT mainnet-grade encryption — testnet only.
// ────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
// ─── In-Memory Store (tests + default) ─────────────────────────────────
class InMemoryWalletStore {
    store = new Map();
    async get(agentId) {
        return this.store.get(agentId) ?? null;
    }
    async set(agentId, wallet) {
        this.store.set(agentId, wallet);
    }
    async has(agentId) {
        return this.store.has(agentId);
    }
}
// ─── File Store (local dev) ─────────────────────────────────────────────
class FileWalletStore {
    path;
    data = {};
    constructor(path) {
        this.path = path;
        if (existsSync(path)) {
            try {
                this.data = JSON.parse(readFileSync(path, "utf-8"));
            }
            catch {
                this.data = {};
            }
        }
    }
    async get(agentId) {
        return this.data[agentId] ?? null;
    }
    async set(agentId, wallet) {
        this.data[agentId] = wallet;
        writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    }
    async has(agentId) {
        return agentId in this.data;
    }
}
// ─── Key Obfuscation (testnet only) ────────────────────────────────────
export function obfuscateKey(privateKey, encryptionKey) {
    const keyBytes = Buffer.from(encryptionKey.padEnd(32, "0").slice(0, 32));
    const pkBytes = Buffer.from(privateKey.replace("0x", ""), "hex");
    const result = Buffer.alloc(pkBytes.length);
    for (let i = 0; i < pkBytes.length; i++) {
        result[i] = pkBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return "0x" + result.toString("hex");
}
export function deobfuscateKey(obfuscated, encryptionKey) {
    return obfuscateKey(obfuscated, encryptionKey); // XOR is symmetric
}
// ─── Factory ────────────────────────────────────────────────────────────
function createWalletStore() {
    const storePath = process.env.WALLET_STORE_PATH;
    if (storePath) {
        return new FileWalletStore(storePath);
    }
    return new InMemoryWalletStore();
}
export function usesPersistentWalletStore() {
    return Boolean(process.env.WALLET_STORE_PATH);
}
export const walletStore = createWalletStore();
//# sourceMappingURL=index.js.map