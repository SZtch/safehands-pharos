// ─── Tool: execute_swap ────────────────────────────────────────────────
import { z } from "zod";
import { isAddress, type Account } from "viem";
import { publicClient, createPharosWalletClientFromAccount, getExplorerUrl } from "../lib/pharosClient.js";
import { getDodoRoute, isNativeToken, resolveTokenAddress, resolveTokenDecimals, toWei, DodoNotConfiguredError } from "../lib/dodoApi.js";
import { addressTrustEvidence } from "../lib/ecosystemRegistry.js";
import { assessRisk } from "../lib/riskEngine.js";
import { fail, ok, classifyExternalError } from "../lib/toolResponse.js";
import { ERC20_ABI, MAX_SLIPPAGE_PCT, MAX_TX_AMOUNT_PROS, CHAIN_ID, PHAROS_ENVIRONMENT, IS_MAINNET, isAllowedDodoRouter, isAllowedDodoSpender, activeDodoRouterAllowlist, activeDodoSpenderAllowlist } from "../lib/constants.js";
import { requireManagedExecutionReady, isManagedExecutionFailure } from "../lib/managedExecution.js";
import { evaluateActionPolicy, riskEvidenceFromAssessment } from "../lib/policy/actionPolicyEngine.js";
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
  confirm: z.boolean().optional().default(false).describe("Explicit acknowledgement to proceed when SafeHands returns REQUIRE_CONFIRMATION / REQUIRE_TOKEN_REVIEW. Hard BLOCK / honeypot / over-limit / unpriceable input token / missing token-security intel are never overridable."),
}).strict();

export type ExecuteSwapInput = z.input<typeof executeSwapSchema>;

/**
 * P1-1: hard, non-confirmable quote guards. An unfavorable price is embedded in
 * the quote ITSELF — minReturn/slippage only protect against movement AFTER
 * quoting — so a quote whose priceImpact exceeds the ceiling must hard-stop
 * here, before any signing. The ceiling is the caller's slippageTolerance or
 * MAX_SLIPPAGE_PCT, whichever is larger. Pure + exported for offline tests.
 */
export function evaluateSwapQuoteGuards(
  quote: { priceImpact: number; amountOut: string },
  slippageTolerance?: number
): { code: string; message: string } | null {
  const ceilingPct = Math.max(slippageTolerance ?? 0, MAX_SLIPPAGE_PCT);
  const impact = Math.abs(quote.priceImpact);
  if (!Number.isFinite(impact) || impact > ceilingPct) {
    return {
      code: "PRICE_IMPACT_TOO_HIGH",
      message: `Swap blocked — quoted price impact ${Number.isFinite(impact) ? impact.toFixed(2) : "unknown"}% exceeds the ${ceilingPct}% ceiling (max of slippageTolerance and MAX_SLIPPAGE_PCT ${MAX_SLIPPAGE_PCT}%). The unfavorable price is in the quote itself, so slippage protection cannot mitigate it; this is a hard stop and is never confirmable. Reduce the trade size or use a deeper route.`,
    };
  }
  const amountOut = Number.parseFloat(quote.amountOut);
  if (!Number.isFinite(amountOut) || amountOut <= 0) {
    return {
      code: "INVALID_QUOTE_AMOUNT_OUT",
      message: `Swap blocked — DODO quote returned a non-positive amountOut (${quote.amountOut}). Broadcasting would spend tokenIn for nothing; this is a hard stop and is never confirmable.`,
    };
  }
  return null;
}

/**
 * P1-4: simulate the exact swap call via eth_call and return the revert reason,
 * or null when the call succeeds. The final broadcast passes an explicit
 * `gas: quote.gasLimit`, which bypasses viem's implicit estimateGas revert
 * check — without this a reverting route would burn gas on-chain. Takes the
 * client structurally so it is unit-testable offline.
 */
export async function simulateSwapCalldata(
  client: { call(args: { account: Account | `0x${string}`; to: `0x${string}`; value: bigint; data: `0x${string}` }): Promise<unknown> },
  args: { account: Account | `0x${string}`; to: `0x${string}`; value: bigint; data: `0x${string}` }
): Promise<string | null> {
  try {
    await client.call(args);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export const executeSwapTool = {
  name: "execute_swap",
  description: "Swap tokens via FaroSwap/DODO. Runs a risk assessment first and feeds it as evidence to the SafeHands policy engine — the sole ALLOW/BLOCK/REQUIRE_CONFIRMATION decider (a risk score above the block threshold fails its risk_score check and blocks, never confirmable). Gated by WRITE_TOOLS_ENABLED.",
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
  // Honeypot / extreme-tax → hard block; reviewed-and-flagged → "unknown" →
  // REQUIRE_TOKEN_REVIEW (confirmable after review); intel MISSING (outage /
  // unindexed, non-registry) → "unavailable" → the write gate fails closed (P0-2).
  let tokenSecurityStatus: "ok" | "unknown" | "unavailable" | undefined;
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

  const risk = await assessRisk({
    action: "swap",
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amountIn,
    walletAddress,
  });

  // Sole decision point: ONE policy evaluation over all collected evidence,
  // including the advisory risk assessment. Never gate on riskEngine output
  // directly — the policy engine's risk_* checks do that (never-weaken parity
  // with the former direct gates; requireRiskEvidence makes a wiring miss fail
  // closed instead of silently losing the risk gates).
  // P0-3 lives here too: an unpriceable input token escaped the USD caps read
  // by checkDailyLimit above, and swap_notional_unpriceable → BLOCK (never
  // confirmable) stops it before any quote is fetched or budget is reserved.
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
    risk: riskEvidenceFromAssessment(risk),
  });
  const swapGate = enforceWriteDecision(policy, { confirmed: input.confirm === true, toolName: "execute_swap", requireRiskEvidence: true });
  if (swapGate) return swapGate;

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

    const quoteGuard = evaluateSwapQuoteGuards(quote, input.slippageTolerance);
    if (quoteGuard) {
      return fail(quoteGuard.code, quoteGuard.message, false, "execute_swap");
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
        // spenderVerified comes ONLY from registry evidence. Allowlist membership
        // (checked above) is containment, not verification — asserting it as
        // "verified" fabricated a trust claim for a testnet-provenance address.
        const spenderEvidence = addressTrustEvidence(approveAddress, CHAIN_ID);
        const approvalPolicy = evaluateActionPolicy({
          actionType: "approve_token",
          agentId: input.agentId,
          approvalAmount: input.amountIn,
          spender: approveAddress,
          spenderVerified: spenderEvidence.verifiedCanonical ? true : undefined,
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

    // P1-4: pre-broadcast simulation of the exact calldata (after the approval
    // above so the allowance is visible to eth_call). A reverting route fails
    // here for free instead of burning gas on-chain.
    const simulationError = await simulateSwapCalldata(publicClient, {
      account: signer.account,
      to: quote.to as `0x${string}`,
      value: BigInt(quote.value),
      data: quote.calldata as `0x${string}`,
    });
    if (simulationError !== null) {
      return fail(
        "SWAP_SIMULATION_REVERTED",
        `Pre-broadcast simulation of the swap calldata reverted — broadcasting would only burn gas. ${simulationError}`,
        true,
        "execute_swap"
      );
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
    if (err instanceof DodoNotConfiguredError) {
      return fail("SWAP_LIQUIDITY_NOT_CONFIGURED", err.message, false, "dodo_api");
    }
    return classifyExternalError("pharos_rpc", err);
  }
}
