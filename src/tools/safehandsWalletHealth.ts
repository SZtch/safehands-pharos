// ─── Tool: safehands_wallet_health ─────────────────────────────────────
// Checks whether an AI agent wallet is ready for guarded mainnet actions.
// ───────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { formatEther, formatUnits } from "viem";
import { publicClient } from "../lib/pharosClient.js";
import { ERC20_ABI, activeUsdcAddress, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, MAX_X402_PAYMENT_USDC, SAFEHANDS_REGISTRY_ADDRESS, REQUIRE_AUTHORIZED_AGENT_FOR_WRITE } from "../lib/constants.js";
import { ok, classifyExternalError, type ToolResponse } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { walletStore } from "../lib/wallet/index.js";
import { isAgentAuthorized } from "../lib/safeHandsRegistry.js";

export const safehandsWalletHealthSchema = z.object({
  agentId: z.string().optional().describe("Managed wallet agentId"),
  walletAddress: z.string().optional().describe("Explicit wallet address for read-only health checks"),
});

export type SafeHandsWalletHealthInput = z.input<typeof safehandsWalletHealthSchema>;

/**
 * Optional read seam for offline tests. Defaults to the live read-only RPC reads
 * (PROS + USDC balances, SafeHandsRegistry authorization). These are READS only —
 * there is no signing or write path here either way; injecting them performs no
 * network I/O. The MCP path calls the handler with one argument, so default
 * behavior is unchanged.
 */
export interface WalletHealthReaders {
  readBalances?: (address: `0x${string}`) => Promise<{ pros: bigint; usdc: bigint }>;
  readAuthorization?: (address: `0x${string}`) => Promise<boolean>;
}

