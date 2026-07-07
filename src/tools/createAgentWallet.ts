// ─── create_agent_wallet ────────────────────────────────────────────────
// Creates a new managed testnet agent wallet.
// Private key is AES-256-GCM encrypted before storage, never returned in response.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ok, fail, type ToolResponse } from "../lib/toolResponse.js";
import { walletStore, encryptKey, usesPersistentWalletStore, getEffectiveEncryptionKey } from "../lib/wallet/index.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, SAFEHANDS_REGISTRY_ADDRESS } from "../lib/constants.js";
import { tryAutoAuthorize } from "../lib/safeHandsRegistry.js";

export const createAgentWalletSchema = z.object({
  agentId: z
    .string()
    .min(1)
    .max(64)
    .describe("Unique identifier for this agent wallet (e.g. 'trading-agent-1')"),
  overwrite: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, overwrite existing wallet for this agentId"),
});

export type CreateAgentWalletParams = z.infer<typeof createAgentWalletSchema>;

interface CreateAgentWalletData {
  agentId: string;
  address: string;
  environment: string;
  chainId: number;
  isMainnet: boolean;
  createdAt: string;
  warning: string;
  instructions: string;
  riskRegistryVersion: "safehands-registry";
  riskRegistryAddress: string;
  riskRegistryAuthorized: boolean;
  riskRegistryAuthTxHash: string | null;
  riskRegistryMessage: string;
}

export async function handleCreateAgentWallet(
  params: unknown
): Promise<ToolResponse<CreateAgentWalletData>> {
  let parsed: CreateAgentWalletParams;
  try {
    parsed = createAgentWalletSchema.parse(params);
  } catch (err) {
    const msg = err instanceof Error && "issues" in err
      ? (err as any).issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `create_agent_wallet input validation failed: ${msg}`, false, "create_agent_wallet");
  }
  const { agentId, overwrite } = parsed;

  // Check if wallet already exists
  const existing = await walletStore.get(agentId);
  if (existing && !overwrite) {
    return fail(
      "WALLET_ALREADY_EXISTS",
      `A wallet for agentId '${agentId}' already exists. Use overwrite:true to replace it, or use get_agent_wallet to retrieve it.`,
      false,
      "wallet_store"
    );
  }

  if (usesPersistentWalletStore() && !process.env.WALLET_ENCRYPTION_KEY) {
    return fail(
      "WALLET_ENCRYPTION_KEY_REQUIRED",
      "WALLET_ENCRYPTION_KEY is required when WALLET_STORE_PATH is used. Use in-memory store for local tests or provide a mainnet-only encryption key.",
      false,
      "wallet_store"
    );
  }

  // Generate new wallet
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  // Encrypt key before storage (AES-256-GCM)
  const encryptedKey = encryptKey(privateKey, getEffectiveEncryptionKey());

  // Store wallet
  await walletStore.set(agentId, {
    agentId,
    address: account.address,
    encryptedKey,
    environment: "pacific-mainnet",
    chainId: 1672,
    isMainnet: true,
    createdAt: new Date().toISOString(),
  });

  // Optional auto-authorization in SafeHandsRegistry.
  // Gated by AUTO_AUTHORIZE_AGENT_WALLET + RISK_REGISTRY_OWNER_PRIVATE_KEY (handled
  // inside tryAutoAuthorize). Wallet creation always succeeds even if this is
  // disabled or fails — the wallet is simply not yet authorized for managed execution.
  const auth = await tryAutoAuthorize(account.address);
  const riskRegistryAuthorized = auth.riskRegistryAuthorized;
  const riskRegistryAuthTxHash = auth.authorizationTxHash ?? null;
  const riskRegistryMessage = riskRegistryAuthorized
    ? (auth.autoAuthorized
        ? "Wallet auto-authorized in SafeHandsRegistry and ready for managed execution once funded."
        : "Wallet is already authorized in SafeHandsRegistry.")
    : `Wallet is NOT yet authorized for managed execution. ${auth.authorizationReason ?? ""} ` +
      `The SafeHandsRegistry owner must call setAuthorizedAgent(${account.address}, true), ` +
      `or set AUTO_AUTHORIZE_AGENT_WALLET=true with RISK_REGISTRY_OWNER_PRIVATE_KEY.`;

  return ok({
    agentId,
    address: account.address,
    environment: PHAROS_ENVIRONMENT,
    chainId: CHAIN_ID,
    isMainnet: IS_MAINNET,
    createdAt: new Date().toISOString(),
    warning:
      "Managed mainnet wallet. Use a DEDICATED low-value operator wallet, never a primary wallet. Private key is AES-256-GCM encrypted locally — not KMS/HSM-grade.",
    instructions: `Fund this wallet with PROS for gas. Managed execution stays disabled until you opt in with WRITE_TOOLS_ENABLED=true and MANAGED_WALLET_ENABLED=true.`,
    riskRegistryVersion: "safehands-registry",
    riskRegistryAddress: SAFEHANDS_REGISTRY_ADDRESS,
    riskRegistryAuthorized,
    riskRegistryAuthTxHash,
    riskRegistryMessage,
  });
}
