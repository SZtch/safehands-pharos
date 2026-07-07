// Synchronously load .env from cwd before any other module reads process.env.
// Must be imported as the very first import in index.ts so that wallet store,
// constants, and other modules that read env vars at module-init time see the values.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { randomBytes } from "crypto";

// 1. Load .env
try {
  const text = readFileSync(join(process.cwd(), ".env"), "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !process.env[m[1]]) {
      // Strip surrounding quotes if present
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch {
  // No .env file — environment vars must be set externally (CI, shell, MCP host)
}


// 1b. Backward-compatible env aliases for the full hosted deployment template.
// Keep old variable names working while letting .env.example use clearer SAFEHANDS_* names.
const aliases: Array<[string, string]> = [
  ["SAFEHANDS_ENABLE_MANAGED_WALLET", "MANAGED_WALLET_ENABLED"],
  ["SAFEHANDS_WALLET_ENCRYPTION_KEY", "WALLET_ENCRYPTION_KEY"],
  ["SAFEHANDS_REGISTRY_ADDRESS", "SAFEHANDS_RISK_REGISTRY_ADDRESS"],
  ["PHAROS_PACIFIC_RPC_URL", "PHAROS_RPC_URL"],
];
for (const [from, to] of aliases) {
  if (process.env[from] && !process.env[to]) process.env[to] = process.env[from];
}

// 2. Demo mode now uses mainnet-first default as well.
if (process.argv.includes("--demo") && !process.env.SAFEHANDS_NETWORK) {
  process.env.SAFEHANDS_NETWORK = "pacific-mainnet";
}

// 3. Auto-resolve wallet persistence ONLY when managed wallets are explicitly
//    enabled (WALLET_MODE=managed-mainnet AND MANAGED_WALLET_ENABLED=true), so
//    managed wallets survive restarts. Read-only / preflight / hosted modes must
//    never create .agents/wallets.json or .agents/.key just by importing modules
//    (no key material on disk until managed wallets are actually enabled).
if ((process.env.WALLET_MODE || "none") === "managed-mainnet" && process.env.MANAGED_WALLET_ENABLED === "true") {
  if (!process.env.WALLET_STORE_PATH) {
    process.env.WALLET_STORE_PATH = "./.agents/wallets.json";
  }

  if (!process.env.WALLET_ENCRYPTION_KEY) {
    const storePath = resolve(process.cwd(), process.env.WALLET_STORE_PATH);
    const keyPath = join(dirname(storePath), ".key");
    try {
      if (existsSync(keyPath)) {
        process.env.WALLET_ENCRYPTION_KEY = readFileSync(keyPath, "utf-8").trim();
      } else {
        mkdirSync(dirname(keyPath), { recursive: true });
        const key = randomBytes(32).toString("hex");
        writeFileSync(keyPath, key, { mode: 0o600 });
        process.env.WALLET_ENCRYPTION_KEY = key;
      }
    } catch {
      // File ops failed (read-only FS, permission error) — fall back to in-memory behavior
    }
  }
}
