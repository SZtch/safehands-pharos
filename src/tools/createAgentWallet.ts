// ─── create_agent_wallet ────────────────────────────────────────────────
// Creates a new managed testnet agent wallet.
// Private key is obfuscated before storage, never returned in response.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ok, fail, type ToolResponse } from "../lib/toolResponse.js";
import { walletStore, obfuscateKey, usesPersistentWalletStore } from "../lib/wallet/index.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET } from "../lib/constants.js";

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

  // Obfuscate key before storage
  const encryptionKey = process.env.WALLET_ENCRYPTION_KEY || "safehands-testnet-default-key";
  const encryptedKey = obfuscateKey(privateKey, encryptionKey);

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

  return ok({
    agentId,
    address: account.address,
    environment: PHAROS_ENVIRONMENT,
    chainId: CHAIN_ID,
    isMainnet: IS_MAINNET,
    isTestnet: true,
    createdAt: new Date().toISOString(),
    warning:
      "This is a TESTNET wallet only. Never use for mainnet funds. Private key is stored locally and obfuscated — not production-grade encryption.",
    instructions: `Fund this wallet with testnet PHRS from https://testnet.pharosnetwork.xyz/ before executing write operations. Set WRITE_TOOLS_ENABLED=true to enable transactions.`,
  });
}
