// ─── Activity Sanitization ─────────────────────────────────────────────
// Builds a PUBLIC, sanitized activity item from a decision/analysis request +
// its response payload. The cardinal rule: a strict field WHITELIST — we never
// spread a request body or response into the item. Only coarse, non-sensitive
// derivatives are kept:
//   • decision / riskLevel / network / chainId / readOnly / executionAvailable
//   • a short reason summary (with any long hex redacted)
//   • a coarse target (type + shortened address + 4-byte selector + short txHash)
//   • evidence TYPE names only (never their values)
// Never stored: full payloads, full addresses, full calldata, full URLs, full
// x402 payment requests, private keys, signatures, raw signed txs, API keys,
// secret RPC URLs, sensitive headers, wallet secrets.
// Pure + offline. No signing/wallet/write primitives anywhere in this file.
// ────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { getActiveNetwork, getActiveNetworkName } from "../networks.js";

export type CallerType = "api" | "agent" | "a2a" | "unknown";

export type TargetType =
  | "contract"
  | "eoa"
  | "address"
  | "url"
  | "text"
  | "tx"
  | "unknown"
  | "none";

export interface ActivityTarget {
  type: TargetType;
  /** Shortened address `0x1234…cdef` (never the full address). */
  addressShort: string | null;
  /** 4-byte function selector `0x########` (never full calldata). */
  selector: string | null;
  /** Shortened tx hash `0x1234…cdef` (never the full hash). */
  txHashShort: string | null;
}

export interface ActivityItem {
  id: string;
  ts: string;
  requestId: string;
  endpoint: string;
  /** Endpoint class (api | agent | a2a | unknown) — drives metrics totals. */
  callerType: CallerType;
  /** Access tier (anonymous | api-key | agent | a2a) — caller identity. */
  accessTier: string;
  /** keyId (hash prefix) for a valid key — never the raw key. */
  keyId: string | null;
  /** Sanitized, untrusted, display-only identity. */
  agentId: string | null;
  a2aPeerId: string | null;
  /** Applied policy preset — agent decisions only; null otherwise. */
  policyPreset: string | null;
  network: string;
  chainId: number;
  checkType: string | null;
  intentType: string | null;
  decision: string | null;
  riskLevel: string | null;
  reasonSummary: string;
  evidenceTypes: string[];
  readOnly: boolean;
  executionAvailable: boolean;
  target: ActivityTarget;
  preparedTransactionId?: string | null;
  preparedTransactionHashShort?: string | null;
  broadcastStatus?: string | null;
  attestationStatus?: string | null;
  executionStatus?: string | null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TXHASH_RE = /^0x[0-9a-fA-F]{64}$/;
// Any 0x hex run of 8+ nibbles (addresses, hashes, calldata) embedded in text.
const LONG_HEX_RE = /0x[0-9a-fA-F]{8,}/g;

const REASON_MAX = 160;

/** Names of evidence blocks we may report as PRESENT (never their contents). */
const EVIDENCE_KEYS = [
  "ecosystemEvidence",
  "rpcEvidence",
  "gasEvidence",
  "pharosEvidence",
  "canonicalContractEvidence",
  "tokenRegistryEvidence",
] as const;

function shortenHex(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** `0x1234…cdef` for a valid 20-byte address, else null. */
export function shortenAddress(value: unknown): string | null {
  return typeof value === "string" && ADDRESS_RE.test(value) ? shortenHex(value) : null;
}

/** `0x1234…cdef` for a valid 32-byte tx hash, else null. */
export function shortenTxHash(value: unknown): string | null {
  return typeof value === "string" && TXHASH_RE.test(value) ? shortenHex(value) : null;
}

/** 4-byte selector `0x########` from calldata, else null. */
export function selectorOf(data: unknown): string | null {
  if (typeof data !== "string" || !data.startsWith("0x") || data.length < 10) return null;
  return data.slice(0, 10).toLowerCase();
}

/** Replace any long 0x hex run with a shortened form so no full hex leaks via text. */
export function redactLongHex(text: string): string {
  return text.replace(LONG_HEX_RE, (m) => shortenHex(m));
}

// Pull a candidate value from common request shapes (direct, or nested under the
// agent/a2a action keys), reading ONLY whitelisted scalar fields.
function pickNested(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b[key] === "string") return b[key];
  for (const wrap of ["intent", "requestedAction", "action"]) {
    const inner = b[wrap];
    if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>)[key] === "string") {
      return (inner as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

function pickAddress(body: unknown): string | undefined {
  return (pickNested(body, "to") ?? pickNested(body, "address") ?? pickNested(body, "spender")) as
    | string
    | undefined;
}
function pickData(body: unknown): string | undefined {
  return pickNested(body, "data") as string | undefined;
}
function pickTxHash(body: unknown): string | undefined {
  return pickNested(body, "txHash") as string | undefined;
}
function hasUrl(body: unknown): boolean {
  return typeof pickNested(body, "url") === "string" || typeof pickNested(body, "paymentAmountUsdc") === "string";
}
function hasText(body: unknown): boolean {
  return typeof pickNested(body, "text") === "string";
}

function evidenceTypesOf(payload: unknown): string[] {
  const found = new Set<string>();
  const scan = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    for (const k of EVIDENCE_KEYS) if (o[k] != null) found.add(k);
  };
  scan(payload);
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    scan(p.details);
    scan(p.evidence);
    if (Array.isArray(p.analyzers)) {
      for (const a of p.analyzers) {
        scan(a);
        if (a && typeof a === "object") scan((a as Record<string, unknown>).details);
      }
    }
  }
  return [...found];
}

function reportedTargetType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const fromDetails = (d: unknown): string | null => {
    if (d && typeof d === "object") {
      const t = (d as Record<string, unknown>).targetType;
      if (t === "contract" || t === "eoa") return t;
    }
    return null;
  };
  if (Array.isArray(p.analyzers)) {
    for (const a of p.analyzers) {
      if (a && typeof a === "object") {
        const t = fromDetails((a as Record<string, unknown>).details);
        if (t) return t;
      }
    }
  }
  return fromDetails(p.details);
}

