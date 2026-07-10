// ─── Pharos Read-Only RPC Evidence (deterministic, secret-free) ────────
// Builds read-only `rpcEvidence` / `gasEvidence` descriptors for API and Agent
// responses. Everything here is derived from the method matrix + network/config
// — it performs NO network I/O and is deterministic offline. It NEVER exposes an
// RPC URL or API key (only the redacted provider name). Evidence is metadata: it
// describes read-only capability and never relaxes a SafeHands decision.
// ───────────────────────────────────────────────────────────────────────

import { getActiveNetwork, resolveRpcProvider, type NetworkName, type PharosNetwork, type RpcProviderName } from "../networks.js";
import { isExecutionAvailable } from "../config.js";
import { DEFAULT_GAS_BUFFER_PCT } from "../analysis/gas.js";
import type { ReadOnlyChainAccess } from "../analysis/types.js";
import { isReadOnlyMethod, rpcMethodMatrixSummary, WRITE_BLOCKED_METHODS, type RpcMethodMatrixSummary } from "./rpcMethods.js";

export interface RpcProviderEvidence {
  name: RpcProviderName;
  configuredViaEnv: boolean;
  usingPublicDefault: boolean;
  /** Always true — the URL/API key is never included in evidence. */
  secretsRedacted: true;
}

export interface RpcProofCapability {
  method: "eth_getProof";
  status: "experimental" | "implemented";
  readOnly: true;
  spvVerification: "not_implemented" | "implemented";
}

export interface RpcFeeCapability {
  gasPrice: boolean;
  maxPriorityFeePerGas: boolean;
  feeHistory: boolean;
  estimateGas: boolean;
}

export interface RpcEvidence {
  readOnly: true;
  executionAvailable: boolean;
  network: NetworkName;
  chainId: number;
  provider: RpcProviderEvidence;
  methods: RpcMethodMatrixSummary;
  writeBlocked: string[];
  capabilities: {
    ethGetProof: RpcProofCapability;
    feeData: RpcFeeCapability;
  };
  /** True when no live read-only access was supplied (capability-only evidence). */
  fallbackUsed: boolean;
}

export function rpcEvidence(network: PharosNetwork = getActiveNetwork(), access?: ReadOnlyChainAccess): RpcEvidence {
  const provider = resolveRpcProvider(network);
  return {
    readOnly: true,
    executionAvailable: isExecutionAvailable(network),
    network: network.name,
    chainId: network.chainId,
    provider: { ...provider, secretsRedacted: true },
    methods: rpcMethodMatrixSummary(),
    writeBlocked: WRITE_BLOCKED_METHODS,
    capabilities: {
      // Status matches rpcMethods.ts: the method is experimental (heavy, best-effort);
      // SPV verification itself is implemented (spvVerifier.ts via get_spv_proof).
      ethGetProof: { method: "eth_getProof", status: "experimental", readOnly: true, spvVerification: "implemented" },
      feeData: {
        gasPrice: isReadOnlyMethod("eth_gasPrice"),
        maxPriorityFeePerGas: isReadOnlyMethod("eth_maxPriorityFeePerGas"),
        feeHistory: isReadOnlyMethod("eth_feeHistory"),
        estimateGas: isReadOnlyMethod("eth_estimateGas"),
      },
    },
    fallbackUsed: !access,
  };
}

export interface GasEvidence {
  gasBufferPct: number;
  feeDataAvailable: boolean;
  feeHistoryAvailable: boolean;
  priorityFeeAvailable: boolean;
  estimateGasAvailable: boolean;
  /** True when no live gas estimator was supplied (offline/capability-only). */
  fallbackUsed: boolean;
}

export function gasEvidence(access?: ReadOnlyChainAccess): GasEvidence {
  return {
    gasBufferPct: DEFAULT_GAS_BUFFER_PCT,
    feeDataAvailable: isReadOnlyMethod("eth_gasPrice"),
    feeHistoryAvailable: isReadOnlyMethod("eth_feeHistory"),
    priorityFeeAvailable: isReadOnlyMethod("eth_maxPriorityFeePerGas"),
    estimateGasAvailable: isReadOnlyMethod("eth_estimateGas"),
    fallbackUsed: !access?.estimateGas,
  };
}
