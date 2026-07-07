// ─── SafeHands API — Prepare-Only Transaction Mode ───────
// Builds an UNSIGNED transaction request object AFTER a SafeHands check. SafeHands
// holds no keys: it NEVER signs, NEVER broadcasts, NEVER creates/manages a wallet,
// and NEVER publishes on-chain. The flow:
//   1. validate the caller's intended call (to / data / value),
//   2. run the real escalate-only SafeHands check (policy presets apply),
//   3. if the verdict is BLOCK → prepare NOTHING (a BLOCK is never weakened),
//      otherwise → return the unsigned tx + `requiresUserSignature: true` and a
//      `PREPARE_ONLY` decision (the caller signs + broadcasts externally).
// Pure + read-only by construction; no signer/wallet/write primitives here.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { isAddress } from "viem";
import { createGuardianAgent } from "../agent/index.js";
import type { AgentRequest } from "../agent/index.js";
import type { ReadOnlyChainAccess } from "../lib/analysis/index.js";
import type { AgentRouteOptions } from "./agentRoutes.js";
import { getActiveNetwork, getActiveNetworkName } from "../lib/networks.js";
import { readOnlyMeta } from "./response.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const prepareTxSchema = z
  .object({
    to: z.string(),
    data: z.string().optional(),
    value: z.string().optional(),
    chainId: z.number().optional(),
  })
  .passthrough(); // policyPreset / policy are read by the server (agentPolicyOpts)

export type PrepareTxInput = z.input<typeof prepareTxSchema>;

/**
 * POST /prepare/tx — SafeHands-checked, prepare-only unsigned transaction.
 * Returns `preparedTransaction` + `requiresUserSignature: true` (PREPARE_ONLY) when
 * the action is not blocked; `BLOCK` with no prepared tx otherwise.
 */
export async function handlePrepareTx(
  raw: unknown,
  access?: ReadOnlyChainAccess,
  opts: AgentRouteOptions = {},
) {
  const input = prepareTxSchema.parse(raw);
  if (!isAddress(input.to)) throw new Error("`to` must be a valid address.");
  if (input.to === ZERO_ADDRESS) throw new Error("`to` must not be the zero address.");
  if (input.data !== undefined && !/^0x[0-9a-fA-F]*$/.test(input.data)) {
    throw new Error("`data` must be 0x-prefixed hex.");
  }
  if (input.value !== undefined) {
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 0) throw new Error("`value` must be a non-negative number.");
  }

  const network = getActiveNetwork();
  const chainId = input.chainId ?? network.chainId;

  // Real escalate-only SafeHands check (policy presets apply via opts) — a BLOCK can
  // never be weakened by any preset/request.
  const agent = createGuardianAgent({ access, policy: opts.policy, policyPreset: opts.policyPreset });
  const verdict = await agent.check({ to: input.to, data: input.data, value: input.value, chainId } as AgentRequest);

  const blocked = verdict.decision === "BLOCK";
  const confirmationRequired = verdict.decision === "REQUIRE_CONFIRMATION";

  // Unsigned transaction request object — no signer, no signature, no nonce/gas.
  const preparedTransaction = blocked
    ? null
    : {
        to: input.to,
        data: input.data ?? "0x",
        value: input.value ?? "0",
        chainId,
        from: null, // SafeHands holds no keys
        unsigned: true,
        signature: null,
      };

  return {
    decision: verdict.decision,
    /** The underlying SafeHands verdict (ALLOW / BLOCK / REQUIRE_CONFIRMATION). */
    guardianDecision: verdict.decision,
    riskLevel: verdict.riskLevel,
    reasons: verdict.reasons,
    /** True when the underlying verdict needs explicit user confirmation before signing. */
    confirmationRequired,
    /** True only when an unsigned tx was prepared (never on BLOCK). */
    requiresUserSignature: !blocked,
    preparedTransaction,
    network: getActiveNetworkName(),
    chainId,
    policyPreset: verdict.policyPreset,
    policyVersion: verdict.policyVersion,
    /** SafeHands signs nothing and broadcasts nothing — the caller does both externally. */
    signingAvailable: false,
    broadcastAvailable: false,
    nextStep: blocked
      ? "Do not prepare — the action is unsafe. Abort and surface the block reason."
      : "WARNING: This prepared tx is for EXTERNAL broadcast only. SafeHands holds no keys. Do not submit this to /broadcast/signed because no internal record was saved.",
    source: "prepare_tx",
    ...readOnlyMeta(), // readOnly: true, executionAvailable: false
  };
}
