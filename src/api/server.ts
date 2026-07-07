// ─── SafeHands API — Express Server + Tool Gateway ───────────────
// Wires the pure read-only handlers (routes.ts) to HTTP. The only chain access
// is a READ-ONLY viem public client (getCode / estimateGas / getGasPrice /
// getTransactionReceipt). There is NO wallet client, NO private key, NO signer,
// NO facilitator, and NO write/publish path — execution is impossible by
// construction. Separate file/port from x402Server.ts.
//
// Production hardening (Phase 6) lives in httpHardening.ts (pure, env-driven):
// PORT/host, CORS allowlist, JSON body limit, rate limiting, error/404 shape.
// The HTTP listener only starts when this module is run directly (e.g.
// `node dist/api/server.js`), so importing it (tests/tools) never binds a port.
// ────────────────────────────────────────────────────────────────────────

import "../lib/envLoader.js";
import { pathToFileURL } from "url";
import express from "express";
import { createPublicClient, defineChain, http } from "viem";

import { getActiveNetwork, resolveRpcUrl } from "../lib/networks.js";
import { PharosReadOnlyRpc } from "../lib/pharos/rpc.js";
import type { ReadOnlyChainAccess } from "../lib/analysis/index.js";
import {
  handleHealth,
  handleInfraStatus,
  handlePublicConfig,
  handleGuardianCheck,
  handleAnalyzeTx,
  handleAnalyzeContract,
  handleAnalyzeApproval,
  handleAnalyzeSafe,
  handleAnalyzeX402,
} from "./routes.js";
import { ok, fail } from "../lib/toolResponse.js";
import { handleAgentCheck, handleAgentA2ACheck } from "./agentRoutes.js";
import { handlePrepareTx } from "./prepareRoutes.js";
import { handleWalletPrepare } from "./walletPrepareRoutes.js";
import { handleBroadcastSigned, handleGetBroadcastAttestationStatus } from "./broadcastRoutes.js";
import { handleGoldskyStatus, handleLatestRiskRootIndex, handleAgentReputation } from "./indexerRoutes.js";
import { assertProductionPosture } from "../lib/productionGuards.js";
import { handleActivitySummary, handleActivityRecent, handleMetricsPublic } from "./activityRoutes.js";
import { listHostedTools, invokeHostedTool, isWriteTool } from "./toolRoutes.js";
import { DEMO_PAGE_HTML } from "./consolePage.js";
import { buildX402Gate } from "./x402Gate.js";
import { registerPaidRoutes } from "./paidRoutes.js";
import {
  BIND_HOST,
  resolvePort,
  isProduction,
  resolveCorsConfig,
  corsOriginValue,
  resolveJsonLimit,
  resolveRateLimitConfig,
  resolveQuotaConfig,
  resolveActivityConfig,
  resolveLoggingConfig,
  errorResponseBody,
  notFoundBody,
} from "./httpHardening.js";
import { resolveRequestId } from "../lib/observability/requestId.js";
import { logRequest } from "../lib/observability/logger.js";
import { loadApiKeyConfig, resolveApiKey, evaluateAccess } from "../lib/observability/apiKey.js";
import { buildAccessContext, type AccessContext } from "../lib/observability/accessContext.js";
import { QuotaLimiter, tierForCaller } from "../lib/observability/quota.js";
import { resolvePresetName, presetPolicy, sanitizeRequestPolicy } from "../lib/policy/policyPresets.js";
import { activityStore } from "../lib/observability/activityStore.js";
import { toActivityItem, callerTypeForEndpoint } from "../lib/observability/sanitize.js";

