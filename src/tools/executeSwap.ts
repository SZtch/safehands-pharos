// ─── Tool: execute_swap ────────────────────────────────────────────────
import { z } from "zod";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { getDodoRoute, isNativeToken, resolveTokenAddress, resolveTokenDecimals, toWei } from "../lib/dodoApi.js";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { DODO_APPROVE_ADDRESS, ERC20_ABI, RISK_BLOCK_THRESHOLD, MAX_TX_AMOUNT_PHRS, CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { requireManagedExecutionReady, isManagedExecutionFailure } from "../lib/managedExecution.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { checkDailyLimit, recordSpend, estimateUsd } from "../lib/spendAccumulator.js";
import { validatePositiveAmount } from "../lib/validation.js";

export const executeSwapSchema = z.object({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  slippageTolerance: z.number().optional().default(3.225),
  agentId: z.string().optional().describe("Managed testnet wallet agentId when WALLET_MODE=managed-testnet"),
}).strict();

export type ExecuteSwapInput = z.input<typeof executeSwapSchema>;

export const executeSwapTool = {
  name: "execute_swap",
  description: "Swap tokens via FaroSwap with built-in risk gate. Runs risk assessment first, blocks if score > 80.",
  inputSchema: executeSwapSchema,
};

export async function handleExecuteSwap(raw: ExecuteSwapInput) {
  let input: z.infer<typeof executeSwapSchema>;
  try {
    input = executeSwapSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `execute_swap input validation failed: ${msg}`, false, "execute_swap");
  }

  const amtErr = validatePositiveAmount(input.amountIn, "amountIn");
  if (amtErr) return fail("VALIDATION_ERROR", amtErr, false, "execute_swap");

  const gate = await requireManagedExecutionReady("execute_swap", input.agentId);
  if (isManagedExecutionFailure(gate)) return gate;
  const { signer } = gate;
  const walletAddress = signer.address;

  const policy = evaluateActionPolicy({
    actionType: "execute_swap",
    agentId: input.agentId,
    amount: input.amountIn,
    amountUnit: "TOKEN",
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: false,
    signerAvailable: true,
    requiresSigner: true,
  });
  if (policy.decision === "BLOCK") {
    return fail("POLICY_BLOCKED", policy.reasons.join(" ") || "Swap blocked by SafeHands policy.", false, "execute_swap");
  }

  if (Number(input.amountIn) > Number(MAX_TX_AMOUNT_PHRS) && input.tokenIn.toUpperCase() === "PHRS") {
    return fail("TX_LIMIT_EXCEEDED", `Swap amount exceeds the operator ceiling MAX_TX_AMOUNT_PHRS (${MAX_TX_AMOUNT_PHRS} PHRS), which bounds all agent policies. Raise MAX_TX_AMOUNT_PHRS to allow larger testnet swaps.`, false, "execute_swap");
  }

  const amountUsd = estimateUsd(input.amountIn, input.tokenIn);
  const dailyCheck = checkDailyLimit(walletAddress, amountUsd);
  if (!dailyCheck.allowed) {
    return fail(
      "DAILY_SPEND_LIMIT_EXCEEDED",
      `Daily spend limit reached. Spent $${dailyCheck.currentUsd.toFixed(2)} of $${dailyCheck.limitUsd.toFixed(2)} USD today. Remaining: $${dailyCheck.remainingUsd.toFixed(2)}. Resets at UTC midnight.`,
      false,
      "execute_swap"
    );
  }

  const risk = await assessRisk({
    action: "swap",
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amountIn,
    walletAddress,
  });

  if (risk.riskScore > RISK_BLOCK_THRESHOLD) {
    return fail("POLICY_BLOCKED", `Swap blocked — risk score ${risk.riskScore}/100: ${risk.suggestion}`, false, "execute_swap");
  }

  try {
    const quote = await getDodoRoute({
      fromToken: input.tokenIn,
      toToken: input.tokenOut,
      amountHuman: input.amountIn,
      walletAddress,
      slippage: input.slippageTolerance,
    });

    if (!quote.routeAvailable) {
      return fail("NO_ROUTE_AVAILABLE", "No swap route available — insufficient liquidity", true, "dodo_api");
    }

    const wallet = createPharosWalletClientFromAccount(signer.account);

    if (!isNativeToken(input.tokenIn)) {
      const tokenAddr = resolveTokenAddress(input.tokenIn);
      const decimals = resolveTokenDecimals(input.tokenIn);
      const amountWei = BigInt(toWei(input.amountIn, decimals));

      const allowance = (await publicClient.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [walletAddress, DODO_APPROVE_ADDRESS],
      })) as bigint;

      if (allowance < amountWei) {
        const approvalPolicy = evaluateActionPolicy({
          actionType: "approve_token",
          agentId: input.agentId,
          approvalAmount: input.amountIn,
          spender: DODO_APPROVE_ADDRESS,
          spenderVerified: true,
          chainId: CHAIN_ID,
          environment: PHAROS_ENVIRONMENT,
          isMainnet: false,
          signerAvailable: true,
          requiresSigner: true,
        });
        if (approvalPolicy.decision === "BLOCK") {
          return fail("POLICY_BLOCKED", `Swap approval blocked: ${approvalPolicy.reasons.join(" ")}`, false, "execute_swap");
        }
        const approveHash = await wallet.writeContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [DODO_APPROVE_ADDRESS, amountWei],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    const txHash = await wallet.sendTransaction({
      to: quote.to as `0x${string}`,
      value: BigInt(quote.value),
      data: quote.calldata as `0x${string}`,
      gas: BigInt(quote.gasLimit),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      return fail("TX_REVERTED", "execute_swap transaction was mined but reverted on-chain.", false, "execute_swap");
    }

    recordSpend(walletAddress, amountUsd);

    return ok({
      txHash,
      explorerUrl: getExplorerUrl(txHash),
      amountOut: quote.amountOut,
      usedFromToken: quote.usedFromToken,
      usedToToken: quote.usedToToken,
      wasSubstituted: quote.wasSubstituted,
      signerMode: signer.mode,
      walletAddress,
      gasUsed: receipt.gasUsed.toString(),
      policy,
      riskAssessment: { riskScore: risk.riskScore, wasBlocked: false },
      source: "execute_swap",
    });
  } catch (err) {
    return classifyExternalError("pharos_rpc", err);
  }
}
