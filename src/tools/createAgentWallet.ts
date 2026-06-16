// ─── create_agent_wallet ────────────────────────────────────────────────
// Creates a new managed testnet agent wallet.
// Private key is AES-256-GCM encrypted before storage, never returned in response.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ok, fail, type ToolResponse } from "../lib/toolResponse.js";
import { walletStore, encryptKey, usesPersistentWalletStore, getEffectiveEncryptionKey } from "../lib/wallet/index.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, RISK_REGISTRY_V2_ADDRESS } from "../lib/constants.js";
import { tryAutoAuthorize } from "../lib/riskRegistryV2.js";

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
  riskRegistryVersion: "v2";
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

  // Optional auto-authorization in RiskRegistry V2.
  // Gated by AUTO_AUTHORIZE_AGENT_WALLET + RISK_REGISTRY_OWNER_PRIVATE_KEY (handled
  // inside tryAutoAuthorize). Wallet creation always succeeds even if this is
  // disabled or fails — the wallet is simply not yet authorized for managed execution.
  const auth = await tryAutoAuthorize(account.address);
  const riskRegistryAuthorized = auth.riskRegistryAuthorized;
  const riskRegistryAuthTxHash = auth.authorizationTxHash ?? null;
  const riskRegistryMessage = riskRegistryAuthorized
    ? (auth.autoAuthorized
        ? "Wallet auto-authorized in RiskRegistry V2 and ready for managed execution once funded."
        : "Wallet is already authorized in RiskRegistry V2.")
    : `Wallet is NOT yet authorized for managed execution. ${auth.authorizationReason ?? ""} ` +
      `The RiskRegistry V2 owner must call setAuthorizedAgent(${account.address}, true), ` +
      `or set AUTO_AUTHORIZE_AGENT_WALLET=true with RISK_REGISTRY_OWNER_PRIVATE_KEY.`;

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
    riskRegistryVersion: "v2",
    riskRegistryAddress: RISK_REGISTRY_V2_ADDRESS,
    riskRegistryAuthorized,
    riskRegistryAuthTxHash,
    riskRegistryMessage,
  });
}
