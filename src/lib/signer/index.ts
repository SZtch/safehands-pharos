// ─── SignerProvider ─────────────────────────────────────────────────────
// Abstraction layer for signing. Tools never read process.env.PRIVATE_KEY
// directly — they request a signer through this provider.
// ────────────────────────────────────────────────────────────────────────

import { privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";
import { walletStore, decryptKey, getEffectiveEncryptionKey } from "../wallet/index.js";
import { managedWalletEnabled } from "../config.js";

export type SignerMode = "none" | "env" | "managed-mainnet" | "external-signer" | "x402-env";
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
  if (walletMode !== "managed-mainnet" || !agentId) return null;

  // Managed custody must be explicitly opted into. WALLET_MODE=managed-mainnet
  // selects the signer source; MANAGED_WALLET_ENABLED=true is the required second
  // gate (mirrors the MCP bootstrap gate + capability flags). Without it the stored
  // managed wallet is NEVER used to sign — fail closed with a clear reason.
  if (!managedWalletEnabled()) {
    return {
      error: {
        code: "MANAGED_WALLET_DISABLED",
        message:
          "Managed-wallet signing requires MANAGED_WALLET_ENABLED=true in addition to WALLET_MODE=managed-mainnet. Enable it only for trusted managed execution.",
      },
    };
  }

  if (process.env.WALLET_STORE_PATH && !process.env.WALLET_ENCRYPTION_KEY) {
    return {
      error: {
        code: "WALLET_ENCRYPTION_KEY_REQUIRED",
        message:
          "WALLET_ENCRYPTION_KEY is required when WALLET_STORE_PATH is used for persistent managed-mainnet wallets.",
      },
    };
  }

  const stored = await walletStore.get(agentId);
  if (!stored) return null;

  try {
    const privateKey = decryptKey(stored.encryptedKey, getEffectiveEncryptionKey());
    const account = privateKeyToAccount(normalizePrivateKey(privateKey));
    return { account, address: account.address, mode: "managed-mainnet" };
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
 * Priority for x402: managed wallet > X402_SIGNER_PRIVATE_KEY > PRIVATE_KEY when WALLET_MODE=env.
 * Priority for writes: managed wallet > PRIVATE_KEY only when WALLET_MODE=env.
 */
export async function getSigner(
  agentId?: string,
  options: { purpose?: SignerPurpose } = {}
): Promise<GetSignerResult> {
  const purpose = options.purpose || "write";

  // x402 is permissionless-first: prefer the agent's OWN x402 signer
  // (self-custody — no SafeHandsRegistry authorization required) over the
  // managed/custodial wallet. To route x402 through the managed wallet instead,
  // simply leave X402_SIGNER_PRIVATE_KEY unset.
  if (purpose === "x402") {
    const x402Env = accountFromEnvKey("X402_SIGNER_PRIVATE_KEY", "x402-env");
    if (x402Env) return x402Env;
  }

  const managed = await accountFromManagedWallet(agentId);
  if (managed) return managed;

  if (!agentId && (process.env.WALLET_MODE === "managed-mainnet")) {
    const defaultManaged = await accountFromManagedWallet("default");
    if (defaultManaged) return defaultManaged;
  }

  const walletMode = process.env.WALLET_MODE || "none";
  if (walletMode === "env") {
    const env = accountFromEnvKey("PRIVATE_KEY", "env");
    if (env) return env;
  }

  return {
    error: {
      code: "NO_SIGNER_AVAILABLE",
      message:
        purpose === "x402"
          ? "No x402 signer available. Use WALLET_MODE=managed-mainnet with agentId, X402_SIGNER_PRIVATE_KEY, or PRIVATE_KEY in explicit local self-hosted mode."
          : "No signer available. Use WALLET_MODE=managed-mainnet with agentId, or WALLET_MODE=env with PRIVATE_KEY for explicit local self-hosted mode.",
    },
  };
}
