// ─── WalletStore ────────────────────────────────────────────────────────
// Abstraction for storing managed agent wallets (Pharos Pacific Mainnet).
// Private keys are AES-256-GCM encrypted under a memory-hard scrypt KDF before
// storage (versioned "sh2:" format). Pre-scrypt AES records (SHA-256-derived key)
// are still read for migration. The old XOR-obfuscation path is REMOVED — it was
// not encryption. Local AES-256-GCM is NOT KMS/HSM-grade — use a DEDICATED,
// low-value operator wallet for managed execution, never a primary wallet.
// ────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { randomBytes, createCipheriv, createDecipheriv, createHash, scryptSync } from "node:crypto";

export interface StoredWallet {
  agentId: string;
  address: string;
  encryptedKey: string; // AES-256-GCM encrypted private key ("sh2:" scrypt, or legacy pure-hex SHA-256)
  environment: "pacific-mainnet" | "pacific-mainnet";
  chainId: 1672 | 688689;
  isMainnet: boolean;
  createdAt: string;
}

export interface WalletStoreInterface {
  get(agentId: string): Promise<StoredWallet | null>;
  set(agentId: string, wallet: StoredWallet): Promise<void>;
  has(agentId: string): Promise<boolean>;
}

// ─── In-Memory Store (tests + default) ─────────────────────────────────

class InMemoryWalletStore implements WalletStoreInterface {
  private store = new Map<string, StoredWallet>();

  async get(agentId: string): Promise<StoredWallet | null> {
    return this.store.get(agentId) ?? null;
  }

  async set(agentId: string, wallet: StoredWallet): Promise<void> {
    this.store.set(agentId, wallet);
  }

  async has(agentId: string): Promise<boolean> {
    return this.store.has(agentId);
  }
}

// ─── File Store (local dev) ─────────────────────────────────────────────

class FileWalletStore implements WalletStoreInterface {
  private path: string;
  private data: Record<string, StoredWallet> = {};

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      try {
        this.data = JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        this.data = {};
      }
    }
  }

  async get(agentId: string): Promise<StoredWallet | null> {
    return this.data[agentId] ?? null;
  }

  async set(agentId: string, wallet: StoredWallet): Promise<void> {
    this.data[agentId] = wallet;
    // Atomic write: write to .tmp then rename to avoid corruption on crash
    const tmpPath = `${this.path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
    renameSync(tmpPath, this.path);
  }

  async has(agentId: string): Promise<boolean> {
    return agentId in this.data;
  }
}

// ─── AES-256-GCM Encryption (scrypt KDF) ───────────────────────────────
// New wallets derive the AES key with a memory-hard scrypt KDF and a per-record
// random salt, so a leaked WALLET_ENCRYPTION_KEY is far costlier to brute-force
// than the old single-pass SHA-256 derivation. Ciphertext is versioned:
//   "sh2:" + hex(salt[16] || iv[12] || tag[16] || ciphertext)  ← current (scrypt)
//   <pure-hex>   iv[12] || tag[16] || ciphertext               ← legacy read-only
//                (SHA-256-derived key; still decryptable for migration)
// The old XOR path ("0x"-prefixed) is REMOVED — it was obfuscation, not encryption.

const SCRYPT_VERSION_PREFIX = "sh2:";
const SCRYPT_SALT_BYTES = 16;
// N=16384,r=8,p=1 → ~16 MB, ~10-30 ms per derivation (once per managed signer resolve).
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function deriveKeyScrypt(encryptionKey: string, salt: Buffer): Buffer {
  return scryptSync(encryptionKey, salt, 32, SCRYPT_PARAMS);
}

/** Legacy single-pass SHA-256 KDF — read-only, for decrypting pre-scrypt wallets. */
function deriveKeyLegacySha256(encryptionKey: string): Buffer {
  return createHash("sha256").update(encryptionKey).digest();
}

/**
 * Encrypts a private key with AES-256-GCM under a scrypt-derived key.
 * Output: "sh2:" + hex(salt(16) || iv(12) || tag(16) || ciphertext).
 */
export function encryptKey(privateKey: string, encryptionKey: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = deriveKeyScrypt(encryptionKey, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(privateKey.replace(/^0x/, ""), "hex");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SCRYPT_VERSION_PREFIX + Buffer.concat([salt, iv, tag, encrypted]).toString("hex");
}

/**
 * Decrypts a private key. Supports the current "sh2:" scrypt format and the
 * legacy pure-hex SHA-256 AES-256-GCM format (read-only, for migration). The
 * removed XOR path ("0x"-prefixed) is rejected — those wallets must be recreated.
 */
export function decryptKey(encrypted: string, encryptionKey: string): string {
  if (encrypted.startsWith("0x")) {
    throw new Error(
      "Legacy XOR-obfuscated wallet is no longer supported (it was not real encryption). " +
        "Re-create the managed wallet so it is stored under AES-256-GCM + scrypt.",
    );
  }

  if (encrypted.startsWith(SCRYPT_VERSION_PREFIX)) {
    const data = Buffer.from(encrypted.slice(SCRYPT_VERSION_PREFIX.length), "hex");
    const salt = data.subarray(0, SCRYPT_SALT_BYTES);
    const iv = data.subarray(SCRYPT_SALT_BYTES, SCRYPT_SALT_BYTES + 12);
    const tag = data.subarray(SCRYPT_SALT_BYTES + 12, SCRYPT_SALT_BYTES + 28);
    const ciphertext = data.subarray(SCRYPT_SALT_BYTES + 28);
    const key = deriveKeyScrypt(encryptionKey, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return "0x" + decrypted.toString("hex");
  }

  // Legacy pure-hex AES-256-GCM (SHA-256-derived key) — decrypt for migration only.
  const data = Buffer.from(encrypted, "hex");
  const key = deriveKeyLegacySha256(encryptionKey);
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return "0x" + decrypted.toString("hex");
}

// ─── Encryption key resolution ─────────────────────────────────────────

// Random per-process fallback key — never hardcoded, never reused across restarts
const IN_MEMORY_FALLBACK_KEY = randomBytes(32).toString("hex");

/**
 * Returns the effective encryption key.
 * - Persistent store: WALLET_ENCRYPTION_KEY must be set (wallets won't survive restarts otherwise).
 * - In-memory store: falls back to a random per-process key.
 */
export function getEffectiveEncryptionKey(): string {
  return process.env.WALLET_ENCRYPTION_KEY || IN_MEMORY_FALLBACK_KEY;
}

// ─── Factory ────────────────────────────────────────────────────────────

function createWalletStore(): WalletStoreInterface {
  const storePath = process.env.WALLET_STORE_PATH;
  if (storePath) {
    return new FileWalletStore(storePath);
  }
  return new InMemoryWalletStore();
}

export function usesPersistentWalletStore(): boolean {
  return Boolean(process.env.WALLET_STORE_PATH);
}

export const walletStore = createWalletStore();
