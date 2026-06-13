// ─── Tool: x402_pay_and_fetch ─────────────────────────────────────────────
// Enables an agent to fetch protected resources from an x402 server.
// Automatically executes the payment challenge only after HTTP 402 is returned.
// ─────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { CHAIN_ID, PHAROS_ENVIRONMENT, RPC_URL, MAX_X402_PAYMENT_USDC, X402_PAYMENT_TOKEN_ADDRESS } from "../lib/constants.js";
import { assertSafeFetchUrl, fetchWithTimeoutAndRetry } from "../lib/http.js";
import { fail, ok, requireWriteToolsEnabled } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
export const x402PayAndFetchSchema = z.object({
    url: z.string().describe("Target URL of the protected resource requiring x402 payment"),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("GET").describe("HTTP method to use"),
    body: z.string().optional().describe("Optional stringified JSON request body"),
    rpcUrl: z.string().optional().describe("Custom RPC URL for payment verification (defaults to Atlantic Testnet RPC)"),
    agentId: z.string().optional().describe("Managed testnet wallet agentId when WALLET_MODE=managed-testnet"),
    maxPaymentUsdc: z.string().optional().default(MAX_X402_PAYMENT_USDC),
});
export const x402PayAndFetchTool = {
    name: "x402_pay_and_fetch",
    description: "Fetch resources from an HTTP x402 payment-gated server. " +
        "If the server challenges with HTTP 402, this tool signs the required testnet payment payload and completes the fetch.",
    inputSchema: x402PayAndFetchSchema,
};
async function readResponseBody(res) {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        try {
            return await res.json();
        }
        catch {
            return null;
        }
    }
    return await res.text();
}
function buildFetchOptions(input) {
    const fetchOptions = {
        method: input.method,
        headers: {
            "Content-Type": "application/json",
        },
    };
    if (input.body)
        fetchOptions.body = input.body;
    return fetchOptions;
}
export async function handleX402PayAndFetch(raw) {
    const input = x402PayAndFetchSchema.parse(raw);
    try {
        await assertSafeFetchUrl(input.url);
    }
    catch (err) {
        return fail("SSRF_BLOCKED", err instanceof Error ? err.message.replace(/^SSRF_BLOCKED:\s*/, "") : String(err), false, "x402_pay_and_fetch");
    }
    const staticPolicy = evaluateActionPolicy({
        actionType: "x402_pay_and_fetch",
        url: input.url,
        paymentAmountUsdc: input.maxPaymentUsdc,
        paymentTokenAddress: X402_PAYMENT_TOKEN_ADDRESS,
        chainId: CHAIN_ID,
        environment: PHAROS_ENVIRONMENT,
        isMainnet: false,
    });
    if (staticPolicy.decision === "BLOCK") {
        return fail("POLICY_BLOCKED", staticPolicy.reasons.join(" ") || "x402 request blocked by SafeHands policy.", false, "x402_pay_and_fetch");
    }
    const fetchOptions = buildFetchOptions(input);
    try {
        const initial = await fetchWithTimeoutAndRetry(input.url, {
            ...fetchOptions,
            timeoutMs: 10_000,
            retries: 1,
            retryDelayMs: 250,
        });
        if (initial.status !== 402) {
            const data = await readResponseBody(initial);
            return ok({
                status: initial.status,
                statusText: initial.statusText,
                data,
                paymentExecuted: false,
                paymentDetails: null,
                chainId: CHAIN_ID,
                environment: PHAROS_ENVIRONMENT,
                isMainnet: false,
                policy: staticPolicy,
                source: "x402_fetch",
            });
        }
        const writeGuard = requireWriteToolsEnabled("x402_pay_and_fetch");
        if (writeGuard)
            return writeGuard;
        const signer = await getSigner(input.agentId, { purpose: "x402" });
        if (isSignerFailure(signer)) {
            return fail("X402_PAYMENT_REQUIRED", `The resource returned HTTP 402, but no safe x402 signer is available: ${signer.error.message}`, false, "x402_pay_and_fetch");
        }
        const paymentPolicy = evaluateActionPolicy({
            actionType: "x402_pay_and_fetch",
            url: input.url,
            paymentAmountUsdc: input.maxPaymentUsdc,
            paymentTokenAddress: X402_PAYMENT_TOKEN_ADDRESS,
            chainId: CHAIN_ID,
            environment: PHAROS_ENVIRONMENT,
            isMainnet: false,
            signerAvailable: true,
            requiresSigner: true,
        });
        if (paymentPolicy.decision === "BLOCK") {
            return fail("POLICY_BLOCKED", paymentPolicy.reasons.join(" ") || "x402 payment blocked by SafeHands policy.", false, "x402_pay_and_fetch");
        }
        const rpc = input.rpcUrl || process.env.PHAROS_RPC_URL || RPC_URL;
        const client = new x402Client();
        registerExactEvmScheme(client, {
            signer: signer.account,
            schemeOptions: {
                [CHAIN_ID]: { rpcUrl: rpc },
            },
        });
        const fetchWithPayment = wrapFetchWithPayment(fetch, client);
        const paidResponse = await fetchWithPayment(input.url, fetchOptions);
        const data = await readResponseBody(paidResponse);
        const paymentResponseHeader = paidResponse.headers.get("PAYMENT-RESPONSE");
        return ok({
            status: paidResponse.status,
            statusText: paidResponse.statusText,
            data,
            paymentExecuted: !!paymentResponseHeader,
            paymentDetails: paymentResponseHeader
                ? {
                    headerRedacted: true,
                    note: "PAYMENT-RESPONSE header was present but intentionally not exposed to avoid leaking signed payment data.",
                }
                : null,
            signerMode: signer.mode,
            walletAddress: signer.address,
            paymentToken: X402_PAYMENT_TOKEN_ADDRESS,
            maxPaymentUsdc: input.maxPaymentUsdc,
            chainId: CHAIN_ID,
            environment: PHAROS_ENVIRONMENT,
            isMainnet: false,
            policy: paymentPolicy,
            testnetPayment: true,
            source: "x402_fetch",
        });
    }
    catch (err) {
        return fail("X402_PAYMENT_FAILED", err instanceof Error ? err.message : String(err), true, "x402_pay_and_fetch");
    }
}
//# sourceMappingURL=x402PayAndFetch.js.map