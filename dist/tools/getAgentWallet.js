// ─── get_agent_wallet ───────────────────────────────────────────────────
// Returns public info for a managed agent wallet.
// Never returns private key.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { ok, fail } from "../lib/toolResponse.js";
import { walletStore } from "../lib/wallet/index.js";
export const getAgentWalletSchema = z.object({
    agentId: z.string().min(1).max(64).describe("Agent wallet identifier"),
});
export async function handleGetAgentWallet(params) {
    const { agentId } = params;
    const wallet = await walletStore.get(agentId);
    if (!wallet) {
        return fail("WALLET_NOT_FOUND", `No wallet found for agentId '${agentId}'. Use create_agent_wallet to create one.`, false, "wallet_store");
    }
    const explorerBase = process.env.PHAROS_EXPLORER_BASE || "https://atlantic.pharosscan.xyz/address/";
    return ok({
        agentId: wallet.agentId,
        address: wallet.address,
        environment: wallet.environment,
        chainId: wallet.chainId,
        isMainnet: wallet.isMainnet,
        createdAt: wallet.createdAt,
        explorerUrl: `${explorerBase}${wallet.address}`,
    });
}
//# sourceMappingURL=getAgentWallet.js.map