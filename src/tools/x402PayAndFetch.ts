// ─── Tool: x402_pay_and_fetch ─────────────────────────────────────────────
// Enables an agent to fetch protected resources from an x402 server.
// Automatically executes the payment challenge only after HTTP 402 is returned.
// ─────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { CHAIN_ID, PHAROS_ENVIRONMENT, RPC_URL, MAX_X402_PAYMENT_USDC, X402_PAYMENT_TOKEN_ADDRESS, IS_MAINNET, activeX402AllowedTokenAddresses } from "../lib/constants.js";
import { assertSafeFetchUrl, fetchWithTimeoutAndRetry } from "../lib/http.js";
import { fail, ok, requireWriteToolsEnabled } from "../lib/toolResponse.js";
import { getSigner, isSignerFailure } from "../lib/signer/index.js";
import { checkManagedWalletAuthorization } from "../lib/safeHandsRegistry.js";
import { REQUIRE_AUTHORIZED_AGENT_FOR_X402 } from "../lib/constants.js";
import { evaluateActionPolicy } from "../lib/policy/actionPolicyEngine.js";
import { validatePositiveAmount } from "../lib/validation.js";

export const x402PayAndFetchSchema = z.object({
  url: z.string().describe("Target URL of the protected resource requiring x402 payment"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("GET").describe("HTTP method to use"),
  body: z.string().optional().describe("Optional stringified JSON request body"),
  rpcUrl: z.string().optional().describe("Custom RPC URL for payment verification"),
  agentId: z.string().optional().describe("Managed wallet agentId when WALLET_MODE=managed-mainnet"),
  maxPaymentUsdc: z.string().optional().default(MAX_X402_PAYMENT_USDC),
}).strict();

export type X402PayAndFetchInput = z.input<typeof x402PayAndFetchSchema>;

export const x402PayAndFetchTool = {
  name: "x402_pay_and_fetch",
  description:
    "Fetch resources from an HTTP x402 payment-gated server. " +
    "If the server challenges with HTTP 402, this tool signs the required mainnet payment payload and completes the fetch.",
  inputSchema: x402PayAndFetchSchema,
};

async function readResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return await res.text();
}

