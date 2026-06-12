// ─── Tool: check_token_security ─────────────────────────────────────────
// Fetches token security intelligence from GoPlus Security API.
// ────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { isAddress } from "viem";
import { CHAIN_ID, PHAROS_ENVIRONMENT } from "../lib/constants.js";
import { fetchWithTimeoutAndRetry } from "../lib/http.js";
import { classifyExternalError, fail, ok } from "../lib/toolResponse.js";
export const checkTokenSecuritySchema = z.object({
    tokenAddress: z.string(),
    chainId: z.number().optional().default(CHAIN_ID),
});
export const checkTokenSecurityTool = {
    name: "check_token_security",
    description: "Check token contract security (honeypot, mintable, ownership privileges, tax) via GoPlus Security API.",
    inputSchema: checkTokenSecuritySchema,
};
export async function handleCheckTokenSecurity(raw) {
    const input = checkTokenSecuritySchema.parse(raw);
    const address = input.tokenAddress.toLowerCase().trim();
    const chainId = input.chainId;
    if (!isAddress(address)) {
        return fail("INVALID_TOKEN_ADDRESS", `Invalid token address: ${input.tokenAddress}`, false, "check_token_security");
    }
    const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
    try {
        const res = await fetchWithTimeoutAndRetry(url, { timeoutMs: 10_000, retries: 2, retryDelayMs: 300 });
        if (!res.ok) {
            throw new Error(`GoPlus API returned status ${res.status}`);
        }
        const data = (await res.json());
        if (data.code !== 1 || !data.result || !data.result[address]) {
            return fail("TOKEN_SECURITY_DATA_UNAVAILABLE", data.message || "Token security data is not available for this contract on the specified chain.", true, "goplus_api");
        }
        const details = data.result[address];
        const isHoneypot = details.is_honeypot === "1";
        const buyTax = parseFloat(details.buy_tax || "0") * 100;
        const sellTax = parseFloat(details.sell_tax || "0") * 100;
        const isMintable = details.is_mintable === "1";
        const transferPausable = details.transfer_pausable === "1";
        let riskScore = 0;
        const flags = [];
        if (isHoneypot) {
            riskScore += 80;
            flags.push("Honeypot contract detected - buy at your own peril (cannot sell)");
        }
        if (buyTax > 10) {
            riskScore += 15;
            flags.push(`High buy tax: ${buyTax.toFixed(2)}%`);
        }
        if (sellTax > 10) {
            riskScore += 15;
            flags.push(`High sell tax: ${sellTax.toFixed(2)}%`);
        }
        if (isMintable) {
            riskScore += 10;
            flags.push("Token is mintable by owner/creator");
        }
        if (transferPausable) {
            riskScore += 15;
            flags.push("Trading/transfers can be paused by owner");
        }
        const safetyScore = Math.max(0, 100 - riskScore);
        return ok({
            chainId,
            environment: chainId === CHAIN_ID ? PHAROS_ENVIRONMENT : "custom-chain",
            isMainnet: false,
            tokenAddress: address,
            securityProfile: {
                safetyScore,
                isHoneypot,
                buyTaxPercent: buyTax,
                sellTaxPercent: sellTax,
                isMintable,
                transferPausable,
                isProxy: details.is_proxy === "1",
                ownerAddress: details.owner_address || "0x0000000000000000000000000000000000000000",
                creatorAddress: details.creator_address || "0x0000000000000000000000000000000000000000",
            },
            flags,
            source: "goplus_api",
            sourceStatus: "ok",
        });
    }
    catch (err) {
        return classifyExternalError("goplus_api", err);
    }
}
//# sourceMappingURL=checkTokenSecurity.js.map