// ─── Managed Execution Gate ────────────────────────────────────────────
// Centralized safety gate shared by every write/payment tool so that direct
// calls (send_payment, execute_swap, approve_token, x402_pay_and_fetch,
// publish_risk_score) are exactly as safe as going through
// safehands_safe_execute.
//
// Safety hierarchy enforced here:
//   1. WRITE_TOOLS_ENABLED must be true.
//   2. A signer must be available.
//   3. For managed-testnet signers, the wallet must be authorized in
//      RiskRegistry V2 (when REQUIRE_AUTHORIZED_AGENT_FOR_WRITE is on).
//
// Funding and per-agent policy are evaluated by each tool after this gate
// (funding via balance checks, policy via evaluateActionPolicy with agentId).
// ────────────────────────────────────────────────────────────────────────

import { getSigner, isSignerFailure, type SignerResult, type SignerPurpose } from "./signer/index.js";
import { checkManagedWalletAuthorization } from "./riskRegistryV2.js";
import { fail, type ToolFailure } from "./toolResponse.js";
import { REQUIRE_AUTHORIZED_AGENT_FOR_WRITE } from "./constants.js";

export interface ManagedExecutionReady {
  signer: SignerResult;
}

export function isManagedExecutionFailure(
  r: ManagedExecutionReady | ToolFailure,
): r is ToolFailure {
  return "success" in r && r.success === false;
}

/**
 * Resolves a signer that is cleared for managed/testnet execution, or returns
 * a structured ToolFailure describing exactly which gate failed.
 *
 * Failure codes:
 *  - WRITE_TOOLS_DISABLED      writes are off by default
 *  - NO_SIGNER_AVAILABLE / INVALID_PRIVATE_KEY / WALLET_ENCRYPTION_KEY_REQUIRED
 *  - REQUIRE_AUTHORIZATION     managed wallet not authorized in RiskRegistry V2
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
      `${toolName} is disabled by default. Set WRITE_TOOLS_ENABLED=true only for trusted testnet execution.`,
      false,
      toolName,
    );
  }

  // 2. A signer must be available.
  const signer = await getSigner(agentId, options);
  if (isSignerFailure(signer)) {
    return fail(signer.error.code, signer.error.message, false, toolName);
  }

  // 3. Managed-testnet wallets must be authorized in RiskRegistry V2.
  if (signer.mode === "managed-testnet" && REQUIRE_AUTHORIZED_AGENT_FOR_WRITE) {
    const authCheck = await checkManagedWalletAuthorization(signer.address);
    if (!authCheck.authorized) {
      return fail(
        "REQUIRE_AUTHORIZATION",
        authCheck.errorMessage ||
          `Managed wallet ${signer.address} is not authorized in RiskRegistry V2. ` +
            `The contract owner must call setAuthorizedAgent(${signer.address}, true), ` +
            `or enable AUTO_AUTHORIZE_AGENT_WALLET=true with RISK_REGISTRY_OWNER_PRIVATE_KEY.`,
        false,
        toolName,
      );
    }
  }

  return { signer };
}
