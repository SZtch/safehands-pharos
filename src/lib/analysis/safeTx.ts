// ─── Safe / MultiSend Analyzer (read-only, Experimental) ───────────────
// Recognizes Safe transactions and decodes MultiSend batches on a best-effort
// basis. The highest-risk inner call drives the aggregate decision. Deep decode
// is Experimental — partial/unparsable input is reported clearly. Never submits
// a Safe transaction and never co-signs.
// ────────────────────────────────────────────────────────────────────────

import { bytesToBigInt, bytesToHex, decodeFunctionData, hexToBytes } from "viem";
import { analyzeApproval, APPROVE_SELECTOR } from "./approval.js";
import { canonicalContractEvidence, type CanonicalContractEvidence } from "./contractIntel.js";
import { analyzeEvmCall } from "./evm.js";
import { makeResult, type AnalyzerResult } from "./types.js";
import type { GuardianDecision } from "../guardian/decision.js";

export const MULTISEND_SELECTOR = "0x8d80ff0a";
export const SAFE_EXEC_SELECTOR = "0x6a761202"; // execTransaction(...)

const MULTISEND_ABI = [
  { name: "multiSend", type: "function", stateMutability: "payable", inputs: [{ name: "transactions", type: "bytes" }], outputs: [] },
] as const;

export interface SafeInnerCall {
  index: number;
  operation: number; // 0 = call, 1 = delegatecall
  to: string;
  value: string;
  dataLength: number;
  selector: string | null;
  decision: GuardianDecision;
  summary: string;
  /** Per-network canonical recognition of this inner call's target (null when unknown). */
  canonicalContractEvidence: CanonicalContractEvidence | null;
}

export interface SafeTxAnalysisDetails {
  kind: "multisend" | "safe_exec" | "unknown";
  selector: string | null;
  innerCallCount: number | null;
  innerCalls: SafeInnerCall[];
  hasDelegateCall: boolean;
  fullyDecoded: boolean;
}

const SEVERITY: Record<GuardianDecision, number> = { ALLOW: 0, PREPARE_ONLY: 1, REQUIRE_CONFIRMATION: 2, BLOCK: 3 };
function worst(a: GuardianDecision, b: GuardianDecision): GuardianDecision {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

interface RawInnerCall {
  index: number;
  operation: number;
  to: string;
  value: string;
  dataLength: number;
  data: string;
}

function decodeMultiSendBatch(transactions: `0x${string}`): RawInnerCall[] {
  const buf = hexToBytes(transactions);
  const calls: RawInnerCall[] = [];
  let i = 0;
  while (i < buf.length) {
    const operation = buf[i]; i += 1;
    const to = bytesToHex(buf.slice(i, i + 20)); i += 20;
    const value = bytesToBigInt(buf.slice(i, i + 32)); i += 32;
    const dataLen = Number(bytesToBigInt(buf.slice(i, i + 32))); i += 32;
    const data = bytesToHex(buf.slice(i, i + dataLen)); i += dataLen;
    calls.push({ index: calls.length, operation, to, value: value.toString(), dataLength: dataLen, data });
  }
  return calls;
}

export async function analyzeSafeTx(data: string): Promise<AnalyzerResult<SafeTxAnalysisDetails>> {
  const reasons: string[] = [];
  const warnings: string[] = ["Safe/MultiSend decoding is Experimental — verify the full batch independently before signing."];
  const hex = (data?.startsWith("0x") ? data : `0x${data ?? ""}`).toLowerCase();
  const selector = hex.length >= 10 ? hex.slice(0, 10) : null;

  const partial = (kind: SafeTxAnalysisDetails["kind"], msg: string): AnalyzerResult<SafeTxAnalysisDetails> =>
    makeResult<SafeTxAnalysisDetails>({
      analyzer: "safe_tx",
      decision: "REQUIRE_CONFIRMATION",
      internalDecision: "REQUIRE_CONFIRMATION",
      riskLevel: "UNKNOWN",
      reasons: [msg],
      warnings,
      analyzerStatus: "partial",
      experimental: true,
      details: { kind, selector, innerCallCount: null, innerCalls: [], hasDelegateCall: false, fullyDecoded: false },
    });

  if (selector === SAFE_EXEC_SELECTOR) {
    return partial("safe_exec", "Recognized a Safe execTransaction call; nested call decode is not performed (Experimental).");
  }
  if (selector !== MULTISEND_SELECTOR) {
    return partial("unknown", `Not a recognized Safe/MultiSend selector (${selector ?? "n/a"}).`);
  }

  let transactions: `0x${string}`;
  try {
    const decoded = decodeFunctionData({ abi: MULTISEND_ABI, data: hex as `0x${string}` });
    transactions = decoded.args[0] as `0x${string}`;
  } catch {
    return partial("multisend", "MultiSend payload could not be ABI-decoded (Experimental, partial).");
  }

  let rawCalls: RawInnerCall[];
  try {
    rawCalls = decodeMultiSendBatch(transactions);
  } catch {
    return partial("multisend", "MultiSend batch bytes could not be parsed (Experimental, partial).");
  }

  let aggregate: GuardianDecision = "ALLOW";
  let hasDelegateCall = false;
  const innerCalls: SafeInnerCall[] = [];

  for (const c of rawCalls) {
    const sel = c.data && c.data.length >= 10 ? c.data.slice(0, 10).toLowerCase() : null;
    if (c.operation === 1) hasDelegateCall = true;
    let decision: GuardianDecision;
    let summary: string;
    if (sel === APPROVE_SELECTOR) {
      const a = analyzeApproval(c.data, c.to);
      decision = a.decision;
      summary = a.reasons[0] ?? "approval";
    } else {
      const e = await analyzeEvmCall({ to: c.to, data: c.data, value: c.value });
      decision = e.decision;
      summary = e.reasons[0] ?? e.details.callClass;
    }
    // A delegatecall in a batch is inherently higher-risk.
    if (c.operation === 1) decision = worst(decision, "REQUIRE_CONFIRMATION");
    aggregate = worst(aggregate, decision);
    innerCalls.push({ index: c.index, operation: c.operation, to: c.to, value: c.value, dataLength: c.dataLength, selector: sel, decision, summary, canonicalContractEvidence: canonicalContractEvidence(c.to) });
  }

  if (hasDelegateCall) warnings.push("Batch contains a delegatecall (operation=1) — elevated risk.");
  reasons.push(`Decoded MultiSend batch with ${innerCalls.length} inner call(s); aggregate decision follows the highest-risk inner call.`);

  const riskLevel = aggregate === "BLOCK" ? "CRITICAL" : aggregate === "REQUIRE_CONFIRMATION" ? "MEDIUM" : "LOW";

  return makeResult<SafeTxAnalysisDetails>({
    analyzer: "safe_tx",
    decision: aggregate,
    internalDecision: aggregate,
    riskLevel,
    reasons,
    warnings,
    analyzerStatus: "ok",
    experimental: true,
    details: { kind: "multisend", selector, innerCallCount: innerCalls.length, innerCalls, hasDelegateCall, fullyDecoded: true },
  });
}
