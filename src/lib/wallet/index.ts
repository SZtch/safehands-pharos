// ─── WalletStore ────────────────────────────────────────────────────────
// Abstraction for storing managed testnet agent wallets.
// Private keys are XOR-obfuscated with encryption key before storage.
// NOT mainnet-grade encryption — testnet only.
// ────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from "fs";

export interface StoredWallet {
  agentId: string;
  address: string;
  encryptedKey: string; // obfuscated private key
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
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  async has(agentId: string): Promise<boolean> {
    return agentId in this.data;
  }
}

// ─── Key Obfuscation (testnet only) ────────────────────────────────────

export function obfuscateKey(privateKey: string, encryptionKey: string): string {
  const keyBytes = Buffer.from(encryptionKey.padEnd(32, "0").slice(0, 32));
  const pkBytes = Buffer.from(privateKey.replace("0x", ""), "hex");
  const result = Buffer.alloc(pkBytes.length);
  for (let i = 0; i < pkBytes.length; i++) {
    result[i] = pkBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return "0x" + result.toString("hex");
}

export function deobfuscateKey(obfuscated: string, encryptionKey: string): string {
  return obfuscateKey(obfuscated, encryptionKey); // XOR is symmetric
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
