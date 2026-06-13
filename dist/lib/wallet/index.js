// ─── WalletStore ────────────────────────────────────────────────────────
// Abstraction for storing managed testnet agent wallets.
// Private keys are AES-256-GCM encrypted before storage.
// Legacy XOR-obfuscated keys (starting with "0x") are transparently migrated
// on first read. NOT mainnet-grade KMS — testnet only.
// ────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
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
        // Atomic write: write to .tmp then rename to avoid corruption on crash
        const tmpPath = `${this.path}.tmp`;
        writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
        renameSync(tmpPath, this.path);
    }
    async has(agentId) {
        return agentId in this.data;
    }
}
// ─── AES-256-GCM Encryption ────────────────────────────────────────────
function deriveKey(encryptionKey) {
    return createHash("sha256").update(encryptionKey).digest();
}
/**
 * Encrypts a private key with AES-256-GCM.
 * Output format: <iv(12B)><tag(16B)><ciphertext> as hex string (no 0x prefix).
 */
export function encryptKey(privateKey, encryptionKey) {
    const key = deriveKey(encryptionKey);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plain = Buffer.from(privateKey.replace(/^0x/, ""), "hex");
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("hex");
}
/**
 * Decrypts a private key. Handles both:
 * - New AES-256-GCM format (pure hex, no 0x prefix)
 * - Legacy XOR format (starts with "0x") — transparently supported for migration
 */
export function decryptKey(encrypted, encryptionKey) {
    if (encrypted.startsWith("0x")) {
        // Legacy XOR path — symmetric, same operation
        return _xorObfuscate(encrypted, encryptionKey);
    }
    const key = deriveKey(encryptionKey);
    const data = Buffer.from(encrypted, "hex");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return "0x" + decrypted.toString("hex");
}
// ─── Legacy XOR helpers (kept for migration read path only) ────────────
function _xorObfuscate(privateKey, encryptionKey) {
    const keyBytes = Buffer.from(encryptionKey.padEnd(32, "0").slice(0, 32));
    const pkBytes = Buffer.from(privateKey.replace("0x", ""), "hex");
    const result = Buffer.alloc(pkBytes.length);
    for (let i = 0; i < pkBytes.length; i++) {
        result[i] = pkBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return "0x" + result.toString("hex");
}
/** @deprecated Use encryptKey / decryptKey. Kept for callers that haven't migrated yet. */
export function obfuscateKey(privateKey, encryptionKey) {
    return _xorObfuscate(privateKey, encryptionKey);
}
/** @deprecated Use decryptKey. */
export function deobfuscateKey(obfuscated, encryptionKey) {
    return _xorObfuscate(obfuscated, encryptionKey);
}
// ─── Encryption key resolution ─────────────────────────────────────────
// Random per-process fallback key — never hardcoded, never reused across restarts
const IN_MEMORY_FALLBACK_KEY = randomBytes(32).toString("hex");
/**
 * Returns the effective encryption key.
 * - Persistent store: WALLET_ENCRYPTION_KEY must be set (wallets won't survive restarts otherwise).
 * - In-memory store: falls back to a random per-process key.
 */
export function getEffectiveEncryptionKey() {
    return process.env.WALLET_ENCRYPTION_KEY || IN_MEMORY_FALLBACK_KEY;
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