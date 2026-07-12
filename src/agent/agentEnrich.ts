// ─── SafeHands Operator — Enrich step (read-only) ───────────────────────
// Composes REAL on-chain + market intelligence into the SafeHands verdict so a
// decision is data-backed, not just a static policy result. Best-effort: every
// enricher is wrapped so a failure (offline / RPC hiccup) only omits that signal
// — it never breaks the verdict. No signing, no writes.
//
// This enricher adds on-chain signals only (contract profile, SafeHands
// reputation oracle, gas). Token-security intelligence (GoPlus, queried live
// for Pharos by checkTokenSecurity) is applied separately in the check
// pipeline — it is not duplicated here.
// ────────────────────────────────────────────────────────────────────────

import { isAddress, formatGwei, formatEther } from "viem";
import { publicClient } from "../lib/pharosClient.js";
import { queryRegistryForTarget } from "../lib/safeHandsRegistry.js";
import { getAgentReputation } from "../lib/pharos/attestationPublisher.js";
import { getActiveNetwork } from "../lib/networks.js";
import type { AgentRequest } from "./agentIntentClassifier.js";

const DEFAULT_ENRICHMENT_TIMEOUT_MS = 4_000;

function getEnrichmentTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.SAFEHANDS_ENRICH_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ENRICHMENT_TIMEOUT_MS;
}

async function withEnrichmentTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeoutMs = getEnrichmentTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface Enrichment {
  enriched: boolean;
  network: string;
  /** SafeHands on-chain reputation for the action target (from SafeHandsRegistry). */
  onChainReputation?: {
    target: string;
    currentMerkleRoot: string | null;
    hasL2BatchRecord: boolean;
    isAuthorizedAgent: boolean;
    /** Count of SafeHands-verified safe broadcasts attributed to the target (0 = no track record yet → neutral). */
    verifiedActionCount: number;
    /** Unix seconds of the target's most recent verified action (0 = none yet). */
    lastVerifiedActionAt: number;
  };
  /** Live gas context from the active network. */
  gas?: { gasPriceGwei: number };
  /** Profile of the action target (contract vs EOA, native PROS balance). */
  targetProfile?: { isContract: boolean; nativeBalancePROS: string };
  notes: string[];
}

export async function enrich(req: AgentRequest): Promise<Enrichment> {
  const notes: string[] = [];
  const out: Enrichment = { enriched: false, network: getActiveNetwork().name, notes };

  // 1. On-chain SafeHands reputation for the target (composable oracle).
  const target = req.to ?? req.address ?? req.token;
  if (target && isAddress(target)) {
    try {
      const [reg, rep] = await withEnrichmentTimeout(
        Promise.all([
          queryRegistryForTarget(target as `0x${string}`),
          getAgentReputation(target),
        ]),
        "on-chain SafeHands reputation"
      );
      out.onChainReputation = {
        target,
        currentMerkleRoot: reg.currentMerkleRoot ?? null,
        hasL2BatchRecord: reg.hasRiskRecord,
        isAuthorizedAgent: reg.authorized,
        verifiedActionCount: rep.verifiedCount,
        lastVerifiedActionAt: rep.lastAttestationAt,
      };
      out.enriched = true;
      if (rep.verifiedCount > 0) {
        notes.push(`Target has ${rep.verifiedCount} SafeHands-verified on-chain action(s); positive track record.`);
      }
      if (reg.error) notes.push(reg.error);
    } catch {
      notes.push("on-chain SafeHands reputation unavailable");
    }
  }

  // 2. Target profile: contract vs EOA + native balance (real on-chain reads).
  if (target && isAddress(target)) {
    try {
      const [code, balance] = await withEnrichmentTimeout(
        Promise.all([
          publicClient.getCode({ address: target as `0x${string}` }),
          publicClient.getBalance({ address: target as `0x${string}` }),
        ]),
        "target profile"
      );
      out.targetProfile = {
        isContract: Boolean(code && code !== "0x"),
        nativeBalancePROS: formatEther(balance),
      };
      out.enriched = true;
    } catch {
      notes.push("target profile unavailable");
    }
  }

  // 3. Live gas context.
  try {
    const gasPrice = await withEnrichmentTimeout(publicClient.getGasPrice(), "gas context");
    out.gas = { gasPriceGwei: Number(formatGwei(gasPrice)) };
    out.enriched = true;
  } catch {
    notes.push("gas context unavailable");
  }

  notes.push(
    "security signals in this enrichment are on-chain reads (contract profile + SafeHands reputation oracle); GoPlus token-security intelligence is applied separately by the token-security check"
  );
  return out;
}
