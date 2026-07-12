// ─── EVM Call Analyzer (read-only) ─────────────────────────────────────
// Analyzes `to + calldata + value` (and, optionally, an existing tx hash) using
// only read-only JSON-RPC. Never executes, never sends a transaction.
// ────────────────────────────────────────────────────────────────────────

import { isAddress } from "viem";
import { canonicalContractEvidence, type CanonicalContractEvidence } from "./contractIntel.js";
import { makeResult, type AnalyzerResult, type ReadOnlyChainAccess } from "./types.js";

export type EvmTargetType = "EOA" | "contract" | "unknown";

export type EvmCallClass =
  | "native_transfer"
  | "contract_call"
  | "calldata_to_eoa"
  | "empty"
  | "invalid";

export interface EvmCallInput {
  to?: string;
  /** Calldata, e.g. 0x095ea7b3... */
  data?: string;
  /** Value as a decimal or hex string (wei). */
  value?: string;
  chainId?: number;
}

export interface EvmAnalysisDetails {
  to: string | null;
  toValid: boolean;
  hasCalldata: boolean;
  selector: string | null;
  valueProvided: boolean;
  valueIsPositive: boolean;
  isNativeValueTransfer: boolean;
  targetType: EvmTargetType;
  callClass: EvmCallClass;
  chainId: number | null;
  /** Per-network canonical recognition of `to` (null when not a known canonical). */
  canonicalContractEvidence: CanonicalContractEvidence | null;
}

function valueInfo(value: string | undefined): { provided: boolean; positive: boolean } {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { provided: false, positive: false };
  }
  const s = String(value).trim();
  try {
    return { provided: true, positive: BigInt(s) > 0n };
  } catch {
    const n = Number(s);
    return { provided: true, positive: Number.isFinite(n) && n > 0 };
  }
}

function hasCalldata(data: string | undefined): boolean {
  return typeof data === "string" && data !== "0x" && data.replace(/^0x/, "").length > 0;
}

function selectorOf(data: string | undefined): string | null {
  if (!data) return null;
  const hex = data.startsWith("0x") ? data : `0x${data}`;
  return hex.length >= 10 ? hex.slice(0, 10).toLowerCase() : null;
}

/** Classify a target address as EOA / contract / unknown using read-only eth_getCode. */
export async function classifyTarget(
  address: string,
  access?: ReadOnlyChainAccess,
): Promise<EvmTargetType> {
  if (!isAddress(address) || !access?.getCode) return "unknown";
  try {
    const code = await access.getCode(address as `0x${string}`);
    if (code === undefined || code === null || code === "0x" || code === "") return "EOA";
    return "contract";
  } catch {
    return "unknown";
  }
}

