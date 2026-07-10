// ─── SafeHands API — Route Handlers (read-only) ───────────────
// Pure handler functions: each takes a plain parsed-request object (+ optional
// read-only chain access) and returns a plain serializable payload. server.ts
// wraps these in the response envelope. They import ONLY the Phase 2 analyzers,
// the network registry, and the config/gates — never a signer, managed-wallet,
// write-tool, x402 facilitator, or publish module. There is no code path here to
// sign, send, approve, swap, create/load a wallet, or publish. Read-only by
// construction.
// ────────────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  analyzeEvmCall,
  analyzeTxHash,
  analyzeContract,
  analyzeApproval,
  analyzeSafeTx,
  analyzeCalldata,
  isDecodableCalldataSelector,
  analyzeX402,
  type AnalyzerResult,
  type AnalyzerRiskLevel,
  type ReadOnlyChainAccess,
} from "../lib/analysis/index.js";
import { APPROVE_SELECTOR } from "../lib/analysis/approval.js";
import { MULTISEND_SELECTOR } from "../lib/analysis/safeTx.js";
import { GUARDIAN_DECISIONS, type GuardianDecision } from "../lib/guardian/decision.js";
import {
  getActiveNetwork,
  getActiveNetworkName,
  getNetworkByChainId,
  isNetworkName,
  type PharosNetwork,
} from "../lib/networks.js";
import { getGates, isReadOnlyMode, getCapabilityFlags } from "../lib/config.js";
import {
  guardianCheckSchema,
  analyzeTxSchema,
  analyzeContractSchema,
  analyzeApprovalSchema,
  analyzeSafeSchema,
  analyzeCalldataSchema,
  analyzeX402Schema,
} from "./schemas.js";
import { readOnlyMeta, rpcMeta, explorerLinks, worstDecision } from "./response.js";
import { ecosystemEvidenceForRequest, applyEcosystemEscalation } from "../lib/pharos/ecosystemEvidence.js";
import { ecosystemRegistrySummary } from "../lib/pharos/ecosystem.js";

const SERVICE = "SafeHands API";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/api/routes.js or src/api/routes.ts → repo root is two levels up.
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}
const VERSION = readVersion();

/** Resolve the target network from explicit name/chainId, else the active one. */
function resolveNetwork(input: { network?: string; chainId?: number }): PharosNetwork {
  if (input.network && isNetworkName(input.network)) {
    return getNetworkByChainId(input.network === "pacific-mainnet" ? 1672 : 688689) ?? getActiveNetwork();
  }
  if (typeof input.chainId === "number") {
    return getNetworkByChainId(input.chainId) ?? getActiveNetwork();
  }
  return getActiveNetwork();
}

const RISK_SEVERITY: Record<AnalyzerRiskLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNKNOWN: 0,
};

function worstRisk(levels: AnalyzerRiskLevel[]): AnalyzerRiskLevel {
  if (levels.length === 0) return "UNKNOWN";
  return levels.reduce((worst, l) => (RISK_SEVERITY[l] > RISK_SEVERITY[worst] ? l : worst), "UNKNOWN");
}

function selectorOf(data?: string): string | null {
  if (!data || !data.startsWith("0x") || data.length < 10) return null;
  return data.slice(0, 10).toLowerCase();
}

// ── GET /health ────────────────────────────────────────────────────────
export function handleHealth() {
  return {
    status: "ok",
    service: SERVICE,
    version: VERSION,
    timestamp: new Date().toISOString(),
  };
}

// ── GET /infra/status ──────────────────────────────────────────────────
export function handleInfraStatus() {
  const network = getActiveNetwork();
  return {
    network: getActiveNetworkName(),
    label: network.label,
    chainId: network.chainId,
    nativeToken: network.nativeToken,
    isMainnet: network.isMainnet,
    explorer: {
      explorerUrl: network.explorerUrl,
      socialScanUrl: network.socialScanUrl ?? null,
    },
    readOnlyMode: isReadOnlyMode(),
    walletMode: process.env.WALLET_MODE ?? "none",
    gates: getGates(),
    capabilities: getCapabilityFlags(network),
    ecosystem: ecosystemRegistrySummary(),
    ...readOnlyMeta(),
    ...rpcMeta(network),
  };
}

