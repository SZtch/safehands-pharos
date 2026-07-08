// ─── P13 · x402 Payment Gate (single-service) ──────────────────────────────
// Verifies the additive `/paid/*` gate in dist/api/server.js:
//   • fail-closed 503 when x402 is unconfigured (handler never runs)
//   • 402 challenge (payment required) when configured but no X-PAYMENT
//   • replay protection rejects a reused X-PAYMENT authorization
//   • existing FREE routes are unaffected (no 402)
//   • internal helper tools are NOT charged one-by-one (/tools stays free)
//   • 402 challenges are still rate-limited (X-RateLimit-* headers present)
//   • zero-custody: gate config holds NO private key; posture stays clean
// A local MOCK facilitator stands in for the external relayer (X402_FACILITATOR_URL):
// it advertises the exact scheme via GET /supported and rejects every /verify, so the
// gate issues real 402 challenges without any on-chain settlement or private key.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveX402GateConfig } from "../src/api/x402Gate.js";
import { evaluateProductionPosture } from "../src/lib/productionGuards.js";
import { getCapabilityFlags } from "../src/lib/config.js";

const GATE_ENV_KEYS = [
  "X402_PAY_TO",
  "WALLET_ADDRESS",
  "X402_FACILITATOR_URL",
  "X402_PRICE_USDC",
  "SAFEHANDS_X402_REPLAY_WINDOW_MS",
  "SAFEHANDS_X402_REPLAY_STORE_PATH",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SAFEHANDS_REDIS_REST_URL",
  "SAFEHANDS_REDIS_REST_TOKEN",
] as const;

const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const REPLAY_STORE = join(tmpdir(), `safehands-x402-replay-test-${process.pid}.json`);
// The gate's network id is derived from CHAIN_ID only (independent of the facilitator URL).
const NETWORK = resolveX402GateConfig({ X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: "http://x" }).network;

// ── Mock external facilitator (relayer) ───────────────────────────────────
let facilitator: Server;
let FACILITATOR_URL = "";

