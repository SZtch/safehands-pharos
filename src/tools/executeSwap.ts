// ─── Tool: execute_swap ────────────────────────────────────────────────
import { z } from "zod";
import { isAddress } from "viem";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { getDodoRoute, isNativeToken, resolveTokenAddress, resolveTokenDecimals, toWei } from "../lib/dodoApi.js";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { ERC20_ABI, RISK_BLOCK_THRESHOLD, MAX_TX_AMOUNT_PROS, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, isAllowedDodoRouter, isAllowedDodoSpender, activeDodoRouterAllowlist, activeDodoSpenderAllowlist } from "../lib/constants.js";
import { requireManagedExecutionReady, isManagedExecutionFailure } from "../lib/managedExecution.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { enforceWriteDecision } from "../lib/policy/writeExecutionGate.js";
import { evaluateTokenSecurityGate } from "./checkTokenSecurity.js";
import { checkDailyLimit, reserveDailyLimit, releaseReservation, estimateUsd } from "../lib/spendAccumulator.js";
import { validatePositiveAmount } from "../lib/validation.js";

export const executeSwapSchema = z.object({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  slippageTolerance: z.number().optional().describe("Override auto slippage. Default: 3 (Auto mode adjusts to 0.5 for major, 0.1 for stablecoins)"),
  agentId: z.string().optional().describe("Managed wallet agentId when WALLET_MODE=managed-mainnet"),
  confirm: z.boolean().optional().default(false).describe("Explicit acknowledgement to proceed when SafeHands returns REQUIRE_CONFIRMATION / REQUIRE_TOKEN_REVIEW. Hard BLOCK / honeypot / over-limit are never overridable."),
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

  // H3: consult token-security (GoPlus honeypot/tax) on the token being acquired.
  // Honeypot / extreme-tax → hard block; flagged or provider-unavailable →
  // tokenSecurityStatus="unknown" → REQUIRE_TOKEN_REVIEW (confirmable after review).
  let tokenSecurityStatus: "ok" | "unknown" | undefined;
  if (!isNativeToken(input.tokenOut)) {
    let outAddr: string;
    try {
      outAddr = isAddress(input.tokenOut) ? input.tokenOut : resolveTokenAddress(input.tokenOut);
    } catch {
      outAddr = input.tokenOut;
    }
    const sec = await evaluateTokenSecurityGate(outAddr);
    if (sec.verdict === "block") {
      return fail("TOKEN_SECURITY_BLOCKED", `Swap blocked — ${sec.detail ?? "token failed security review"} ${sec.flags.join("; ")}`.trim(), false, "execute_swap");
    }
    tokenSecurityStatus = sec.policyStatus;
  }

  const policy = evaluateActionPolicy({
    actionType: "execute_swap",
    agentId: input.agentId,
    amount: input.amountIn,
    amountUnit: "TOKEN",
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    tokenSecurityStatus,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: IS_MAINNET,
    signerAvailable: true,
    requiresSigner: true,
  });
  const swapGate = enforceWriteDecision(policy, { confirmed: input.confirm === true, toolName: "execute_swap" });
  if (swapGate) return swapGate;

  if (Number(input.amountIn) > Number(MAX_TX_AMOUNT_PROS) && input.tokenIn.toUpperCase() === "PROS") {
    return fail("TX_LIMIT_EXCEEDED", `Swap amount exceeds the operator ceiling MAX_TX_AMOUNT_PROS (${MAX_TX_AMOUNT_PROS} PROS), which bounds all agent policies. Raise MAX_TX_AMOUNT_PROS to allow larger mainnet swaps.`, false, "execute_swap");
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

  // M2: an unknown/unpriceable input token cannot be bounded by the USD daily cap
  // (estimateUsd returns 0), so it would otherwise slip past MAX_DAILY_SPEND_USD.
  // Require explicit confirmation rather than allowing a silent unbounded spend.
  const tokenInUpper = input.tokenIn.toUpperCase();
  const spentTokenPriceable = tokenInUpper === "PROS" || tokenInUpper === "USDC" || tokenInUpper === "USDT";
  if (!spentTokenPriceable && Number(input.amountIn) > 0 && input.confirm !== true) {
    return fail(
      "CONFIRMATION_REQUIRED",
      `execute_swap spends ${input.tokenIn}, which SafeHands cannot price for the daily USD cap — this spend is not bounded by MAX_DAILY_SPEND_USD. Re-invoke with confirm=true only after review.`,
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

  if (risk.riskScore > RISK_BLOCK_THRESHOLD || risk.recommendation === "block") {
    return fail("POLICY_BLOCKED", `Swap blocked — risk score ${risk.riskScore}/100: ${risk.suggestion}`, false, "execute_swap");
  }
  // H2: never sign silently on degraded risk data — require explicit confirmation.
  if (risk.degraded && input.confirm !== true) {
    return fail("CONFIRMATION_REQUIRED", `Swap risk assessment is degraded — ${risk.degradedReasons.join(" ")} Re-invoke with confirm=true only after manual review.`, false, "execute_swap");
  }

  let reserved = false;
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

    if (!isAddress(quote.to) || !isAllowedDodoRouter(quote.to)) {
      return fail(
        "UNTRUSTED_DODO_ROUTER",
        `DODO quote returned untrusted router/tx target ${quote.to}. Configure DODO_ROUTER_ALLOWLIST/SAFEHANDS_DODO_ROUTER_ALLOWLIST with a verified router before enabling mainnet swap execution. Current allowlist: ${activeDodoRouterAllowlist().join(",") || "empty"}`,
        false,
        "execute_swap"
      );
    }

    if (!isNativeToken(input.tokenIn) && (!isAddress(quote.approveAddress) || !isAllowedDodoSpender(quote.approveAddress))) {
      return fail(
        "UNTRUSTED_DODO_SPENDER",
        `DODO quote returned untrusted approval target ${quote.approveAddress}. Configure DODO_SPENDER_ALLOWLIST/SAFEHANDS_DODO_SPENDER_ALLOWLIST with a verified approve proxy before enabling mainnet token swaps. Current allowlist: ${activeDodoSpenderAllowlist().join(",") || "empty"}`,
        false,
        "execute_swap"
      );
    }

    const wallet = createPharosWalletClientFromAccount(signer.account);

    if (!isNativeToken(input.tokenIn)) {
      const tokenAddr = resolveTokenAddress(input.tokenIn);
      const decimals = resolveTokenDecimals(input.tokenIn);
      const amountWei = BigInt(toWei(input.amountIn, decimals));

      const approveAddress = quote.approveAddress as `0x${string}`;

      const allowance = (await publicClient.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [walletAddress, approveAddress],
      })) as bigint;

      if (allowance < amountWei) {
        const approvalPolicy = evaluateActionPolicy({
          actionType: "approve_token",
          agentId: input.agentId,
          approvalAmount: input.amountIn,
          spender: approveAddress,
          spenderVerified: isAllowedDodoSpender(approveAddress),
          chainId: CHAIN_ID,
          environment: PHAROS_ENVIRONMENT,
          isMainnet: IS_MAINNET,
          signerAvailable: true,
          requiresSigner: true,
        });
        const approvalGate = enforceWriteDecision(approvalPolicy, { confirmed: input.confirm === true, toolName: "execute_swap" });
        if (approvalGate) return approvalGate;
        const approveHash = await wallet.writeContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [approveAddress, amountWei],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    // M2: atomically reserve the daily-spend budget immediately before the swap
    // broadcast (no await between reserve and send). Released below on revert/error.
    const reservation = reserveDailyLimit(walletAddress, amountUsd);
    if (!reservation.allowed) {
      return fail(
        "DAILY_SPEND_LIMIT_EXCEEDED",
        `Daily spend limit reached. Spent $${reservation.currentUsd.toFixed(2)} of $${reservation.limitUsd.toFixed(2)} USD today. Remaining: $${reservation.remainingUsd.toFixed(2)}. Resets at UTC midnight.`,
        false,
        "execute_swap"
      );
    }

    reserved = amountUsd > 0;

    const txHash = await wallet.sendTransaction({
      to: quote.to as `0x${string}`,
      value: BigInt(quote.value),
      data: quote.calldata as `0x${string}`,
      gas: BigInt(quote.gasLimit),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      releaseReservation(walletAddress, amountUsd);
      return fail("TX_REVERTED", "execute_swap transaction was mined but reverted on-chain.", false, "execute_swap");
    }

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
    // Release the daily-spend reservation on a thrown broadcast/receipt error so a
    // swap that never landed does not permanently consume the cap (parity with
    // send_payment; the revert path above already releases).
    if (reserved) releaseReservation(walletAddress, amountUsd);
    return classifyExternalError("pharos_rpc", err);
  }
}