// ── GET /public-config ─────────────────────────────────────────────────
// Safe public config only. Emits the hardcoded PUBLIC default RPC URL — never
// resolveRpcUrl()/env values (which may be premium/keyed) — and no secrets.
export function handlePublicConfig() {
  const network = getActiveNetwork();
  return {
    service: SERVICE,
    version: VERSION,
    network: getActiveNetworkName(),
    label: network.label,
    chainId: network.chainId,
    nativeToken: network.nativeToken,
    isMainnet: network.isMainnet,
    explorer: {
      explorerUrl: network.explorerUrl,
      socialScanUrl: network.socialScanUrl ?? null,
    },
    publicRpcUrl: network.defaultRpcUrl,
    decisions: GUARDIAN_DECISIONS,
    supportedFeatures: [
      "read-only SafeHands checks",
      "evm call analysis",
      "transaction-hash analysis",
      "contract intelligence (canonical recognition)",
      "approval analysis (ERC-20 approve)",
      "safe-tx / multiSend decode (experimental)",
      "x402 preflight analysis (no payment)",
    ],
    readOnlyMode: isReadOnlyMode(),
    gates: getGates(),
    capabilities: getCapabilityFlags(network),
    ecosystem: ecosystemRegistrySummary(),
    ...readOnlyMeta(),
    ...rpcMeta(network),
  };
}

// ── POST /guardian/check ───────────────────────────────────────────────
// Universal read-only entry: routes to the right analyzer(s) and aggregates.
export async function handleGuardianCheck(raw: unknown, access?: ReadOnlyChainAccess) {
  const input = guardianCheckSchema.parse(raw);
  const network = resolveNetwork(input);
  const analyzers: AnalyzerResult<unknown>[] = [];

  // Ecosystem awareness (evidence only; escalate-only — never relaxes a decision).
  const ecosystemEvidence = ecosystemEvidenceForRequest(input);

  const selector = selectorOf(input.data);

  if (input.txHash || input.inputType === "tx") {
    if (!input.txHash) throw new Error("inputType 'tx' requires a txHash.");
    analyzers.push(await analyzeTxHash(input.txHash, access));
  } else if (input.inputType === "contract") {
    if (!input.to) throw new Error("inputType 'contract' requires a 'to' address.");
    analyzers.push(await analyzeContract(input.to, access));
  } else if (input.to || input.data || input.value) {
    analyzers.push(
      await analyzeEvmCall({ to: input.to, data: input.data, value: input.value, chainId: network.chainId }, access),
    );
    if (selector === APPROVE_SELECTOR && input.data) {
      analyzers.push(analyzeApproval(input.data, input.to));
    } else if (selector === MULTISEND_SELECTOR && input.data) {
      analyzers.push(await analyzeSafeTx(input.data));
    } else if (input.data && isDecodableCalldataSelector(selector)) {
      // permit / Permit2 approve / setApprovalForAll / transferFrom / transfer /
      // allowance / dangerous-admin selectors — offline decode, escalate-only.
      analyzers.push(analyzeCalldata(input.data, input.to));
    }
  }

  if (analyzers.length === 0) {
    return {
      decision: "REQUIRE_CONFIRMATION" as GuardianDecision,
      riskLevel: "UNKNOWN" as AnalyzerRiskLevel,
      reasons: ["No analyzable input. Provide txHash, a contract address, or to/data/value."],
      warnings: [],
      analyzers: [],
      network: getActiveNetworkName(),
      chainId: network.chainId,
      explorerLinks: {},
      ecosystemEvidence,
      ...readOnlyMeta(),
      ...rpcMeta(network, access),
    };
  }

  const baseDecision = worstDecision(analyzers.map((a) => a.decision));
  // Escalate-only: ecosystem awareness may raise (cross-chain / WASM →
  // REQUIRE_CONFIRMATION) but NEVER relaxes a decision or makes a risky action safe.
  const decision = applyEcosystemEscalation(baseDecision, ecosystemEvidence);
  const riskLevel = worstRisk(analyzers.map((a) => a.riskLevel));
  const reasons = analyzers.flatMap((a) => a.reasons);
  if (decision !== baseDecision) {
    reasons.push(`Ecosystem awareness (${ecosystemEvidence.category}): ${ecosystemEvidence.safehandsBehavior}`);
  }
  const warnings = analyzers.flatMap((a) => a.warnings);

  return {
    decision,
    riskLevel,
    reasons,
    warnings,
    analyzers,
    network: getActiveNetworkName(),
    chainId: network.chainId,
    explorerLinks: explorerLinks(network, { address: input.to, txHash: input.txHash }),
    ecosystemEvidence,
    ...readOnlyMeta(),
    ...rpcMeta(network, access),
  };
}

