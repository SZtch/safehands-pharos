// ─── Tool: simulate_transaction ────────────────────────────────────────
import { z } from "zod";
import { publicClient } from "../lib/pharosClient.js";
import { getDodoRoute } from "../lib/dodoApi.js";
import { parseEther, formatEther } from "viem";
import { ok, fail } from "../lib/toolResponse.js";
import { validatePositiveAmount, validateAddress } from "../lib/validation.js";
import { recommendGasWithBuffer, DEFAULT_GAS_BUFFER_PCT } from "../lib/analysis/gas.js";

export const simulateTransactionSchema = z.object({
  action: z.enum(["swap", "transfer"]),
  tokenIn: z.string().optional(),
  tokenOut: z.string().optional(),
  amount: z.string(),
  toAddress: z.string().optional(),
  walletAddress: z.string(),
}).strict();

export type SimulateTransactionInput = z.infer<typeof simulateTransactionSchema>;

export const simulateTransactionTool = {
  name: "simulate_transaction",
  description: "Dry run a swap or transfer via eth_call — no gas spent. Returns expected output, gas estimate, and revert reasons.",
  inputSchema: simulateTransactionSchema,
};

export async function handleSimulateTransaction(raw: SimulateTransactionInput) {
  let input: z.infer<typeof simulateTransactionSchema>;
  try {
    input = simulateTransactionSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `simulate_transaction input validation failed: ${msg}`, false, "simulate_transaction");
  }

  const amtErr = validatePositiveAmount(input.amount, "amount");
  if (amtErr) return fail("VALIDATION_ERROR", amtErr, false, "simulate_transaction");

  const walletErr = validateAddress(input.walletAddress, "walletAddress");
  if (walletErr) return fail("VALIDATION_ERROR", walletErr, false, "simulate_transaction");

  const warnings: string[] = [];
  const balanceChanges: Array<{ token: string; delta: string }> = [];

  try {
    if (input.action === "swap") {
      if (!input.tokenIn || !input.tokenOut) {
        return fail("VALIDATION_ERROR", "tokenIn and tokenOut required for swap simulation", false, "simulate_transaction");
      }

      const quote = await getDodoRoute({
        fromToken: input.tokenIn,
        toToken: input.tokenOut,
        amountHuman: input.amount,
        walletAddress: input.walletAddress,
      });

      if (!quote.routeAvailable) {
        return fail("NO_ROUTE_AVAILABLE", "No swap route available", true, "simulate_transaction");
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
          return fail("SIMULATION_REVERTED", msg, false, "simulate_transaction");
        }
        warnings.push(`Simulation warning: ${msg}`);
      }

      balanceChanges.push({ token: input.tokenIn, delta: `-${input.amount}` });
      balanceChanges.push({ token: input.tokenOut, delta: `+${quote.amountOut}` });

      return ok({
        wouldSucceed: true,
        expectedOutput: quote.amountOut,
        gasEstimate: quote.gasLimit,
        recommendedGas: { value: recommendGasWithBuffer(BigInt(quote.gasLimit)).toString(), bufferPct: DEFAULT_GAS_BUFFER_PCT },
        balanceChanges,
        warnings,
      });
    }

    // Transfer simulation
    if (!input.toAddress) {
      return fail("VALIDATION_ERROR", "toAddress required for transfer simulation", false, "simulate_transaction");
    }
    const toErr = validateAddress(input.toAddress, "toAddress");
    if (toErr) return fail("VALIDATION_ERROR", toErr, false, "simulate_transaction");

    const amountWei = parseEther(input.amount);
    const balance = await publicClient.getBalance({ address: input.walletAddress as `0x${string}` });

    if (balance < amountWei) {
      return fail(
        "INSUFFICIENT_BALANCE",
        `Insufficient balance: have ${formatEther(balance)}, need ${input.amount}`,
        false,
        "simulate_transaction"
      );
    }

    const gasEstimate = await publicClient.estimateGas({
      to: input.toAddress as `0x${string}`,
      value: amountWei,
      account: input.walletAddress as `0x${string}`,
    });

    balanceChanges.push({ token: "PROS", delta: `-${input.amount}` });

    return ok({
      wouldSucceed: true,
      expectedOutput: input.amount,
      gasEstimate: gasEstimate.toString(),
      recommendedGas: { value: recommendGasWithBuffer(gasEstimate).toString(), bufferPct: DEFAULT_GAS_BUFFER_PCT },
      balanceChanges,
      warnings,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("SWAP_LIQUIDITY_NOT_CONFIGURED")) {
      return fail("SWAP_LIQUIDITY_NOT_CONFIGURED", message, false, "dodo_api");
    }
    return fail("SIMULATION_FAILED", message, true, "simulate_transaction");
  }
}
