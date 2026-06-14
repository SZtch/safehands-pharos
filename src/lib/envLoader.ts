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

// 2. Auto-resolve wallet persistence so managed wallets survive restarts
//    without requiring explicit config from the user.
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