function buildFetchOptions(input: z.infer<typeof x402PayAndFetchSchema>): RequestInit {
  const fetchOptions: RequestInit = {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (input.body) fetchOptions.body = input.body;
  return fetchOptions;
}

function x402AllowedTokenSet(): Set<string> {
  return new Set(activeX402AllowedTokenAddresses().map((a) => a.toLowerCase()));
}

function validateX402Challenge(challengeHeader: string | null, maxPaymentUsdc: string): string | null {
  if (!challengeHeader) return null;
  try {
    const decoded = JSON.parse(Buffer.from(challengeHeader, "base64").toString("utf-8"));

    if (decoded.maxAmountRequired) {
      const challengeAmount = Number(decoded.maxAmountRequired) / 1e6;
      if (challengeAmount > Number(maxPaymentUsdc)) {
        return `x402 challenge amount (${challengeAmount} USDC) exceeds maxPaymentUsdc (${maxPaymentUsdc}).`;
      }
    }

    if (decoded.network) {
      const parts = String(decoded.network).split(":");
      const challengeChainId = parts.length === 2 ? Number(parts[1]) : Number(decoded.network);
      if (Number.isFinite(challengeChainId) && challengeChainId !== CHAIN_ID) {
        return `x402 challenge targets chain ${challengeChainId}, expected ${PHAROS_ENVIRONMENT} (${CHAIN_ID}).`;
      }
    }

    if (decoded.asset) {
      const asset = String(decoded.asset).toLowerCase();
      if (!x402AllowedTokenSet().has(asset)) {
        const allowed = activeX402AllowedTokenAddresses().join(", ");
        return `x402 challenge requests payment in unsupported token ${decoded.asset}. Supported for ${PHAROS_ENVIRONMENT}: ${allowed}.`;
      }
    }
  } catch {
    // Challenge header not parseable — proceed with caution but don't block
  }
  return null;
}

export async function handleX402PayAndFetch(raw: X402PayAndFetchInput) {
  let input: z.infer<typeof x402PayAndFetchSchema>;
  try {
    input = x402PayAndFetchSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : String(err);
    return fail("VALIDATION_ERROR", `x402_pay_and_fetch input validation failed: ${msg}`, false, "x402_pay_and_fetch");
  }

  if (input.maxPaymentUsdc) {
    const amtErr = validatePositiveAmount(input.maxPaymentUsdc, "maxPaymentUsdc");
    if (amtErr) return fail("VALIDATION_ERROR", amtErr, false, "x402_pay_and_fetch");
  }

  try {
    await assertSafeFetchUrl(input.url);
  } catch (err) {
    return fail(
      "SSRF_BLOCKED",
      err instanceof Error ? err.message.replace(/^SSRF_BLOCKED:\s*/, "") : String(err),
      false,
      "x402_pay_and_fetch"
    );
  }

  const staticPolicy = evaluateActionPolicy({
    actionType: "x402_pay_and_fetch",
    agentId: input.agentId,
    url: input.url,
    paymentAmountUsdc: input.maxPaymentUsdc,
    paymentTokenAddress: X402_PAYMENT_TOKEN_ADDRESS,
    chainId: CHAIN_ID,
    environment: PHAROS_ENVIRONMENT,
    isMainnet: IS_MAINNET,
  });
  if (staticPolicy.decision === "BLOCK") {
    return fail("POLICY_BLOCKED", staticPolicy.reasons.join(" ") || "x402 request blocked by SafeHands policy.", false, "x402_pay_and_fetch");
  }

  const fetchOptions = buildFetchOptions(input);

  try {
    let initial: Response;
    try {
      initial = await fetchWithTimeoutAndRetry(input.url, {
        ...fetchOptions,
        timeoutMs: 10_000,
        retries: 1,
        retryDelayMs: 250,
      });
    } catch (err) {
      // fetchWithTimeoutAndRetry follows redirects internally and re-validates
      // SSRF on every hop (initial URL and every redirect target). Surface
      // that as the same clean SSRF_BLOCKED error code used for the upfront
      // check, instead of falling through to the generic X402_PAYMENT_FAILED.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SSRF_BLOCKED")) {
        return fail("SSRF_BLOCKED", msg.replace(/^SSRF_BLOCKED:\s*/, ""), false, "x402_pay_and_fetch");
      }
      throw err;
    }

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
        isMainnet: IS_MAINNET,
        policy: staticPolicy,
        source: "x402_fetch",
      });
    }

    const challengeHeader = initial.headers.get("PAYMENT-REQUIRED");
    const challengeError = validateX402Challenge(challengeHeader, input.maxPaymentUsdc);
    if (challengeError) {
      return fail("X402_CHALLENGE_INVALID", challengeError, false, "x402_pay_and_fetch");
    }

    const writeGuard = requireWriteToolsEnabled("x402_pay_and_fetch");
    if (writeGuard) return writeGuard;

    const signer = await getSigner(input.agentId, { purpose: "x402" });
    if (isSignerFailure(signer)) {
      return fail(
        "X402_PAYMENT_REQUIRED",
        `The resource returned HTTP 402, but no safe x402 signer is available: ${signer.error.message}`,
        false,
        "x402_pay_and_fetch"
      );
    }

    // x402 is permissionless-first: self-signed x402 (mode "x402-env") never needs
    // registry authorization. A managed/custodial x402 payment is allowlist-gated
    // ONLY when explicitly opted in via REQUIRE_AUTHORIZED_AGENT_FOR_X402=true.
    if (signer.mode === "managed-mainnet" && REQUIRE_AUTHORIZED_AGENT_FOR_X402) {
      const authCheck = await checkManagedWalletAuthorization(signer.address);
      if (!authCheck.authorized) {
        return fail(
          "REQUIRE_AUTHORIZATION",
          authCheck.errorMessage || "Managed wallet is not authorized in SafeHandsRegistry.",
          false,
          "x402_pay_and_fetch"
        );
      }
    }

    const paymentPolicy = evaluateActionPolicy({
      actionType: "x402_pay_and_fetch",
      agentId: input.agentId,
      url: input.url,
      paymentAmountUsdc: input.maxPaymentUsdc,
      paymentTokenAddress: X402_PAYMENT_TOKEN_ADDRESS,
      chainId: CHAIN_ID,
      environment: PHAROS_ENVIRONMENT,
      isMainnet: IS_MAINNET,
      signerAvailable: true,
      requiresSigner: true,
    });
    if (paymentPolicy.decision === "BLOCK") {
      return fail("POLICY_BLOCKED", paymentPolicy.reasons.join(" ") || "x402 payment blocked by SafeHands policy.", false, "x402_pay_and_fetch");
    }

    const rpc = input.rpcUrl || process.env.PHAROS_RPC_URL || RPC_URL;
    const client = new x402Client();
    registerExactEvmScheme(client, {
      signer: signer.account as any,
      schemeOptions: {
        [CHAIN_ID]: { rpcUrl: rpc },
      },
    });

    // wrapFetchWithPayment always invokes the supplied fetch with a single
    // Request object (it builds one internally via `new Request(input, init)`
    // and clones it for retries/hooks). This guard re-derives the URL/method/
    // headers/body from that Request and routes the actual network call
    // through fetchWithTimeoutAndRetry, so the payment-carrying request — the
    // most sensitive call in this flow — gets the same DNS-pinned SSRF
    // protection as the initial request instead of bypassing it via the raw
    // global fetch.
    const guardedFetch: typeof fetch = async (requestInput, requestInit) => {
      const req = requestInput instanceof Request ? requestInput : new Request(requestInput, requestInit);
      const method = req.method || "GET";
      const headersInit: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headersInit[key] = value;
      });

      let body: BodyInit | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const buf = await req.arrayBuffer();
        if (buf.byteLength > 0) body = new Uint8Array(buf) as unknown as BodyInit;
      }

      return fetchWithTimeoutAndRetry(req.url, {
        method,
        headers: headersInit,
        body,
        timeoutMs: 10_000,
        retries: 0, // avoid duplicate payment submission on a transient error
      });
    };

    const fetchWithPayment = wrapFetchWithPayment(guardedFetch, client);
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
      isMainnet: IS_MAINNET,
      policy: paymentPolicy,
      mainnetPayment: true,
      source: "x402_fetch",
    });
  } catch (err) {
    return fail(
      "X402_PAYMENT_FAILED",
      err instanceof Error ? err.message : String(err),
      true,
      "x402_pay_and_fetch"
    );
  }
}
