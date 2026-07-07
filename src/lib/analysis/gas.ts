// ─── Gas Analyzer (read-only) ──────────────────────────────────────────
// Estimates gas via read-only eth_estimateGas (when a client is supplied) and
// recommends a buffered gas limit. Never submits a transaction. Offline-safe:
// without an estimator it returns REQUIRE_CONFIRMATION rather than guessing.
// ────────────────────────────────────────────────────────────────────────

import { isReadOnlyMethod } from "../pharos/rpcMethods.js";
import { makeResult, type AnalyzerResult, type ReadOnlyChainAccess } from "./types.js";

export const DEFAULT_GAS_BUFFER_PCT = 20;

export interface GasAnalysisInput {
  to?: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  account?: `0x${string}`;
  /** Buffer percentage applied to the raw estimate. Defaults to 20%. */
  bufferPct?: number;
}

export interface GasAnalysisDetails {
  estimated: string | null;
  bufferPct: number;
  recommended: string | null;
  estimateSource: "rpc" | "none";
  /** Read-only RPC fee/gas method capability (from the Pharos method matrix). */
  feeDataAvailable: boolean;
  feeHistoryAvailable: boolean;
  priorityFeeAvailable: boolean;
  estimateGasAvailable: boolean;
  /** True when no live estimator was supplied (offline/capability-only). */
  fallbackUsed: boolean;
}

/** Read-only fee/gas method capability, derived from the Pharos method matrix. */
function gasCapability(access?: ReadOnlyChainAccess) {
  return {
    feeDataAvailable: isReadOnlyMethod("eth_gasPrice"),
    feeHistoryAvailable: isReadOnlyMethod("eth_feeHistory"),
    priorityFeeAvailable: isReadOnlyMethod("eth_maxPriorityFeePerGas"),
    estimateGasAvailable: isReadOnlyMethod("eth_estimateGas"),
    fallbackUsed: !access?.estimateGas,
  };
}

/** Apply a buffer percentage to a raw gas estimate (integer math). */
export function recommendGasWithBuffer(estimate: bigint, bufferPct: number = DEFAULT_GAS_BUFFER_PCT): bigint {
  const pct = BigInt(Math.max(0, Math.trunc(bufferPct)));
  return estimate + (estimate * pct) / 100n;
}

export async function analyzeGas(
  input: GasAnalysisInput,
  access?: ReadOnlyChainAccess,
): Promise<AnalyzerResult<GasAnalysisDetails>> {
  const bufferPct = input.bufferPct ?? DEFAULT_GAS_BUFFER_PCT;
  const cap = gasCapability(access);

  if (!access?.estimateGas) {
    return makeResult<GasAnalysisDetails>({
      analyzer: "gas",
      decision: "REQUIRE_CONFIRMATION",
      internalDecision: "REQUIRE_CONFIRMATION",
      riskLevel: "UNKNOWN",
      reasons: ["Gas estimate requires a read-only RPC client; none supplied."],
      warnings: [],
      analyzerStatus: "unavailable",
      details: { estimated: null, bufferPct, recommended: null, estimateSource: "none", ...cap },
    });
  }

  try {
    const estimate = await access.estimateGas({
      to: input.to,
      data: input.data,
      value: input.value,
      account: input.account,
    });
    const recommended = recommendGasWithBuffer(estimate, bufferPct);
    return makeResult<GasAnalysisDetails>({
      analyzer: "gas",
      decision: "ALLOW",
      internalDecision: "ALLOW",
      riskLevel: "LOW",
      reasons: [`Gas estimated at ${estimate.toString()}; recommended ${recommended.toString()} (+${bufferPct}% buffer).`],
      warnings: [],
      analyzerStatus: "ok",
      details: { estimated: estimate.toString(), bufferPct, recommended: recommended.toString(), estimateSource: "rpc", ...cap },
    });
  } catch (err) {
    return makeResult<GasAnalysisDetails>({
      analyzer: "gas",
      decision: "REQUIRE_CONFIRMATION",
      internalDecision: "REQUIRE_CONFIRMATION",
      riskLevel: "MEDIUM",
      reasons: [`Gas estimate failed (${err instanceof Error ? err.message : String(err)}). The call may revert — review before proceeding.`],
      warnings: ["A failing gas estimate often means the transaction would revert."],
      analyzerStatus: "partial",
      details: { estimated: null, bufferPct, recommended: null, estimateSource: "rpc", ...cap },
    });
  }
}
