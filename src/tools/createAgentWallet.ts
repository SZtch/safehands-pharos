// ─── create_agent_wallet ────────────────────────────────────────────────
// Creates a new managed testnet agent wallet.
// Private key is AES-256-GCM encrypted before storage, never returned in response.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ok, fail, type ToolResponse } from "../lib/toolResponse.js";
import { walletStore, encryptKey, usesPersistentWalletStore, getEffectiveEncryptionKey } from "../lib/wallet/index.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, RISK_REGISTRY_ADDRESS, RISK_REGISTRY_ABI } from "../lib/constants.js";
import { createPharosWalletClientFromAccount } from "../lib/pharosClient.js";

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
  isTestnet: boolean;
  createdAt: string;
  warning: string;
  instructions: string;
  riskRegistryAuthorized: boolean;
  riskRegistryAuthTxHash: string | null;
}

export async function handleCreateAgentWallet(
  params: CreateAgentWalletParams
): Promise<ToolResponse<CreateAgentWalletData>> {
  const { agentId, overwrite } = params;

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
      "WALLET_ENCRYPTION_KEY is required when WALLET_STORE_PATH is used. Use in-memory store for local tests or provide a testnet-only encryption key.",
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
    environment: "atlantic-testnet",
    chainId: 688689,
    isMainnet: false,
    createdAt: new Date().toISOString(),
  });

  // Auto-authorize new wallet in RiskRegistry if deployer key is available
  let riskRegistryAuthorized = false;
  let riskRegistryAuthTxHash: string | null = null;

  const deployerKey = process.env.PRIVATE_KEY;
  if (deployerKey && process.env.WRITE_TOOLS_ENABLED === "true") {
    try {
      const deployerAccount = privateKeyToAccount(deployerKey as `0x${string}`);
      const deployerWallet = createPharosWalletClientFromAccount(deployerAccount);
      const txHash = await deployerWallet.writeContract({
        address: RISK_REGISTRY_ADDRESS,
        abi: RISK_REGISTRY_ABI,
        functionName: "setAuthorizedAgent",
        args: [account.address, true],
      });
      riskRegistryAuthorized = true;
      riskRegistryAuthTxHash = txHash;
    } catch {
      // Authorization failed — wallet still created, just not authorized for publish
    }
  }

  return ok({
    agentId,
    address: account.address,
    environment: PHAROS_ENVIRONMENT,
    chainId: CHAIN_ID,
    isMainnet: IS_MAINNET,
    isTestnet: true,
    createdAt: new Date().toISOString(),
    warning:
      "This is a TESTNET wallet only. Never use for mainnet funds. Private key is AES-256-GCM encrypted locally — testnet-grade, not KMS/Vault.",
    instructions: `Fund this wallet with testnet PHRS from https://testnet.pharosnetwork.xyz/ before executing write operations. Set WRITE_TOOLS_ENABLED=true to enable transactions.`,
    riskRegistryAuthorized,
    riskRegistryAuthTxHash,
  });
}
