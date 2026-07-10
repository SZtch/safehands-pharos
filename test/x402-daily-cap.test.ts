// ─── B2 · x402 payments count toward the daily spend cap ───────────────────
// x402_pay_and_fetch must draw from the same per-wallet daily USD budget as
// send_payment / execute_swap — otherwise a looping agent could drain the
// wallet in per-call-cap increments. These tests use a temp spend-history file
// and a local HTTP server; no chain access and no real payment is ever signed
// (the cap fires BEFORE the paying fetch, and the mock server settles nothing).
//
// Env is set BEFORE the dynamic imports below: the spend store path and the
// signer key are resolved at module load.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { privateKeyToAccount } from "viem/accounts";

const SPEND_FILE = join(tmpdir(), `safehands-x402-spend-test-${process.pid}.json`);
// Well-known throwaway dev key (hardhat account #1) — never funded, never broadcast.
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const WALLET = privateKeyToAccount(TEST_KEY as `0x${string}`).address;

// Snapshot the env keys this file mutates; restored in the `after()` hook below
// so dynamic env readers stay clean if a runner ever shares one process across
// test files (module-load-time readers still need the per-file process model).
const MUTATED_ENV_KEYS = [
  "SAFEHANDS_SPEND_HISTORY_PATH",
  "WRITE_TOOLS_ENABLED",
  "ALLOW_LOCAL_X402_FETCH",
  "NODE_ENV",
  "X402_SIGNER_PRIVATE_KEY",
  "MAX_DAILY_SPEND_USD",
] as const;
const savedEnv = Object.fromEntries(MUTATED_ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.SAFEHANDS_SPEND_HISTORY_PATH = SPEND_FILE;
process.env.WRITE_TOOLS_ENABLED = "true";
// Loopback x402 targets are relaxed ONLY outside production with this flag.
process.env.ALLOW_LOCAL_X402_FETCH = "true";
delete process.env.NODE_ENV;
process.env.X402_SIGNER_PRIVATE_KEY = TEST_KEY;
process.env.MAX_DAILY_SPEND_USD = "10";

after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const { handleX402PayAndFetch } = await import("../src/tools/x402PayAndFetch.js");
const { recordSpend, checkDailyLimit, releaseReservation } = await import("../src/lib/spendAccumulator.js");

let server: Server;
let BASE = "";

before(async () => {
  server = http.createServer((req, res) => {
    if ((req.url ?? "").startsWith("/free")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // Paid resource: 402 with no parseable challenge — the tool must hit the
    // daily-cap reservation before any payment can settle, and the mock never
    // returns a PAYMENT-RESPONSE header, so no reservation may stick.
    res.statusCode = 402;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "payment required" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  rmSync(SPEND_FILE, { force: true });
});

describe("B2 · x402 daily spend cap", () => {
  it("blocks a 402 payment with DAILY_SPEND_LIMIT_EXCEEDED when the cap is exhausted", async () => {
    recordSpend(WALLET, 10); // exhaust today's budget
    try {
      const res = await handleX402PayAndFetch({ url: `${BASE}/paid`, confirm: true });
      assert.strictEqual(res.success, false);
      assert.strictEqual((res as { error: { code: string } }).error.code, "DAILY_SPEND_LIMIT_EXCEEDED");
    } finally {
      releaseReservation(WALLET, 10);
    }
  });

  it("releases the reservation when the payment does not settle", async () => {
    const before = checkDailyLimit(WALLET, 0).currentUsd;
    // The mock 402 server never completes a payment: whether the x402 client
    // errors out or returns the bare 402 without PAYMENT-RESPONSE, the
    // reserved budget must be returned either way.
    await handleX402PayAndFetch({ url: `${BASE}/paid`, confirm: true });
    const after = checkDailyLimit(WALLET, 0).currentUsd;
    assert.strictEqual(after, before, "unsettled x402 payment must not consume the daily budget");
  });

  it("does not touch the daily budget for a non-402 resource", async () => {
    const before = checkDailyLimit(WALLET, 0).currentUsd;
    const res = await handleX402PayAndFetch({ url: `${BASE}/free` });
    assert.strictEqual(res.success, true);
    assert.strictEqual((res as { data: { paymentExecuted: boolean } }).data.paymentExecuted, false);
    const after = checkDailyLimit(WALLET, 0).currentUsd;
    assert.strictEqual(after, before);
  });
});
