// ─── Managed Execution Gate ────────────────────────────────────────────
// Centralized safety gate shared by every write/payment tool so that direct
// calls (send_payment, execute_swap, approve_token, x402_pay_and_fetch,
// publish_risk_score) are exactly as safe as going through
// safehands_safe_execute.
//
// Safety hierarchy enforced here:
//   1. WRITE_TOOLS_ENABLED must be true.
//   2. A signer must be available.
//   3. For managed-mainnet signers, the wallet must be authorized in
//      SafeHandsRegistry (when REQUIRE_AUTHORIZED_AGENT_FOR_WRITE is on).
//
// Funding and per-agent policy are evaluated by each tool after this gate
// (funding via balance checks, policy via evaluateActionPolicy with agentId).
// ────────────────────────────────────────────────────────────────────────

import { getSigner, isSignerFailure, type SignerResult, type SignerPurpose } from "./signer/index.js";
import { checkManagedWalletAuthorization } from "./safeHandsRegistry.js";
import { fail, type ToolFailure } from "./toolResponse.js";
import { REQUIRE_AUTHORIZED_AGENT_FOR_WRITE } from "./constants.js";
import { getActiveNetwork } from "./networks.js";

export interface ManagedExecutionReady {
  signer: SignerResult;
}

export function isManagedExecutionFailure(
  r: ManagedExecutionReady | ToolFailure,
): r is ToolFailure {
  return "success" in r && r.success === false;
}

/**
 * Resolves a signer that is cleared for managed/mainnet execution, or returns
 * a structured ToolFailure describing exactly which gate failed.
 *
 * Failure codes:
 *  - WRITE_TOOLS_DISABLED      writes are off by default
 *  - NO_SIGNER_AVAILABLE / INVALID_PRIVATE_KEY / WALLET_ENCRYPTION_KEY_REQUIRED
 *  - REQUIRE_AUTHORIZATION     managed wallet not authorized in SafeHandsRegistry
 */
export async function requireManagedExecutionReady(
  toolName: string,
  agentId?: string,
  options: { purpose?: SignerPurpose } = {},
): Promise<ManagedExecutionReady | ToolFailure> {
  // 1. Write tools must be explicitly enabled.
  if (process.env.WRITE_TOOLS_ENABLED !== "true") {
    return fail(
      "WRITE_TOOLS_DISABLED",
      `${toolName} is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted mainnet execution.`,
      false,
      toolName,
    );
  }

  // 1b. The active network must permit execution (executionAllowed). NOTE: Pharos
  //     Pacific Mainnet has executionAllowed=true — this gate does NOT block mainnet.
  //     The real safety margin on mainnet is WRITE_TOOLS_ENABLED (checked above) + an
  //     available signer + registry authorization (below), NOT this network flag.
  const activeNetwork = getActiveNetwork();
  if (!activeNetwork.executionAllowed) {
    return fail(
      "EXECUTION_DISABLED_ON_NETWORK",
      `${activeNetwork.label} is read-only in SafeHands: execution/write/payment is disabled on this network. ` +
        `Set SAFEHANDS_NETWORK=pacific-mainnet for advanced self-hosted mainnet execution.`,
      false,
      toolName,
    );
  }

  // 2. A signer must be available.
  const signer = await getSigner(agentId, options);
  if (isSignerFailure(signer)) {
    return fail(signer.error.code, signer.error.message, false, toolName);
  }

  // 3. Managed-mainnet wallets must be authorized in SafeHandsRegistry.
  if (signer.mode === "managed-mainnet" && REQUIRE_AUTHORIZED_AGENT_FOR_WRITE) {
    const authCheck = await checkManagedWalletAuthorization(signer.address);
    if (!authCheck.authorized) {
      return fail(
        "REQUIRE_AUTHORIZATION",
        authCheck.errorMessage ||
          `Managed wallet ${signer.address} is not authorized in SafeHandsRegistry. ` +
            `The contract owner must call setAuthorizedAgent(${signer.address}, true), ` +
            `or enable AUTO_AUTHORIZE_AGENT_WALLET=true with RISK_REGISTRY_OWNER_PRIVATE_KEY.`,
        false,
        toolName,
      );
    }
  }

  return { signer };
}
