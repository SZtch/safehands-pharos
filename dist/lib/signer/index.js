// ─── SignerProvider ─────────────────────────────────────────────────────
// Abstraction layer for signing. Tools never read process.env.PRIVATE_KEY
// directly — they request a signer through this provider.
// ────────────────────────────────────────────────────────────────────────
import { privateKeyToAccount } from "viem/accounts";
import { walletStore, deobfuscateKey } from "../wallet/index.js";
export function isSignerFailure(r) {
    return "error" in r;
}
function normalizePrivateKey(pk) {
    return (pk.startsWith("0x") ? pk : `0x${pk}`);
}
function accountFromEnvKey(envName, mode) {
    const pk = process.env[envName];
    if (!pk)
        return null;
    try {
        const account = privateKeyToAccount(normalizePrivateKey(pk));
        return { account, address: account.address, mode };
    }
    catch {
        return {
            error: {
                code: "INVALID_PRIVATE_KEY",
                message: `${envName} is not a valid private key.`,
            },
        };
    }
}
async function accountFromManagedWallet(agentId) {
    const walletMode = process.env.WALLET_MODE || "none";
    if (walletMode !== "managed-testnet" || !agentId)
        return null;
    if (process.env.WALLET_STORE_PATH && !process.env.WALLET_ENCRYPTION_KEY) {
        return {
            error: {
                code: "WALLET_ENCRYPTION_KEY_REQUIRED",
                message: "WALLET_ENCRYPTION_KEY is required when WALLET_STORE_PATH is used for persistent managed-testnet wallets.",
            },
        };
    }
    const stored = await walletStore.get(agentId);
    if (!stored)
        return null;
    const encryptionKey = process.env.WALLET_ENCRYPTION_KEY || "safehands-testnet-default-key";
    try {
        const privateKey = deobfuscateKey(stored.encryptedKey, encryptionKey);
        const account = privateKeyToAccount(normalizePrivateKey(privateKey));
        return { account, address: account.address, mode: "managed-testnet" };
    }
    catch {
        return {
            error: {
                code: "NO_SIGNER_AVAILABLE",
                message: "Managed wallet key could not be decrypted/deobfuscated for signing.",
            },
        };
    }
}
/**
 * Get a signer for write/payment operations.
 * Priority for x402: managed wallet > X402_SIGNER_PRIVATE_KEY > PRIVATE_KEY fallback.
 * Priority for writes: managed wallet > PRIVATE_KEY fallback.
 */
export async function getSigner(agentId, options = {}) {
    const purpose = options.purpose || "write";
    const managed = await accountFromManagedWallet(agentId);
    if (managed)
        return managed;
    if (purpose === "x402") {
        const x402Env = accountFromEnvKey("X402_SIGNER_PRIVATE_KEY", "x402-env");
        if (x402Env)
            return x402Env;
    }
    const walletMode = process.env.WALLET_MODE || "none";
    if (walletMode === "env" || process.env.PRIVATE_KEY) {
        const env = accountFromEnvKey("PRIVATE_KEY", "env");
        if (env)
            return env;
    }
    return {
        error: {
            code: "NO_SIGNER_AVAILABLE",
            message: purpose === "x402"
                ? "No x402 signer available. Use WALLET_MODE=managed-testnet with agentId, X402_SIGNER_PRIVATE_KEY, or PRIVATE_KEY as testnet developer fallback."
                : "No signer available. Use WALLET_MODE=managed-testnet with agentId, or WALLET_MODE=env with PRIVATE_KEY for testnet developer mode.",
        },
    };
}
//# sourceMappingURL=index.js.map