function deriveTargetType(body: unknown, payload: unknown): TargetType {
  const reported = reportedTargetType(payload);
  if (reported === "contract" || reported === "eoa") return reported;
  if (typeof pickNested(body, "address") === "string") return "contract";
  if (pickTxHash(body)) return "tx";
  if (hasUrl(body)) return "url";
  if (hasText(body)) return "text";
  const data = pickData(body);
  if (typeof data === "string" && data.length > 2) return "contract";
  if (pickAddress(body)) return "address";
  return "none";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function firstReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  if (typeof p.summary === "string") return p.summary;
  if (Array.isArray(p.reasons) && typeof p.reasons[0] === "string") return p.reasons[0];
  if (p.details && typeof p.details === "object") {
    const d = p.details as Record<string, unknown>;
    if (typeof d.reason === "string") return d.reason;
  }
  return "";
}

export interface BuildActivityInput {
  endpoint: string;
  callerType: CallerType;
  requestId: string;
  durationMs?: number;
  body: unknown;
  payload: unknown;
  /** Sanitized caller identity. Optional so offline builders can omit it. */
  access?: AccessContextLike;
}

/** The whitelisted identity subset of AccessContext that activity may store. */
export interface AccessContextLike {
  callerType: string;
  keyId: string | null;
  agentId: string | null;
  a2aPeerId: string | null;
}

/**
 * Build a sanitized {@link ActivityItem}. Reads only whitelisted derivatives —
 * the raw body/payload are NEVER copied into the result.
 */
export function toActivityItem(input: BuildActivityInput): ActivityItem {
  const { endpoint, callerType, requestId, body, payload } = input;
  const p = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;

  const network = str(p.network) ?? getActiveNetworkName();
  const chainId = typeof p.chainId === "number" ? p.chainId : getActiveNetwork().chainId;

  const checkType = endpoint.startsWith("/analyze/")
    ? endpoint.slice("/analyze/".length)
    : endpoint === "/guardian/check"
      ? str(pickNested(body, "inputType")) ?? "evm"
      : null;

  const target: ActivityTarget = {
    type: deriveTargetType(body, payload),
    addressShort: shortenAddress(pickAddress(body)),
    selector: selectorOf(pickData(body)),
    txHashShort: shortenTxHash(pickTxHash(body) ?? (payload as any)?.txHash),
  };

  const access = input.access;
  return {
    id: randomBytes(8).toString("hex"),
    ts: new Date().toISOString(),
    requestId,
    endpoint,
    callerType,
    accessTier: access?.callerType ?? "anonymous",
    keyId: access?.keyId ?? null,
    agentId: access?.agentId ?? null,
    a2aPeerId: access?.a2aPeerId ?? null,
    policyPreset: str(p.policyPreset),
    network,
    chainId,
    checkType,
    intentType: str(p.intent),
    decision: str(p.decision),
    riskLevel: str(p.riskLevel),
    reasonSummary: redactLongHex(firstReason(payload)).slice(0, REASON_MAX),
    evidenceTypes: evidenceTypesOf(payload),
    readOnly: p.readOnly === false ? false : true,
    executionAvailable: p.executionAvailable === true,
    target,
    preparedTransactionId: str(pickNested(body, "preparedTransactionId")),
    preparedTransactionHashShort: shortenTxHash(pickNested(body, "preparedTransactionHash")),
    broadcastStatus: str(p.broadcastStatus),
    attestationStatus: str(p.attestationStatus),
    executionStatus: str(p.executionStatus),
  };
}

/** Map an endpoint path to its caller category for activity/logging. */
export function callerTypeForEndpoint(endpoint: string): CallerType {
  if (endpoint === "/agent/a2a/check") return "a2a";
  if (endpoint === "/agent/check") return "agent";
  if (endpoint === "/guardian/check" || endpoint === "/prepare/tx" || endpoint === "/wallet/prepare" || endpoint === "/broadcast/signed" || endpoint.startsWith("/analyze/")) return "api";
  return "unknown";
}
