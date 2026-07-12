// ─── HTTP write-tool authentication gate ───────────────────────────────────
// Regression guard for the write-auth hardening fix: the HTTP tool gateway must never let a WRITE
// tool run on the open read origin. Read tools stay open; write tools + signed
// broadcast require a VALID API key. Hermetic: in-process app on an ephemeral
// port, no live RPC (write tools stop at auth / signer, never touching chain).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGuardianApp } from "../src/api/server.js";

type Started = { base: string; server: Server; restore: () => void };

async function startApp(env: Record<string, string>): Promise<Started> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k];
  }
  const app = createGuardianApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const restore = () => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return { base: `http://127.0.0.1:${port}`, server, restore };
}

async function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as any;
  return { status: res.status, json, res };
}

describe("HTTP write-tool auth gate", () => {
  describe("no API keys configured (open read origin)", () => {
    let app: Started;
    before(async () => { app = await startApp({ SAFEHANDS_API_KEYS: "", WRITE_TOOLS_ENABLED: "false" }); });
    after(() => { app.server.close(); app.restore(); });

    it("401s an unauthenticated WRITE tool (send_payment)", async () => {
      const { status, json } = await post(app.base, "/tools/send_payment", { amount: "1", recipient: "0x1111111111111111111111111111111111111111" });
      assert.strictEqual(status, 401);
      assert.strictEqual(json.error?.code, "API_KEY_REQUIRED_FOR_WRITE");
    });

    it("401s an unauthenticated signed broadcast", async () => {
      const { status, json } = await post(app.base, "/broadcast/signed", { rawTransaction: "0xdeadbeef" });
      assert.strictEqual(status, 401);
      assert.strictEqual(json.error?.code, "API_KEY_REQUIRED_FOR_WRITE");
    });

    it("does NOT block a READ tool (stays open)", async () => {
      const { status, json } = await post(app.base, "/tools/token_registry_status", { token: "PROS" });
      assert.notStrictEqual(status, 401);
      assert.notStrictEqual(json.error?.code, "API_KEY_REQUIRED_FOR_WRITE");
    });

    it("sets clickjacking / sniffing security headers", async () => {
      const res = await fetch(app.base + "/health");
      assert.strictEqual(res.headers.get("x-frame-options"), "DENY");
      assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    });
  });

  describe("API key configured + write tools enabled", () => {
    let app: Started;
    before(async () => { app = await startApp({ SAFEHANDS_API_KEYS: "secret-test-key", WRITE_TOOLS_ENABLED: "true" }); });
    after(() => { app.server.close(); app.restore(); });

    it("rejects a WRITE tool with an invalid key (401)", async () => {
      const { status } = await post(app.base, "/tools/send_payment", { amount: "1" }, { "x-api-key": "wrong-key" });
      assert.strictEqual(status, 401);
    });

    it("lets a WRITE tool PAST auth with a valid key (fails later on signer, not auth)", async () => {
      const { status, json } = await post(
        app.base,
        "/tools/send_payment",
        { amount: "1", recipient: "0x1111111111111111111111111111111111111111" },
        { "x-api-key": "secret-test-key" },
      );
      assert.notStrictEqual(status, 401);
      assert.notStrictEqual(json.error?.code, "API_KEY_REQUIRED_FOR_WRITE");
    });
  });
});
