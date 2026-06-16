// ─── Tool: safehands_wallet_health ─────────────────────────────────────
// Checks whether an AI agent wallet is ready for guarded testnet actions.
// ───────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { formatEther, formatUnits } from "viem";
import { publicClient } from "../lib/pharosClient.js";
import { ERC20_ABI, USDC_ADDRESS, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, MAX_X402_PAYMENT_USDC, RISK_REGISTRY_V2_ADDRESS, REQUIRE_AUTHORIZED_AGENT_FOR_WRITE } from "../lib/constants.js";
import { fail, ok, classifyExternalError, type ToolResponse } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { walletStore } from "../lib/wallet/index.js";
import { isAgentAuthorized } from "../lib/riskRegistryV2.js";

export const safehandsWalletHealthSchema = z.object({
  agentId: z.string().optional().describe("Managed testnet wallet agentId"),
  walletAddress: z.string().optional().describe("Explicit wallet address for read-only health checks"),
});

export type SafeHandsWalletHealthInput = z.input<typeof safehandsWalletHealthSchema>;

export async function handleSafeHandsWalletHealth(raw: SafeHandsWalletHealthInput): Promise<ToolResponse<unknown>> {
  const input = safehandsWalletHealthSchema.parse(raw);
  const effectiveAgentId = input.agentId || (process.env.WALLET_MODE === "managed-testnet" ? "default" : undefined);
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
        "Create a managed testnet wallet (set WALLET_MODE=managed-testnet — auto-creates on next startup) or provide WALLET_MODE=env with a testnet PRIVATE_KEY.",
        "Fund your wallet at https://testnet.pharosnetwork.xyz/",
      ],
      source: "safehands_wallet_health",
    });
  }

  try {
    const [phrsRaw, usdcRaw] = await Promise.all([
      publicClient.getBalance({ address: address as `0x${string}` }),
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as Promise<bigint>,
    ]);

    const phrs = formatEther(phrsRaw);
    const usdc = formatUnits(usdcRaw, 6);
    const canPayGas = parseFloat(phrs) > 0.001;
    const canPayX402 = parseFloat(usdc) >= Number(MAX_X402_PAYMENT_USDC);
    const writeToolsEnabled = process.env.WRITE_TOOLS_ENABLED === "true";

    let riskRegistryV2: { authorized: boolean; address: string; error?: string } | undefined;
    try {
      const authorized = await isAgentAuthorized(address as `0x${string}`);
      riskRegistryV2 = { authorized, address: RISK_REGISTRY_V2_ADDRESS };
    } catch {
      riskRegistryV2 = { authorized: false, address: RISK_REGISTRY_V2_ADDRESS, error: "RiskRegistry V2 query failed" };
    }

    // Managed-testnet wallets must be authorized in RiskRegistry V2 before they
    // can execute writes. env-mode wallets do not require registry authorization.
    const authorizationRequired =
      signerAvailable && signer.mode === "managed-testnet" && REQUIRE_AUTHORIZED_AGENT_FOR_WRITE;
    const riskRegistryAuthorized = riskRegistryV2.authorized === true;
    const authorizationSatisfied = !authorizationRequired || riskRegistryAuthorized;

    const canExecuteWrites =
      signerAvailable && canPayGas && writeToolsEnabled && authorizationSatisfied;

    // REQUIRE_AUTHORIZATION surfaces the one remaining blocker when a funded,
    // write-enabled managed wallet is simply not yet authorized in RiskRegistry V2.
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
        PHRS: { value: phrs, unit: "PHRS", decimals: 18 },
        USDC: { value: usdc, unit: "USDC", decimals: 6, tokenAddress: USDC_ADDRESS },
      },
      readiness: {
        canReadBalances: true,
        canPayGas,
        canPayX402,
        canExecuteWrites,
        authorizationRequired,
        riskRegistryAuthorized,
      },
      riskRegistryV2,
      dailySpendStatus: {
        implemented: false,
        note: "Daily spend accounting is config-ready but not persisted in this MVP.",
      },
      requiredActions: [
        ...(canPayGas ? [] : ["Fund wallet with testnet PHRS for gas: https://testnet.pharosnetwork.xyz/"]),
        ...(canPayX402 ? [] : [`Fund wallet with at least ${MAX_X402_PAYMENT_USDC} testnet USDC for x402 payments.`]),
        ...(writeToolsEnabled ? [] : ["Set WRITE_TOOLS_ENABLED=true only when intentionally executing trusted testnet actions."]),
        ...(authorizationRequired && !riskRegistryAuthorized
          ? [`Authorize this managed wallet in RiskRegistry V2: the contract owner must call setAuthorizedAgent(${address}, true), or set AUTO_AUTHORIZE_AGENT_WALLET=true with RISK_REGISTRY_OWNER_PRIVATE_KEY.`]
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
