// ─── Agent-policy path-traversal guard ─────────────────────────────────────
// agentId becomes a filename in saveAgentPolicy/loadAgentPolicy. This locks in
// the path-traversal hardening fix: a malicious agentId must NOT be able to escape the policies dir,
// and the write handler must reject it (VALIDATION_ERROR) before touching disk.
// Only the REJECTION path is exercised (no FS side effects).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import { isSafeAgentId } from "../src/lib/policy/agentPolicy.js";
import { handleSetAgentPolicy } from "../src/tools/setAgentPolicy.js";

describe("agentId path-traversal guard", () => {
  it("isSafeAgentId rejects traversal / separators, accepts normal ids", () => {
    for (const bad of ["../../etc/passwd", "..", "a/b", "a\\b", "..\\..", "x/../y"]) {
      assert.strictEqual(isSafeAgentId(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
    for (const good of ["agent_7UCLA5MLTGNE", "my-agent.1", "a:b_c-2"]) {
      assert.strictEqual(isSafeAgentId(good), true, `should accept ${JSON.stringify(good)}`);
    }
  });

  it("set_agent_policy rejects a path-traversal agentId with VALIDATION_ERROR", async () => {
    const r: any = await handleSetAgentPolicy({ agentId: "../../../../tmp/evil", profile: "balanced" });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, "VALIDATION_ERROR");
  });

  it("set_agent_policy rejects unknown/extra fields (.strict)", async () => {
    const r: any = await handleSetAgentPolicy({ agentId: "ok-agent", profile: "balanced", evil: true });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, "VALIDATION_ERROR");
  });
});
