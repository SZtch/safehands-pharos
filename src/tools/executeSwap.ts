// ─── Tool: execute_swap ────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, createPharosWalletClient, getExplorerUrl } from "../lib/pharosClient.js";
import { getDodoRoute, isNativeToken, resolveTokenAddress, resolveTokenDecimals, toWei } from "../lib/dodoApi.js";
import { assessRisk } from "../lib/riskEngine.js";
import { DODO_APPROVE_ADDRESS, ERC20_ABI, RISK_BLOCK_THRESHOLD } from "../lib/constants.js";

export const executeSwapSchema = z.object({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  slippageTolerance: z.number().optional().default(3.225),
});

export type ExecuteSwapInput = z.input<typeof executeSwapSchema>;

export const executeSwapTool = {
  name: "execute_swap",
  description: "Swap tokens via FaroSwap with built-in risk gate. Runs risk assessment first, blocks if score > 80.",
  inputSchema: executeSwapSchema,
};

export async function handleExecuteSwap(raw: ExecuteSwapInput) {
  const privateKey = process.env.PRIVATE_KEY;
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!privateKey || !walletAddress) throw new Error("Missing PRIVATE_KEY or WALLET_ADDRESS in environment variables.");
  const input = executeSwapSchema.parse(raw);
  // 1. Risk assessment
  let riskScore = 0;
  let wasBlocked = false;
  let blockReason: string | undefined;

  if (true) {
    const risk = await assessRisk({
      action: "swap",
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amount: input.amountIn,
      walletAddress: walletAddress,
    });
    riskScore = risk.riskScore;

    if (riskScore > RISK_BLOCK_THRESHOLD) {
      return {
        success: false,
        riskAssessment: { riskScore, wasBlocked: true, blockReason: risk.suggestion },
        error: `Swap blocked — risk score ${riskScore}/100: ${risk.suggestion}`,
      };
    }
  }

  try {
    // 2. Get DODO route
    const quote = await getDodoRoute({
      fromToken: input.tokenIn,
      toToken: input.tokenOut,
      amountHuman: input.amountIn,
      walletAddress: walletAddress,
      slippage: input.slippageTolerance,
    });

    if (!quote.routeAvailable) {
      return {
        success: false,
        riskAssessment: { riskScore, wasBlocked: false },
        error: "No swap route available — insufficient liquidity",
      };
    }

    const wallet = createPharosWalletClient(privateKey as `0x${string}`);

    // 3. Approve if non-native token
    if (!isNativeToken(input.tokenIn)) {
      const tokenAddr = resolveTokenAddress(input.tokenIn);
      const decimals = resolveTokenDecimals(input.tokenIn);
      const amountWei = BigInt(toWei(input.amountIn, decimals));

      const allowance = (await publicClient.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [walletAddress as `0x${string}`, DODO_APPROVE_ADDRESS],
      })) as bigint;

      if (allowance < amountWei) {
        const approveHash = await wallet.writeContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [DODO_APPROVE_ADDRESS, amountWei * 2n],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    // 4. Send swap tx
    const txHash = await wallet.sendTransaction({
      to: quote.to as `0x${string}`,
      value: BigInt(quote.value),
      data: quote.calldata as `0x${string}`,
      gas: BigInt(quote.gasLimit),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      success: receipt.status === "success",
      txHash,
      explorerUrl: getExplorerUrl(txHash),
      amountOut: quote.amountOut,
      gasUsed: receipt.gasUsed.toString(),
      riskAssessment: { riskScore, wasBlocked: false },
    };
  } catch (err) {
    return {
      success: false,
      riskAssessment: { riskScore, wasBlocked: false },
      error: `Swap failed: ${(err as Error).message}`,
    };
  }
}