// ── POST /analyze/tx ───────────────────────────────────────────────────
export async function handleAnalyzeTx(raw: unknown, access?: ReadOnlyChainAccess) {
  const input = analyzeTxSchema.parse(raw);
  const network = resolveNetwork(input);
  const result = await analyzeTxHash(input.txHash, access);
  return {
    ...result,
    explorerLinks: explorerLinks(network, { txHash: input.txHash }),
    ecosystemEvidence: ecosystemEvidenceForRequest(input),
    ...readOnlyMeta(),
    ...rpcMeta(network, access),
  };
}

// ── POST /analyze/contract ─────────────────────────────────────────────
export async function handleAnalyzeContract(raw: unknown, access?: ReadOnlyChainAccess) {
  const input = analyzeContractSchema.parse(raw);
  const network = resolveNetwork(input);
  const result = await analyzeContract(input.address, access);
  return {
    ...result,
    explorerLinks: explorerLinks(network, { address: input.address }),
    ecosystemEvidence: ecosystemEvidenceForRequest({ address: input.address, network: input.network }),
    ...readOnlyMeta(),
    ...rpcMeta(network, access),
  };
}

// ── POST /analyze/approval ─────────────────────────────────────────────
export function handleAnalyzeApproval(raw: unknown) {
  const input = analyzeApprovalSchema.parse(raw);
  const result = analyzeApproval(input.data, input.token);
  return {
    ...result,
    ecosystemEvidence: ecosystemEvidenceForRequest({ token: input.token }),
    ...readOnlyMeta(),
    ...rpcMeta(getActiveNetwork()),
  };
}

// ── POST /analyze/calldata ─────────────────────────────────────────────
// Offline superset decoder (permit, Permit2 approve, setApprovalForAll,
// transferFrom/transfer, allowance changes, dangerous-admin selectors). Never
// signs/sends — verdict only. Read-only.
export function handleAnalyzeCalldata(raw: unknown) {
  const input = analyzeCalldataSchema.parse(raw);
  const result = analyzeCalldata(input.data, input.token);
  return {
    ...result,
    ecosystemEvidence: ecosystemEvidenceForRequest({ token: input.token }),
    ...readOnlyMeta(),
    ...rpcMeta(getActiveNetwork()),
  };
}

// ── POST /analyze/safe ─────────────────────────────────────────────────
export async function handleAnalyzeSafe(raw: unknown) {
  const input = analyzeSafeSchema.parse(raw);
  const result = await analyzeSafeTx(input.data);
  return {
    ...result,
    ecosystemEvidence: ecosystemEvidenceForRequest({ provider: "safe" }),
    ...readOnlyMeta(),
    ...rpcMeta(getActiveNetwork()),
  };
}

// ── POST /analyze/x402 ─────────────────────────────────────────────────
// SSRF protection is inherited from analyzeX402's static URL check (offline-safe).
export function handleAnalyzeX402(raw: unknown) {
  const input = analyzeX402Schema.parse(raw);
  const result = analyzeX402(input);
  return {
    ...result,
    ecosystemEvidence: ecosystemEvidenceForRequest({ provider: "x402", address: input.paymentTokenAddress }),
    ...readOnlyMeta(),
    ...rpcMeta(getActiveNetwork()),
  };
}
