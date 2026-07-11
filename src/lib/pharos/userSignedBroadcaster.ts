import { getActiveNetwork, resolveRpcUrl } from "../networks.js";
import { fetchWithTimeoutAndRetry } from "../http.js";

/**
 * Gated module specifically for sending externally signed transactions.
 * Rules:
 * - Does not sign, hold keys, or create wallets.
 * - Only active if SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED=true.
 * - Only supports Pharos Pacific Mainnet (chainId 1672).
 * - Bypasses PharosReadOnlyRpc by design to allow eth_sendRawTransaction.
 */
export async function broadcastSignedTransaction(rawSignedTx: string, chainId: number): Promise<string> {
  if (process.env.SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED !== "true") {
    throw new Error("Broadcasting is disabled. Set SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED=true to enable.");
  }

  if (chainId !== 1672) {
    throw new Error("Live broadcast is only supported on Pharos Pacific Mainnet (chainId 1672).");
  }

  const network = getActiveNetwork();
  if (network.chainId !== 1672) {
    throw new Error("Active network is not Pharos Pacific Mainnet (1672). Broadcast aborted.");
  }

  const rpcUrl = resolveRpcUrl(network);

  try {
    const res = await fetchWithTimeoutAndRetry(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "eth_sendRawTransaction",
        params: [rawSignedTx],
      }),
      timeoutMs: 10_000,
      retries: 1,
      retryDelayMs: 250,
    });

    const json = (await res.json()) as { result?: string; error?: { message?: string } };

    if (json.error) {
      throw new Error(`eth_sendRawTransaction error: ${json.error.message || "unknown"}`);
    }

    if (!json.result) {
      throw new Error("eth_sendRawTransaction returned no result");
    }

    return json.result;
  } catch (error) {
    throw new Error(`Broadcast failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
