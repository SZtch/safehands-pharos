// ─── Pharos Read-Only RPC Adapter (single whitelist chokepoint) ────────
// A read-only JSON-RPC adapter that gates EVERY call through the method matrix
// (rpcMethods.ts) BEFORE any network I/O. Write/signing/account/unknown methods
// throw fail-closed and never reach the transport. There is no signer, wallet,
// or key surface here — read-only by construction. The transport is injectable
// (tests inject a spy); the default is a fetch-based JSON-RPC POST whose URL is
// resolved from env only (premium/keyed URLs are never hardcoded or exposed).
// ───────────────────────────────────────────────────────────────────────

import { getActiveNetwork, resolveRpcUrl, type PharosNetwork } from "../networks.js";
import { fetchWithTimeoutAndRetry } from "../http.js";
import { assertHostedReadOnlyMethod, classifyRpcMethod, type RpcMethodClassification } from "./rpcMethods.js";

/** Raw JSON-RPC transport: (method, params) → result. Must perform reads only. */
export type RpcTransport = (method: string, params: unknown[]) => Promise<unknown>;

export interface PharosReadOnlyRpcOptions {
  network?: PharosNetwork;
  /** Explicit RPC URL override; otherwise resolved from env (never exposed). */
  url?: string;
  /** Injectable transport (used by tests). Defaults to a fetch JSON-RPC POST. */
  transport?: RpcTransport;
}

export interface RpcAdapterCapabilities {
  configured: boolean;
  ethGetProof: RpcMethodClassification;
  ethGetAccount: RpcMethodClassification;
  ethFeeHistory: RpcMethodClassification;
}

export class PharosReadOnlyRpc {
  readonly network: PharosNetwork;
  private readonly url: string | undefined;
  private readonly injectedTransport: RpcTransport | undefined;

  constructor(opts: PharosReadOnlyRpcOptions = {}) {
    this.network = opts.network ?? getActiveNetwork();
    this.url = opts.url ?? resolveRpcUrl(this.network);
    this.injectedTransport = opts.transport;
  }

  /** True when a transport or RPC URL is available (does not perform any I/O). */
  isConfigured(): boolean {
    return Boolean(this.injectedTransport) || Boolean(this.url);
  }

  /**
   * Gate + execute a raw read-only JSON-RPC call. The matrix gate runs FIRST, so
   * write/unsupported/unknown methods throw before any network I/O.
   */
  async request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    assertHostedReadOnlyMethod(method);
    return (await this.transport()(method, params)) as T;
  }

  /**
   * Best-effort experimental read: still gated (throws for blocked methods), but
   * returns null instead of throwing when the transport is missing or fails.
   */
  async tryRequest<T = unknown>(method: string, params: unknown[] = []): Promise<T | null> {
    assertHostedReadOnlyMethod(method);
    if (!this.isConfigured()) return null;
    try {
      return (await this.transport()(method, params)) as T;
    } catch {
      return null;
    }
  }

  /**
   * Gate a method name, then run a (e.g. viem) read function. Lets existing typed
   * reads keep their result parsing while still passing the whitelist chokepoint.
   */
  async guarded<T>(method: string, fn: () => Promise<T>): Promise<T> {
    assertHostedReadOnlyMethod(method);
    return fn();
  }

  /** Matrix-derived capability descriptor (deterministic; performs no I/O). */
  capabilities(): RpcAdapterCapabilities {
    return {
      configured: this.isConfigured(),
      ethGetProof: classifyRpcMethod("eth_getProof"),
      ethGetAccount: classifyRpcMethod("eth_getAccount"),
      ethFeeHistory: classifyRpcMethod("eth_feeHistory"),
    };
  }

  private transport(): RpcTransport {
    if (this.injectedTransport) return this.injectedTransport;
    const url = this.url;
    if (!url) {
      return async (method) => {
        throw new Error(`No RPC URL configured for ${this.network.name} (offline read-only); cannot call ${method}.`);
      };
    }
    return async (method, params) => {
      const res = await fetchWithTimeoutAndRetry(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        timeoutMs: 10_000,
        retries: 1,
        retryDelayMs: 250,
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) throw new Error(`RPC error for ${method}: ${json.error.message ?? "unknown"}`);
      return json.result;
    };
  }
}