export async function analyzeEvmCall(
  input: EvmCallInput,
  access?: ReadOnlyChainAccess,
): Promise<AnalyzerResult<EvmAnalysisDetails>> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const to = input.to ?? null;
  const toValid = to === null ? true : isAddress(to);
  const calldata = hasCalldata(input.data);
  const selector = calldata ? selectorOf(input.data) : null;
  const { provided: valueProvided, positive: valueIsPositive } = valueInfo(input.value);
  const isNativeValueTransfer = valueIsPositive && !calldata;
  const toCanonical = to && toValid ? canonicalContractEvidence(to) : null;

  const targetType = to && toValid ? await classifyTarget(to, access) : "unknown";

  let callClass: EvmCallClass;
  let internalDecision: "ALLOW" | "BLOCK" | "REQUIRE_CONFIRMATION";
  let riskLevel: AnalyzerResult["riskLevel"];

  if (to !== null && !toValid) {
    callClass = "invalid";
    internalDecision = "BLOCK";
    riskLevel = "CRITICAL";
    reasons.push(`Target address is not a valid EVM address (${to}).`);
  } else if (!calldata && !valueIsPositive) {
    callClass = "empty";
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "MEDIUM";
    reasons.push("No calldata and no value: empty / no-op transaction.");
  } else if (isNativeValueTransfer) {
    callClass = "native_transfer";
    if (targetType === "contract") {
      internalDecision = "REQUIRE_CONFIRMATION";
      riskLevel = "MEDIUM";
      reasons.push("Native value sent to a contract with no calldata; may trigger a fallback/receive function.");
    } else if (targetType === "EOA") {
      internalDecision = "ALLOW";
      riskLevel = "LOW";
      reasons.push("Plain native value transfer to an EOA.");
    } else {
      // targetType === "unknown": recipient code could NOT be verified (RPC down /
      // no read-only client). Fail-closed — a security layer must not ALLOW when it
      // cannot rule out a hostile contract recipient. Ask for confirmation instead.
      internalDecision = "REQUIRE_CONFIRMATION";
      riskLevel = "MEDIUM";
      reasons.push("Native value transfer with unverifiable recipient code; confirm the recipient before sending.");
      warnings.push("Recipient code could not be verified (no read-only client).");
    }
  } else if (calldata) {
    if (targetType === "EOA") {
      callClass = "calldata_to_eoa";
      internalDecision = "REQUIRE_CONFIRMATION";
      riskLevel = "MEDIUM";
      warnings.push("Calldata sent to an address with no code (EOA); the call will not execute contract logic.");
    } else {
      callClass = "contract_call";
      internalDecision = "REQUIRE_CONFIRMATION";
      riskLevel = "MEDIUM";
      reasons.push(
        targetType === "contract"
          ? `Contract call to ${to} (selector ${selector ?? "n/a"}); unknown contract call requires confirmation.`
          : `Contract call (selector ${selector ?? "n/a"}); target code not verified; requires confirmation.`,
      );
      if (targetType === "unknown") warnings.push("Target code could not be verified (no read-only client).");
    }
  } else {
    callClass = "empty";
    internalDecision = "REQUIRE_CONFIRMATION";
    riskLevel = "MEDIUM";
  }

  return makeResult<EvmAnalysisDetails>({
    analyzer: "evm",
    decision: internalDecision === "BLOCK" ? "BLOCK" : internalDecision === "ALLOW" ? "ALLOW" : "REQUIRE_CONFIRMATION",
    internalDecision,
    riskLevel,
    reasons,
    warnings,
    analyzerStatus: targetType === "unknown" && (calldata || isNativeValueTransfer) ? "partial" : "ok",
    details: {
      to,
      toValid,
      hasCalldata: calldata,
      selector,
      valueProvided,
      valueIsPositive,
      isNativeValueTransfer,
      targetType,
      callClass,
      chainId: input.chainId ?? null,
      canonicalContractEvidence: toCanonical,
    },
  });
}

export interface EvmTxReceiptDetails {
  txHash: string;
  status: "success" | "reverted" | "unknown";
  blockNumber: string | null;
  gasUsed: string | null;
}

/**
 * Optional existing-transaction analysis via read-only eth_getTransactionReceipt.
 * Returns analyzerStatus "unavailable" when no read-only client is supplied
 * (keeps offline use safe). Never sends a transaction.
 */
export async function analyzeTxHash(
  txHash: string,
  access?: ReadOnlyChainAccess,
): Promise<AnalyzerResult<EvmTxReceiptDetails>> {
  const base = (status: AnalyzerResult["analyzerStatus"], details: EvmTxReceiptDetails, reasons: string[], warnings: string[] = []) =>
    makeResult<EvmTxReceiptDetails>({
      analyzer: "evm_tx",
      decision: "REQUIRE_CONFIRMATION",
      internalDecision: "REQUIRE_CONFIRMATION",
      riskLevel: "UNKNOWN",
      reasons,
      warnings,
      analyzerStatus: status,
      details,
    });

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return makeResult<EvmTxReceiptDetails>({
      analyzer: "evm_tx",
      decision: "BLOCK",
      internalDecision: "BLOCK",
      riskLevel: "CRITICAL",
      reasons: ["Invalid transaction hash."],
      warnings: [],
      analyzerStatus: "ok",
      details: { txHash, status: "unknown", blockNumber: null, gasUsed: null },
    });
  }

  if (!access?.getTransactionReceipt) {
    return base("unavailable", { txHash, status: "unknown", blockNumber: null, gasUsed: null }, ["Receipt analysis requires a read-only RPC client."]);
  }

  try {
    const r = (await access.getTransactionReceipt(txHash as `0x${string}`)) as
      | { status?: string; blockNumber?: bigint; gasUsed?: bigint }
      | null;
    if (!r) return base("unavailable", { txHash, status: "unknown", blockNumber: null, gasUsed: null }, ["Transaction not found or not yet mined."]);
    const status = r.status === "success" ? "success" : r.status === "reverted" ? "reverted" : "unknown";
    return base("ok", {
      txHash,
      status,
      blockNumber: r.blockNumber !== undefined ? r.blockNumber.toString() : null,
      gasUsed: r.gasUsed !== undefined ? r.gasUsed.toString() : null,
    }, [status === "reverted" ? "Transaction reverted on-chain." : "Transaction receipt retrieved."]);
  } catch {
    return base("unavailable", { txHash, status: "unknown", blockNumber: null, gasUsed: null }, ["Could not read transaction receipt."]);
  }
}
