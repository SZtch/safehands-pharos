// ─── SignerProvider ─────────────────────────────────────────────────────
// Abstraction layer for signing. Tools never read process.env.PRIVATE_KEY
// directly — they request a signer through this provider.
// ────────────────────────────────────────────────────────────────────────

import { privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";
import { walletStore, decryptKey, getEffectiveEncryptionKey } from "../wallet/index.js";

export type SignerMode = "none" | "env" | "managed-testnet" | "external-signer" | "x402-env";
export type SignerPurpose = "write" | "x402";

export interface SignerResult {
  account: Account;
  address: `0x${string}`;
  mode: SignerMode;
}

export interface SignerFailure {
  error: {
    code: string;
    message: string;
  };
}

export type GetSignerResult = SignerResult | SignerFailure;

export function isSignerFailure(r: GetSignerResult): r is SignerFailure {
  return "error" in r;
}

function normalizePrivateKey(pk: string): `0x${string}` {
  return (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
}

function accountFromEnvKey(envName: "PRIVATE_KEY" | "X402_SIGNER_PRIVATE_KEY", mode: SignerMode): GetSignerResult | null {
  const pk = process.env[envName];
  if (!pk) return null;
  try {
    const account = privateKeyToAccount(normalizePrivateKey(pk));
    return { account, address: account.address, mode };
  } catch {
    return {
      error: {
        code: "INVALID_PRIVATE_KEY",
        message: `${envName} is not a valid private key.`,
      },
    };
  }
}

async function accountFromManagedWallet(agentId?: string): Promise<GetSignerResult | null> {
  const walletMode = process.env.WALLET_MODE || "none";
  if (walletMode !== "managed-testnet" || !agentId) return null;

  if (process.env.WALLET_STORE_PATH && !process.env.WALLET_ENCRYPTION_KEY) {
    return {
      error: {
        code: "WALLET_ENCRYPTION_KEY_REQUIRED",
        message:
          "WALLET_ENCRYPTION_KEY is required when WALLET_STORE_PATH is used for persistent managed-testnet wallets.",
      },
    };
  }

  const stored = await walletStore.get(agentId);
  if (!stored) return null;

  try {
    const privateKey = decryptKey(stored.encryptedKey, getEffectiveEncryptionKey());
    const account = privateKeyToAccount(normalizePrivateKey(privateKey));
    return { account, address: account.address, mode: "managed-testnet" };
  } catch {
    return {
      error: {
        code: "NO_SIGNER_AVAILABLE",
        message: "Managed wallet key could not be decrypted for signing. Check WALLET_ENCRYPTION_KEY matches the key used when the wallet was created.",
      },
    };
  }
}

/**
 * Get a signer for write/payment operations.
 * Priority for x402: managed wallet > X402_SIGNER_PRIVATE_KEY > PRIVATE_KEY fallback.
 * Priority for writes: managed wallet > PRIVATE_KEY fallback.
 */
export async function getSigner(
  agentId?: string,
  options: { purpose?: SignerPurpose } = {}
): Promise<GetSignerResult> {
  const purpose = options.purpose || "write";

  const managed = await accountFromManagedWallet(agentId);
  if (managed) return managed;

  if (purpose === "x402") {
    const x402Env = accountFromEnvKey("X402_SIGNER_PRIVATE_KEY", "x402-env");
    if (x402Env) return x402Env;
  }

  const walletMode = process.env.WALLET_MODE || "none";
  if (walletMode === "env" || process.env.PRIVATE_KEY) {
    const env = accountFromEnvKey("PRIVATE_KEY", "env");
    if (env) return env;
  }

  return {
    error: {
      code: "NO_SIGNER_AVAILABLE",
      message:
        purpose === "x402"
          ? "No x402 signer available. Use WALLET_MODE=managed-testnet with agentId, X402_SIGNER_PRIVATE_KEY, or PRIVATE_KEY as testnet developer fallback."
          : "No signer available. Use WALLET_MODE=managed-testnet with agentId, or WALLET_MODE=env with PRIVATE_KEY for testnet developer mode.",
    },
  };
}