export async function handleSafeHandsWalletHealth(
  raw: SafeHandsWalletHealthInput,
  readers: WalletHealthReaders = {},
): Promise<ToolResponse<unknown>> {
  const input = safehandsWalletHealthSchema.parse(raw);
  const effectiveAgentId = input.agentId || (process.env.WALLET_MODE === "managed-mainnet" ? "default" : undefined);
  const managedWallet = effectiveAgentId ? await walletStore.get(effectiveAgentId) : null;
  const signer = await getSigner(effectiveAgentId);
  const signerAvailable = !isSignerFailure(signer);
  const address = signerAvailable ? signer.address : (input.walletAddress || managedWallet?.address);

  const base = {
    environment: PHAROS_ENVIRONMENT,
    chainId: CHAIN_ID,
    isMainnet: IS_MAINNET,
    walletMode: process.env.WALLET_MODE || "none",
    writeToolsEnabled: process.env.WRITE_TOOLS_ENABLED === "true",
    signerAvailable,
    signerMode: signerAvailable ? signer.mode : null,
    signerError: signerAvailable ? null : signer.error,
    managedWalletExists: Boolean(managedWallet),
    address: address || null,
  };

  if (!address) {
    return ok({
      ...base,
      status: "NOT_READY",
      readiness: {
        canReadBalances: false,
        canPayGas: false,
        canPayX402: false,
        canExecuteWrites: false,
      },
      requiredActions: [
        "Create a managed mainnet wallet (set WALLET_MODE=managed-mainnet; auto-creates on next startup) or provide WALLET_MODE=env with a testnet PRIVATE_KEY.",
        "Fund your wallet with PROS on Pharos Pacific Mainnet",
      ],
      source: "safehands_wallet_health",
    });
  }

  try {
    const { pros: prosRaw, usdc: usdcRaw } = readers.readBalances
      ? await readers.readBalances(address as `0x${string}`)
      : await (async () => {
          const [p, u] = await Promise.all([
            publicClient.getBalance({ address: address as `0x${string}` }),
            publicClient.readContract({
              address: activeUsdcAddress(),
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address as `0x${string}`],
            }) as Promise<bigint>,
          ]);
          return { pros: p, usdc: u };
        })();

    const pros = formatEther(prosRaw);
    const usdc = formatUnits(usdcRaw, 6);
    const canPayGas = parseFloat(pros) > 0.001;
    const canPayX402 = parseFloat(usdc) >= Number(MAX_X402_PAYMENT_USDC);
    const writeToolsEnabled = process.env.WRITE_TOOLS_ENABLED === "true";

    let safeHandsRegistry: { authorized: boolean; address: string; error?: string } | undefined;
    try {
      const authorized = readers.readAuthorization
        ? await readers.readAuthorization(address as `0x${string}`)
        : await isAgentAuthorized(address as `0x${string}`);
      safeHandsRegistry = { authorized, address: SAFEHANDS_REGISTRY_ADDRESS };
    } catch {
      safeHandsRegistry = { authorized: false, address: SAFEHANDS_REGISTRY_ADDRESS, error: "SafeHandsRegistry query failed" };
    }

    // Managed-mainnet wallets must be authorized in SafeHandsRegistry before they
    // can execute writes. env-mode wallets do not require registry authorization.
    const authorizationRequired =
      signerAvailable && signer.mode === "managed-mainnet" && REQUIRE_AUTHORIZED_AGENT_FOR_WRITE;
    const riskRegistryAuthorized = safeHandsRegistry.authorized === true;
    const authorizationSatisfied = !authorizationRequired || riskRegistryAuthorized;

    const canExecuteWrites =
      signerAvailable && canPayGas && writeToolsEnabled && authorizationSatisfied;

    // REQUIRE_AUTHORIZATION surfaces the one remaining blocker when a funded,
    // write-enabled managed wallet is simply not yet authorized in SafeHandsRegistry.
    const needsAuthorizationOnly =
      signerAvailable && writeToolsEnabled && canPayGas && authorizationRequired && !riskRegistryAuthorized;

    const status = canExecuteWrites
      ? "READY"
      : needsAuthorizationOnly
        ? "REQUIRE_AUTHORIZATION"
        : signerAvailable
          ? "DEGRADED"
          : "NOT_READY";

    return ok({
      ...base,
      status,
      balances: {
        PROS: { value: pros, unit: "PROS", decimals: 18 },
        USDC: { value: usdc, unit: "USDC", decimals: 6, tokenAddress: activeUsdcAddress() },
      },
      readiness: {
        canReadBalances: true,
        canPayGas,
        canPayX402,
        canExecuteWrites,
        authorizationRequired,
        riskRegistryAuthorized,
      },
      safeHandsRegistry,
      dailySpendStatus: {
        implemented: false,
        note: "Daily spend accounting is config-ready but not persisted in this MVP.",
      },
      requiredActions: [
        ...(canPayGas ? [] : ["Fund wallet with PROS for gas: Mainnet (no faucet)"]),
        ...(canPayX402 ? [] : [`Fund wallet with at least ${MAX_X402_PAYMENT_USDC} USDC for x402 payments.`]),
        ...(writeToolsEnabled ? [] : ["Set WRITE_TOOLS_ENABLED=true only when intentionally executing trusted mainnet actions."]),
        ...(authorizationRequired && !riskRegistryAuthorized
          ? [`Authorize this managed wallet in SafeHandsRegistry: the contract owner must call setAuthorizedAgent(${address}, true), or set AUTO_AUTHORIZE_AGENT_WALLET=true with RISK_REGISTRY_OWNER_PRIVATE_KEY.`]
          : []),
      ],
      source: "safehands_wallet_health",
    });
  } catch (err) {
    const rpc = classifyExternalError("pharos_rpc", err);
    return ok({
      ...base,
      status: "DEGRADED",
      readiness: {
        canReadBalances: false,
        canPayGas: "unknown",
        canPayX402: "unknown",
        canExecuteWrites: false,
      },
      rpcError: rpc.error,
      requiredActions: ["Retry RPC balance checks later or configure PHAROS_RPC_URL."],
      source: "safehands_wallet_health",
    });
  }
}