before(async () => {
  facilitator = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && (req.url ?? "").startsWith("/supported")) {
      res.end(
        JSON.stringify({
          kinds: [
            { x402Version: 2, scheme: "exact", network: NETWORK },
            { x402Version: 1, scheme: "exact", network: NETWORK },
          ],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    if (req.method === "POST" && (req.url ?? "").startsWith("/verify")) {
      res.end(JSON.stringify({ isValid: false, invalidReason: "mock-invalid" }));
      return;
    }
    if (req.method === "POST" && (req.url ?? "").startsWith("/settle")) {
      res.end(JSON.stringify({ success: false, transaction: "0x", network: NETWORK }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  facilitator.listen(0);
  await new Promise<void>((r) => facilitator.once("listening", () => r()));
  FACILITATOR_URL = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((r) => facilitator.close(() => r()));
});

/** Snapshot → set → build app on an ephemeral port → run → close + restore env. */
async function withApp(env: Record<string, string | undefined>, fn: (base: string) => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of GATE_ENV_KEYS) saved[k] = process.env[k];
  for (const k of GATE_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);

  const { createGuardianApp } = await import("../src/api/server.js");
  const app = createGuardianApp();
  const server: Server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    for (const k of GATE_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("P13 · resolveX402GateConfig (pure)", () => {
  it("is unconfigured (fail-closed) with only a receiver and no facilitator URL", () => {
    assert.strictEqual(resolveX402GateConfig({ X402_PAY_TO: PAY_TO }).configured, false);
  });

  it("is unconfigured with only a facilitator URL and no receiver", () => {
    assert.strictEqual(resolveX402GateConfig({ X402_FACILITATOR_URL: "http://f" }).configured, false);
  });

  it("is configured with receiver + external facilitator URL", () => {
    const cfg = resolveX402GateConfig({ X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: "http://f" });
    assert.strictEqual(cfg.configured, true);
    assert.strictEqual(cfg.payTo, PAY_TO);
    assert.strictEqual(cfg.priceUsdc, "0.01");
  });

  it("holds NO private key (zero-custody: verify/settle happen off-host)", () => {
    const cfg = resolveX402GateConfig({ X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: "http://f" });
    const keys = Object.keys(cfg).join(",").toLowerCase();
    assert.ok(!keys.includes("privatekey"), "gate config must not carry a private key");
    assert.ok(!keys.includes("secret"), "gate config must not carry a secret");
  });
});

describe("P13 · /paid/* gate — UNCONFIGURED (fail-closed)", () => {
  it("returns 503 (handler never runs) for every paid route", async () => {
    await withApp({ X402_PAY_TO: PAY_TO /* no facilitator URL */ }, async (base) => {
      for (const path of ["/paid/assess-risk", "/paid/token-price", "/paid/risk-report"]) {
        const r = await fetch(`${base}${path}`);
        assert.strictEqual(r.status, 503, `${path} should fail closed`);
        const body = (await r.json()) as any;
        assert.strictEqual(body.error.code, "X402_SERVER_RECEIVER_CONFIG_MISSING");
      }
    });
  });
});

describe("P13 · /paid/* gate — CONFIGURED", () => {
  it("returns 402 (payment required) with no X-PAYMENT; handler does not run; still rate-limited", async () => {
    await withApp({ X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: FACILITATOR_URL }, async (base) => {
      const r = await fetch(`${base}/paid/assess-risk?action=swap&tokenIn=PROS&tokenOut=USDC&amount=1`);
      assert.strictEqual(r.status, 402, "unpaid request must be 402, not 200/503");
      assert.ok(r.headers.get("x-ratelimit-limit"), "402 challenge should carry rate-limit headers");
    });
  });

  it("rejects a REUSED X-PAYMENT authorization (replay protection)", async () => {
    await withApp(
      { X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: FACILITATOR_URL, SAFEHANDS_X402_REPLAY_STORE_PATH: REPLAY_STORE },
      async (base) => {
        // A genuine replay reuses a WELL-FORMED payment authorization. The gate now
        // pre-filters malformed junk (looksLikeX402Payment → 400) BEFORE the O(n) replay
        // store write, so the payload must be valid base64-JSON to reach replay logic.
        const payment = Buffer.from(
          JSON.stringify({
            x402Version: 2,
            scheme: "exact",
            network: NETWORK,
            payload: {
              authorization: { nonce: `test-${process.pid}-${Date.now()}` },
              signature: "0x" + "a".repeat(130),
            },
          }),
        ).toString("base64");
        const url = `${base}/paid/token-price?token=PROS`;
        // First use: replay records the authorization; the mock facilitator rejects it (not 200).
        const first = await fetch(url, { headers: { "X-PAYMENT": payment } });
        assert.notStrictEqual(first.status, 200, "unverifiable payment must not succeed");
        const firstBody = (await first.json().catch(() => ({}))) as any;
        assert.notStrictEqual(firstBody?.error?.code, "REPLAY_ATTACK_DETECTED", "first use is not a replay");
        // Second identical authorization is blocked by replay protection before settlement.
        const second = await fetch(url, { headers: { "X-PAYMENT": payment } });
        assert.strictEqual(second.status, 402);
        const body = (await second.json()) as any;
        assert.strictEqual(body.error.code, "REPLAY_ATTACK_DETECTED");
        assert.ok(second.headers.get("x-safehands-x402-replay-store"), "replay store backend header present");
      },
    );
  });
});

describe("P13 · free routes + internal tools remain uncharged", () => {
  it("keeps existing free routes open (no 402) even when x402 is configured", async () => {
    await withApp({ X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: FACILITATOR_URL }, async (base) => {
      assert.strictEqual((await fetch(`${base}/health`)).status, 200);
      const x402Analyze = await fetch(`${base}/analyze/x402`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/resource" }),
      });
      assert.notStrictEqual(x402Analyze.status, 402, "free /analyze/x402 must not be payment-gated");
    });
  });

  it("does NOT charge internal helper tools one-by-one (/tools stays free)", async () => {
    await withApp({ X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: FACILITATOR_URL }, async (base) => {
      const r = await fetch(`${base}/tools/get_token_price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "PROS" }),
      });
      assert.notStrictEqual(r.status, 402, "hosted read tool must not be x402-gated");
    });
  });
});

describe("P13 · zero-custody production posture", () => {
  it("stays fatal-free with WALLET_MODE=none + WRITE_TOOLS_ENABLED=false and x402 remote gate", () => {
    const issues = evaluateProductionPosture({
      NODE_ENV: "production",
      WALLET_MODE: "none",
      WRITE_TOOLS_ENABLED: "false",
      X402_PAY_TO: PAY_TO,
      X402_FACILITATOR_URL: "https://facilitator.example",
      SAFEHANDS_STATE_DIR: "/data",
      CORS_ORIGIN: "https://safehands.example",
    } as NodeJS.ProcessEnv);
    assert.strictEqual(issues.filter((i) => i.level === "fatal").length, 0);
  });

  it("fires the replay-Redis warning for the zero-custody (URL-based) x402 config", () => {
    const issues = evaluateProductionPosture({
      NODE_ENV: "production",
      WALLET_MODE: "none",
      WRITE_TOOLS_ENABLED: "false",
      X402_PAY_TO: PAY_TO,
      X402_FACILITATOR_URL: "https://facilitator.example",
      SAFEHANDS_X402_REPLAY_REDIS_REQUIRED: "true",
      SAFEHANDS_STATE_DIR: "/data",
      CORS_ORIGIN: "https://safehands.example",
    } as NodeJS.ProcessEnv);
    assert.ok(
      issues.some((i) => i.code === "X402_REPLAY_REDIS_MISSING"),
      "URL-configured x402 must count as configured for the replay-durability warning",
    );
  });

  it("capability flags report x402 paid endpoints for the zero-custody (URL-based) config", () => {
    const keys = ["X402_PAY_TO", "WALLET_ADDRESS", "X402_FACILITATOR_URL", "X402_FACILITATOR_PRIVATE_KEY"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      assert.strictEqual(getCapabilityFlags().x402PaidEndpointsAvailable, false, "unconfigured → false");
      assert.strictEqual(getCapabilityFlags().premiumEndpointsAvailable, false, "unconfigured → false");

      process.env.X402_PAY_TO = PAY_TO;
      assert.strictEqual(getCapabilityFlags().x402PaidEndpointsAvailable, false, "receiver alone is not enough");

      process.env.X402_FACILITATOR_URL = "https://facilitator.example";
      assert.strictEqual(getCapabilityFlags().x402PaidEndpointsAvailable, true, "zero-custody URL config → true");
      assert.strictEqual(getCapabilityFlags().premiumEndpointsAvailable, true, "zero-custody URL config → true");

      delete process.env.X402_FACILITATOR_URL;
      process.env.X402_FACILITATOR_PRIVATE_KEY = "0x" + "11".repeat(32);
      assert.strictEqual(getCapabilityFlags().x402PaidEndpointsAvailable, true, "local-facilitator (dev) config → true");
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it("refuses a local facilitator key in production without the explicit override", () => {
    const env = {
      NODE_ENV: "production",
      WALLET_MODE: "none",
      WRITE_TOOLS_ENABLED: "false",
      X402_PAY_TO: PAY_TO,
      X402_FACILITATOR_PRIVATE_KEY: "0x" + "11".repeat(32),
      SAFEHANDS_STATE_DIR: "/data",
      CORS_ORIGIN: "https://safehands.example",
    } as NodeJS.ProcessEnv;
    assert.ok(
      evaluateProductionPosture(env).some((i) => i.level === "fatal" && i.code === "LOCAL_FACILITATOR_KEY_IN_PRODUCTION"),
      "local facilitator key must be fatal in production",
    );
    assert.ok(
      !evaluateProductionPosture({ ...env, SAFEHANDS_ALLOW_LOCAL_FACILITATOR: "true" }).some((i) => i.level === "fatal"),
      "explicit SAFEHANDS_ALLOW_LOCAL_FACILITATOR=true opt-in must clear the fatal",
    );
  });
});
