// ─── Tool: simulate_transaction ────────────────────────────────────────
import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { getDodoRoute, isNativeToken, resolveTokenDecimals, fromWei } from "../lib/dodoApi.js";
import { parseEther, formatEther } from "viem";

export const simulateTransactionSchema = z.object({
  action: z.enum(["swap", "transfer"]),
  tokenIn: z.string().optional(),
  tokenOut: z.string().optional(),
  amount: z.string(),
  toAddress: z.string().optional(),
  walletAddress: z.string(),
});

export type SimulateTransactionInput = z.infer<typeof simulateTransactionSchema>;

export const simulateTransactionTool = {
  name: "simulate_transaction",
  description: "Dry run a swap or transfer via eth_call — no gas spent. Returns expected output, gas estimate, and revert reasons.",
  inputSchema: simulateTransactionSchema,
};

export async function handleSimulateTransaction(input: SimulateTransactionInput) {
  const warnings: string[] = [];
  const balanceChanges: Array<{ token: string; delta: string }> = [];

  try {
    if (input.action === "swap") {
      if (!input.tokenIn || !input.tokenOut) {
        return { wouldSucceed: false, gasEstimate: "0", revertReason: "tokenIn and tokenOut required for swap simulation", balanceChanges, warnings };
      }

      const quote = await getDodoRoute({
        fromToken: input.tokenIn,
        toToken: input.tokenOut,
        amountHuman: input.amount,
        walletAddress: input.walletAddress,
      });

      if (!quote.routeAvailable) {
        return { wouldSucceed: false, gasEstimate: "0", revertReason: "No swap route available", balanceChanges, warnings };
      }

      // Simulate via eth_call
      try {
        await publicClient.call({
          to: quote.to as `0x${string}`,
          data: quote.calldata as `0x${string}`,
          value: BigInt(quote.value),
          account: input.walletAddress as `0x${string}`,
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("revert")) {
          return { wouldSucceed: false, expectedOutput: quote.amountOut, gasEstimate: quote.gasLimit, revertReason: msg, balanceChanges, warnings };
        }
        warnings.push(`Simulation warning: ${msg}`);
      }

      balanceChanges.push({ token: input.tokenIn, delta: `-${input.amount}` });
      balanceChanges.push({ token: input.tokenOut, delta: `+${quote.amountOut}` });

      return { wouldSucceed: true, expectedOutput: quote.amountOut, gasEstimate: quote.gasLimit, balanceChanges, warnings };
    }

    // Transfer simulation
    if (!input.toAddress) {
      return { wouldSucceed: false, gasEstimate: "0", revertReason: "toAddress required for transfer simulation", balanceChanges, warnings };
    }

    const amountWei = parseEther(input.amount);
    const balance = await publicClient.getBalance({ address: input.walletAddress as `0x${string}` });

    if (balance < amountWei) {
      return {
        wouldSucceed: false,
        gasEstimate: "21000",
        revertReason: `Insufficient balance: have ${formatEther(balance)}, need ${input.amount}`,
        balanceChanges,
        warnings,
      };
    }

    const gasEstimate = await publicClient.estimateGas({
      to: input.toAddress as `0x${string}`,
      value: amountWei,
      account: input.walletAddress as `0x${string}`,
    });

    balanceChanges.push({ token: "PHRS", delta: `-${input.amount}` });

    return {
      wouldSucceed: true,
      expectedOutput: input.amount,
      gasEstimate: gasEstimate.toString(),
      balanceChanges,
      warnings,
    };
  } catch (err) {
    return { wouldSucceed: false, gasEstimate: "0", revertReason: (err as Error).message, balanceChanges, warnings };
  }
}
