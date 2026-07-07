// ─── Tool: get_gas_price ───────────────────────────────────────────────
// Fetches current gas price from Pharos RPC with trend analysis.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { formatGwei } from "viem";
import { CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET } from "../lib/constants.js";
import { classifyExternalError, ok } from "../lib/toolResponse.js";

export const getGasPriceSchema = z.object({});

export type GetGasPriceInput = z.input<typeof getGasPriceSchema>;

export const getGasPriceTool = {
  name: "get_gas_price",
  description:
    "Get the current gas price on Pharos Atlantic Testnet with trend classification (low/normal/high) and cost estimates.",
  inputSchema: getGasPriceSchema,
};

export async function handleGetGasPrice(_raw: GetGasPriceInput) {
  try {
    const gasPrice = await publicClient.getGasPrice();
    const gasPriceGwei = parseFloat(formatGwei(gasPrice));

    let trend: "low" | "normal" | "high";
    let recommendation: string;

    if (gasPriceGwei <= 5) {
      trend = "low";
      recommendation = "Gas is cheap. Good time to execute testnet transactions.";
    } else if (gasPriceGwei <= 50) {
      trend = "normal";
      recommendation = "Gas is at normal testnet levels. Proceed with standard transactions.";
    } else {
      trend = "high";
      recommendation = "Gas is elevated. Consider waiting or reducing transaction complexity.";
    }

    const transferCostWei = gasPrice * 21000n;
    const swapCostWei = gasPrice * 250000n;

    return ok({
      gasPrice: { value: gasPriceGwei.toFixed(4), unit: "gwei" },
      gasPriceWei: gasPrice.toString(),
      trend,
      recommendation,
      estimates: {
        nativeTransfer: {
          gas: { value: "21000", unit: "gas" },
          costPROS: { value: (Number(transferCostWei) / 1e18).toFixed(8), unit: "PROS" },
        },
        tokenSwap: {
          gas: { value: "250000", unit: "gas" },
          costPROS: { value: (Number(swapCostWei) / 1e18).toFixed(8), unit: "PROS" },
        },
      },
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
      source: "pharos_rpc",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
