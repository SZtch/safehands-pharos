// ─── SafeHands API — Wallet-Ready Transaction Handoff ──
// Prepares a WALLET-READY transaction request for an EXTERNAL wallet to sign and
// send. Wallet connection happens OUTSIDE SafeHands (frontend/dApp, SDK userAddress,
// CLI --from, or MCP/agent host) — SafeHands only READS the wallet context from the
// request. It runs the SafeHands check on the intent and, when the caller supplied a
// wallet address and the action is not blocked, returns a `walletRequest`
// {from,to,data,value,chainId} for external signing/sending.
//
// SafeHands NEVER signs, NEVER broadcasts, NEVER creates or manages a wallet, and
// holds NO key. Read-only by construction: no signer/wallet/send primitive here.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { isAddress } from "viem";
import { createGuardianAgent } from "../agent/index.js";
import type { AgentRequest } from "../agent/index.js";
import type { ReadOnlyChainAccess } from "../lib/analysis/index.js";
import type { AgentRouteOptions } from "./agentRoutes.js";
import { getActiveNetwork, getActiveNetworkName } from "../lib/networks.js";
import { readOnlyMeta } from "./response.js";
import { savePreparedTx } from "../lib/preparedTxStore.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const walletPrepareSchema = z
  .object({
    to: z.string(),
    data: z.string().optional(),
    value: z.string().optional(),
    chainId: z.number().optional(),
    /** Wallet context read from the request — provided by the frontend/SDK/CLI/agent host. */
    userAddress: z.string().optional(),
    from: z.string().optional(),
  })
  .passthrough(); // policyPreset / policy are read by the server (agentPolicyOpts)

export type WalletPrepareInput = z.input<typeof walletPrepareSchema>;

/** UX hint for the caller/host — never a substitute for the public decision. */
export type WalletNextAction =
  | "CONNECT_WALLET_OR_PROVIDE_ADDRESS"
  | "SIGN_IN_EXTERNAL_WALLET"
  | "REVIEW_FIRST"
  | "STOP";

/**
 * POST /wallet/prepare — SafeHands-checked, wallet-ready transaction handoff.
 * - Missing wallet context → `requiresWalletConnection: true`,
 *   `nextAction: CONNECT_WALLET_OR_PROVIDE_ADDRESS`, no `walletRequest`.
 * - Provided wallet + not blocked → `walletRequest` {from,to,data,value,chainId}.
 * - BLOCK → no `walletRequest`, `nextAction: STOP`.
 * - REQUIRE_CONFIRMATION → `confirmationRequired: true`, `nextAction: REVIEW_FIRST`.
 */
export async function handleWalletPrepare(
  raw: unknown,
  access?: ReadOnlyChainAccess,
  opts: AgentRouteOptions = {},
) {
  const input = walletPrepareSchema.parse(raw);
  if (!isAddress(input.to)) throw new Error("`to` must be a valid address.");
  if (input.to === ZERO_ADDRESS) throw new Error("`to` must not be the zero address.");
  if (input.data !== undefined && !/^0x[0-9a-fA-F]*$/.test(input.data)) {
    throw new Error("`data` must be 0x-prefixed hex.");
  }
  if (input.value !== undefined) {
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 0) throw new Error("`value` must be a non-negative number.");
  }

  // Wallet context is read-only: SafeHands echoes it, never derives or stores a key.
  const walletAddress = (input.userAddress ?? input.from)?.trim();
  const hasWallet = typeof walletAddress === "string" && walletAddress.length > 0;
  if (hasWallet && !isAddress(walletAddress)) {
    throw new Error("`userAddress`/`from` must be a valid address.");
  }

  const network = getActiveNetwork();
  const chainId = input.chainId ?? network.chainId;

  // Real escalate-only SafeHands check on the intent — a BLOCK is never weakened.
  const agent = createGuardianAgent({ access, policy: opts.policy, policyPreset: opts.policyPreset });
  const verdict = await agent.check({ to: input.to, data: input.data, value: input.value, chainId } as AgentRequest);
  const blocked = verdict.decision === "BLOCK";
  const confirmationRequired = verdict.decision === "REQUIRE_CONFIRMATION";

  // A wallet-ready request is produced ONLY when not blocked AND a wallet address is present.
  const walletRequest =
    !blocked && hasWallet
      ? {
          from: walletAddress as string,
          to: input.to,
          data: input.data ?? "0x",
          value: input.value ?? "0",
          chainId,
        }
      : null;

  let preparedTransactionId: string | undefined;
  let preparedTransactionHash: string | undefined;

  if (walletRequest) {
    const record = savePreparedTx(
      walletRequest.from,
      walletRequest.to,
      walletRequest.data,
      walletRequest.value,
      walletRequest.chainId,
      verdict.decision,
      verdict.policyVersion ?? null,
      verdict.policyPreset ?? null
    );
    preparedTransactionId = record.id;
    preparedTransactionHash = record.hash;
  }

  // requiresWalletConnection only matters when the action could proceed (not blocked).
  const requiresWalletConnection = !blocked && !hasWallet;

  // nextAction priority: STOP (block) > CONNECT (no wallet) > REVIEW (confirm) > SIGN.
  const nextAction: WalletNextAction = blocked
    ? "STOP"
    : !hasWallet
      ? "CONNECT_WALLET_OR_PROVIDE_ADDRESS"
      : confirmationRequired
        ? "REVIEW_FIRST"
        : "SIGN_IN_EXTERNAL_WALLET";

  const nextStep = blocked
    ? "Do not proceed — the action is unsafe. Surface the block reason; no wallet request is produced."
    : !hasWallet
      ? "Connect a wallet (or provide userAddress/from), then call again to receive a wallet-ready request."
      : confirmationRequired
        ? "Review the request, then sign and send it from your own external wallet. SafeHands does not sign or broadcast."
        : "Sign and send the wallet request from your own external wallet. SafeHands holds no keys and does not broadcast.";

  return {
    // Public four-value decision contract.
    decision: verdict.decision,
    guardianDecision: verdict.decision,
    riskLevel: verdict.riskLevel,
    reasons: verdict.reasons,
    /** True when no wallet context was provided and the action is not blocked. */
    requiresWalletConnection,
    /** True when the underlying verdict needs explicit user review before signing. */
    confirmationRequired,
    /** UX hint for the host/client. */
    nextAction,
    /** Wallet-ready request for an EXTERNAL wallet (null when blocked or no wallet). */
    walletRequest,
    preparedTransactionId,
    preparedTransactionHash,
    network: getActiveNetworkName(),
    chainId,
    policyPreset: verdict.policyPreset ?? null,
    policyVersion: verdict.policyVersion ?? null,
    /** SafeHands signs nothing and broadcasts nothing — the external wallet does both. */
    signingAvailable: false,
    broadcastAvailable: false,
    nextStep,
    source: "wallet_prepare",
    ...readOnlyMeta(), // readOnly: true, executionAvailable: false
  };
}