// ── Read-only chain access (no signer, no wallet) ──────────────────────
function buildReadOnlyAccess(): ReadOnlyChainAccess {
  const network = getActiveNetwork();
  const rpcUrl = resolveRpcUrl(network);
  const chain = defineChain({
    id: network.chainId,
    name: network.label,
    nativeCurrency: { name: network.nativeToken, symbol: network.nativeToken, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: !network.isMainnet,
  });
  const client = createPublicClient({ chain, transport: http(undefined, { timeout: 10_000 }) });
  // Single whitelist chokepoint: every live read passes the read-only method gate
  // (rpc.guarded throws fail-closed for any non-read method) before the viem call.
  const rpc = new PharosReadOnlyRpc({ network, url: rpcUrl });
  return {
    getCode: (address) => rpc.guarded("eth_getCode", () => client.getCode({ address })),
    estimateGas: (args) => rpc.guarded("eth_estimateGas", () => client.estimateGas(args)),
    getGasPrice: () => rpc.guarded("eth_gasPrice", () => client.getGasPrice()),
    getTransactionReceipt: (hash) => rpc.guarded("eth_getTransactionReceipt", () => client.getTransactionReceipt({ hash })),
  };
}

// ── Error mapping (consistent shape; never leaks stack traces) ─────────
function sendError(res: express.Response, err: unknown): void {
  const { status, body } = errorResponseBody(err, { production: isProduction() });
  res.status(status).json(body);
}

/**
 * Build the SafeHands Express app (no listen). Pure construction so it can
 * be imported by tests/tooling without binding a port. All middleware is env-driven
 * via httpHardening.ts.
 */
export function createGuardianApp(): express.Application {
  const chainAccess = buildReadOnlyAccess();
  const cors = resolveCorsConfig();
  const quotaCfg = resolveQuotaConfig();
  const quota = new QuotaLimiter(quotaCfg);
  const jsonLimit = resolveJsonLimit();
  const apiKeyCfg = loadApiKeyConfig();
  const activityCfg = resolveActivityConfig();
  const loggingCfg = resolveLoggingConfig();

  // Size/reset the in-memory activity ring from env at construction.
  activityStore.configure(activityCfg.capacity);

  const app = express();
  app.disable("x-powered-by");

  // Trust proxy — REQUIRED for correct client IP behind a reverse proxy/CDN, or
  // the rate-limit buckets on req.ip collapse every client into the proxy's IP.
  // Env-driven (default off = direct connection). "true" | integer hops | preset.
  const tp = process.env.SAFEHANDS_TRUST_PROXY;
  if (tp && tp !== "false") {
    const hops = Number(tp);
    app.set("trust proxy", tp === "true" ? true : Number.isInteger(hops) ? hops : tp);
  }

  // ── Request ID + structured request log (first; even 404/429 get an id) ──
  app.use((req, res, next) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const startNs = process.hrtime.bigint();
    res.locals.requestId = requestId;
    res.locals.startNs = startNs;
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - startNs) / 1e6);
      logRequest(
        {
          ts: new Date().toISOString(),
          level: "info",
          event: "request",
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs,
          callerType: (res.locals.callerType as string | undefined) ?? null,
          decision: (res.locals.decision as string | undefined) ?? null,
          rateLimited: res.locals.rateLimited === true,
          apiKeyId: (res.locals.apiKeyId as string | undefined) ?? null,
        },
        loggingCfg,
      );
    });
    next();
  });

  // CORS (env-driven allowlist; wildcard default for the public read-only API) + headers.
  app.use((req, res, next) => {
    const originValue = corsOriginValue(req.headers.origin, cors);
    if (originValue) res.setHeader("Access-Control-Allow-Origin", originValue);
    if (cors.mode === "allowlist") res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Api-Key, Authorization, X-Request-Id");
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY"); // clickjacking protection
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains"); // honored over HTTPS
    if (req.method === "OPTIONS") return res.sendStatus(204);
    req.setTimeout(15_000);
    next();
  });

  app.use(express.json({ limit: jsonLimit }));

  // ── Optional API-key access control (open by default) ───────────────────
  // Public read API stays open unless an operator configures keys AND sets
  // SAFEHANDS_REQUIRE_API_KEY=true. An explicitly invalid key is always 401.
  app.use((req, res, next) => {
    const resolution = resolveApiKey(req.headers, apiKeyCfg);
    // Sanitized caller identity (no raw key/headers/IP/payload) for activity + logs.
    const accessCtx = buildAccessContext({
      path: req.path,
      resolution,
      body: req.body,
      requestId: res.locals.requestId as string | undefined,
    });
    res.locals.access = accessCtx;
    res.locals.apiKeyId = accessCtx.keyId; // backward-compat for the request log
    res.locals.apiKeyStatus = resolution.status; // "valid" | "anonymous" | "invalid" — used by the write-auth gate
    const gate = evaluateAccess(req.path, resolution, apiKeyCfg);
    res.locals.authGate = gate; // Save gate for evaluation after quota
    next();
  });

  // Tiered in-memory quota (Phase 8B). Bucket key = TRUSTED identifier only:
  // `keyId` for a valid key, else the client IP — never untrusted body identity.
  // The access tier (anonymous | api-key | agent | a2a) selects the limit. Adds
  // X-RateLimit-* headers (+ Retry-After on 429). No keys/IPs in headers or body.
  // /health is exempt so the Railway liveness probe is never throttled.
  if (quotaCfg.enabled) {
    app.use((req, res, next) => {
      if (req.path === "/health") return next();
      const ctx = res.locals.access as AccessContext | undefined;
      const tier = tierForCaller(ctx?.callerType ?? "anonymous");
      const identifier = ctx?.keyId ?? req.ip ?? "unknown";
      const state = quota.consume(tier, identifier);
      res.setHeader("X-RateLimit-Limit", String(state.limit));
      res.setHeader("X-RateLimit-Remaining", String(state.remaining));
      res.setHeader("X-RateLimit-Reset", String(state.resetAtSec));
      if (state.limited) {
        res.setHeader("Retry-After", String(state.retryAfterSec));
        res.locals.rateLimited = true;
        activityStore.recordRateLimited(tier);
        const { body } = errorResponseBody(new Error("Too many requests"), { production: isProduction() });
        return res.status(429).json({ ...body, error: { ...body.error, code: "RATE_LIMITED", retryable: true } });
      }
      return next();
    });
  }

  // ── Auth Rejection Gate (runs AFTER Quota so brute-force attempts are rate-limited) ──
  app.use((req, res, next) => {
    const gate = res.locals.authGate;
    if (gate && !gate.allow) {
      const status = gate.code === "INSUFFICIENT_SCOPE" ? 403 : 401;
      const message =
        gate.code === "API_KEY_REQUIRED"
          ? "A valid API key is required for this endpoint."
          : gate.code === "INSUFFICIENT_SCOPE"
            ? "The provided API key lacks the required scope for this endpoint."
            : "Invalid API key.";
      return res.status(status).json(fail(gate.code ?? "UNAUTHORIZED", message, false, "guardian_api"));
    }
    next();
  });

  // ── Activity recording + response helpers (decision/analysis endpoints) ─
  function recordDecision(req: express.Request, res: express.Response, endpoint: string, payload: unknown): void {
    const callerType = callerTypeForEndpoint(endpoint);
    res.locals.callerType = callerType;
    if (payload && typeof payload === "object" && "decision" in (payload as Record<string, unknown>)) {
      res.locals.decision = (payload as Record<string, unknown>).decision;
    }
    if (!activityCfg.enabled) return;
    try {
      const access = res.locals.access as AccessContext | undefined;
      activityStore.record(
        toActivityItem({
          endpoint,
          callerType,
          requestId: (res.locals.requestId as string) ?? "unknown",
          body: req.body,
          payload,
          access,
        }),
      );
    } catch {
      // recording must never affect the response
    }
  }

  function sendOk(req: express.Request, res: express.Response, data: unknown): void {
    const requestId = res.locals.requestId as string | undefined;
    res.json(ok({ ...(data as Record<string, unknown>), requestId }));
  }

  // State-changing endpoints (write tools, signed broadcast) must NEVER ride the
  // open read origin. Require a VALID API key regardless of SAFEHANDS_REQUIRE_API_KEY.
  // Fail-closed: with no keys configured, a write call cannot authenticate → refused.
  function writeAuthOk(res: express.Response): boolean {
    return res.locals.apiKeyStatus === "valid";
  }
  function denyWriteAuth(res: express.Response): express.Response {
    return res.status(401).json(
      fail(
        "API_KEY_REQUIRED_FOR_WRITE",
        "This state-changing endpoint requires a valid API key. Configure SAFEHANDS_API_KEYS and present it via X-Api-Key or Authorization: Bearer.",
        false,
        "guardian_api",
      ),
    );
  }

  // Resolve the policy preset (tighten-only) + sanitize request overrides for the
  // agent path. The result is fed to the EXISTING escalate-only applyPolicy, so it
  // can never weaken a decision. Agent endpoints default to the `agent` preset.
  function agentPolicyOpts(reqBody: unknown): { policy: ReturnType<typeof presetPolicy>; policyPreset: string } {
    const body = reqBody && typeof reqBody === "object" ? (reqBody as Record<string, unknown>) : {};
    const policyPreset = resolvePresetName(body.policyPreset, "agent", process.env.SAFEHANDS_POLICY_PRESET);
    const policy = sanitizeRequestPolicy(presetPolicy(policyPreset), body.policy);
    return { policy, policyPreset };
  }

  // ── SafeHands/read routes ─────────────────────────────────────────────
  // Interactive browser demo (static HTML, no keys, same-origin tool calls).
  app.get("/demo", (_req, res) => {
    // Static, server-controlled HTML with same-origin tool calls. Lock it down:
    // no framing, and restrict resource origins. Inline is allowed because the
    // console page ships its own inline script/style and reflects no user input.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    );
    res.type("html").send(DEMO_PAGE_HTML);
  });
  app.get("/health", (req, res) => sendOk(req, res, handleHealth()));
  app.get("/infra/status", (req, res) => sendOk(req, res, handleInfraStatus()));
  app.get("/public-config", (req, res) => sendOk(req, res, handlePublicConfig()));

  app.post("/guardian/check", async (req, res) => {
    try {
      const payload = await handleGuardianCheck(req.body ?? {}, chainAccess);
      recordDecision(req, res, "/guardian/check", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });
  app.post("/analyze/tx", async (req, res) => {
    try {
      const payload = await handleAnalyzeTx(req.body ?? {}, chainAccess);
      recordDecision(req, res, "/analyze/tx", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });
  app.post("/analyze/contract", async (req, res) => {
    try {
      const payload = await handleAnalyzeContract(req.body ?? {}, chainAccess);
      recordDecision(req, res, "/analyze/contract", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });
  app.post("/analyze/approval", (req, res) => {
    try {
      const payload = handleAnalyzeApproval(req.body ?? {});
      recordDecision(req, res, "/analyze/approval", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });
  app.post("/analyze/safe", async (req, res) => {
    try {
      const payload = await handleAnalyzeSafe(req.body ?? {});
      recordDecision(req, res, "/analyze/safe", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });
  app.post("/analyze/x402", (req, res) => {
    try {
      const payload = handleAnalyzeX402(req.body ?? {});
      recordDecision(req, res, "/analyze/x402", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });

  // ── SafeHands Agent endpoints (real SafeHandsGuardianAgent, read-only) ──
  app.post("/agent/check", async (req, res) => {
    try {
      const payload = await handleAgentCheck(req.body ?? {}, chainAccess, agentPolicyOpts(req.body));
      recordDecision(req, res, "/agent/check", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });
  app.post("/agent/a2a/check", async (req, res) => {
    try {
      const payload = await handleAgentA2ACheck(req.body ?? {}, chainAccess, agentPolicyOpts(req.body));
      recordDecision(req, res, "/agent/a2a/check", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });

  // ── Prepare-only unsigned transaction — read-only; never signs/broadcasts ──
  app.post("/prepare/tx", async (req, res) => {
    try {
      const payload = await handlePrepareTx(req.body ?? {}, chainAccess, agentPolicyOpts(req.body));
      recordDecision(req, res, "/prepare/tx", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });

  // ── Wallet-ready transaction handoff — read-only; never signs/broadcasts ──
  // Reads wallet context (userAddress/from) from the request and returns a wallet-ready
  // request for an EXTERNAL wallet to sign + send. SafeHands holds no key and creates no wallet.
  app.post("/wallet/prepare", async (req, res) => {
    try {
      const payload = await handleWalletPrepare(req.body ?? {}, chainAccess, agentPolicyOpts(req.body));
      recordDecision(req, res, "/wallet/prepare", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });

  // ── Verified Broadcast ──
  app.post("/broadcast/signed", async (req, res) => {
    try {
      if (!writeAuthOk(res)) return denyWriteAuth(res);
      const payload = await handleBroadcastSigned(req.body ?? {});
      recordDecision(req, res, "/broadcast/signed", payload);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });

  app.get("/attestation/:txHash", async (req, res) => {
    try {
      const payload = await handleGetBroadcastAttestationStatus(req.params.txHash);
      sendOk(req, res, payload);
    } catch (err) { sendError(res, err); }
  });

  app.get("/goldsky/status", (req, res) => {
    try { sendOk(req, res, handleGoldskyStatus()); } catch (err) { sendError(res, err); }
  });

  app.get("/registry/latest", async (req, res) => {
    try { sendOk(req, res, await handleLatestRiskRootIndex()); } catch (err) { sendError(res, err); }
  });

  app.get("/reputation/:address", async (req, res) => {
    try { sendOk(req, res, await handleAgentReputation(req.params.address)); } catch (err) { sendError(res, err); }
  });

  // ── Public activity feed + aggregate metrics (read-only, Phase 7) ──────
  app.get("/activity/summary", (req, res) => {
    try { sendOk(req, res, handleActivitySummary()); } catch (err) { sendError(res, err); }
  });
  app.get("/activity/recent", (req, res) => {
    try { sendOk(req, res, handleActivityRecent(req.query)); } catch (err) { sendError(res, err); }
  });
  app.get("/metrics/public", (req, res) => {
    try { sendOk(req, res, handleMetricsPublic()); } catch (err) { sendError(res, err); }
  });

  // ── Full SafeHands hosted tool gateway (same 33 tools as MCP/Anvita) ──
  app.get("/tools", (req, res) => {
    try { sendOk(req, res, listHostedTools()); } catch (err) { sendError(res, err); }
  });
  app.post("/tools/:toolName", async (req, res) => {
    try {
      // Read tools stay open; write tools require a valid API key (never open-origin execution).
      if (isWriteTool(req.params.toolName) && !writeAuthOk(res)) return denyWriteAuth(res);
      const payload = await invokeHostedTool(req.params.toolName, req.body ?? {});
      res.status(payload.success ? 200 : 400).json(payload);
    } catch (err) { sendError(res, err); }
  });

  // ── x402 paid bundle entrypoints (/paid/*) ────────────────────────────
  // Zero-custody gate: an EXTERNAL facilitator verifies/settles; the service holds no
  // key. Installed BEFORE the handlers so paid logic never runs pre-payment; fail-closed
  // (503) when unconfigured. Sits after quota/auth so 402 challenges stay rate-limited.
  const x402Gate = buildX402Gate();
  x402Gate.install(app);
  registerPaidRoutes(app);

  // ── Safe 404 (consistent shape) for any unmatched route/method ────────
  app.use((req, res) => {
    res.status(404).json(notFoundBody(req.method, req.path));
  });

  // ── Global error handler (last) — catches throws from middleware/body-parser
  // that escape the per-route try/catch. ALWAYS genericized (production shape)
  // so a stack trace can never leak regardless of NODE_ENV. ─────────────
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const { status, body } = errorResponseBody(err, { production: true });
    res.status(status).json(body);
  });

  return app;
}

/** Start the read-only SafeHands API on 0.0.0.0:PORT (Railway-ready). */
export function startServer(): void {
  // Fail-fast / warn on unsafe public-hosting posture before binding (production only).
  assertProductionPosture();
  const app = createGuardianApp();
  const port = resolvePort();
  app.listen(port, BIND_HOST, () => {
    const network = getActiveNetwork();
    console.log(`✅ SafeHands API + Tool Gateway on http://${BIND_HOST}:${port}`);
    console.log(`📡 Active network: ${network.label} (chainId ${network.chainId}, ${network.nativeToken})`);
    console.log(`🔐 Default-safe: read/check routes are open; hosted tools and user-signed broadcast stay env-gated.`);
    console.log(`🆓 GET /health, /infra/status, /public-config · POST /guardian/check, /analyze/{tx,contract,approval,safe,x402}, /agent/check, /agent/a2a/check, /prepare/tx, /wallet/prepare, /broadcast/signed · GET /tools · POST /tools/:toolName`);
    console.log(`📊 Observability: GET /activity/summary, /activity/recent, /metrics/public · X-Request-Id on every response`);
  });
}

// Start ONLY when run directly (e.g. `node dist/api/server.js`); importing never binds.
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) startServer();
