// ─── SafeHands — Non-destructive smoke test for tool handlers ───────────
// This script intentionally avoids broadcasting transactions. It checks that
// tool handlers can be invoked safely and return predictable AI-readable data
// or structured failures when external services/env vars are unavailable.
// ────────────────────────────────────────────────────────────────────────

import express from "express";
import type { Server } from "node:http";

import { handleAssessRisk } from "../tools/assessRisk.js";
import { handleExecuteSwap } from "../tools/executeSwap.js";
import { handleSendPayment } from "../tools/sendPayment.js";
import { handleSimulateTransaction } from "../tools/simulateTransaction.js";
import { handleGetExecutionHistory } from "../tools/getExecutionHistory.js";
import { handleGetTokenPrice } from "../tools/getTokenPrice.js";
import { handleGetWalletBalance } from "../tools/getWalletBalance.js";
import { handleCheckAllowance } from "../tools/checkAllowance.js";
import { handleGetTransactionStatus } from "../tools/getTransactionStatus.js";
import { handleEstimateGas } from "../tools/estimateGas.js";
import { handlePublishRiskScore } from "../tools/publishRiskScore.js";
import { handleQueryRiskRegistry } from "../tools/queryRiskRegistry.js";
import { handleApproveToken } from "../tools/approveToken.js";
import { handleGetGasPrice } from "../tools/getGasPrice.js";
import { handleGetPoolInfo } from "../tools/getPoolInfo.js";
import { handleCheckTokenSecurity } from "../tools/checkTokenSecurity.js";
import { handleX402PayAndFetch } from "../tools/x402PayAndFetch.js";
import { fail, ok, type ToolResponse } from "./toolResponse.js";
import { handleSafeHandsPreflightCheck } from "../tools/safehandsPreflightCheck.js";
import { handleSafeHandsX402Preflight } from "../tools/safehandsX402Preflight.js";
import { handleSafeHandsWalletHealth } from "../tools/safehandsWalletHealth.js";
import { handleSafeHandsRiskReport } from "../tools/safehandsRiskReport.js";
import { handleExplainRisk } from "../tools/explainRisk.js";
import { handleTokenRegistryStatus } from "../tools/tokenRegistryStatus.js";
import { handleCreateAgentWallet } from "../tools/createAgentWallet.js";
import { handleGetAgentWallet } from "../tools/getAgentWallet.js";
import { getSigner, isSignerFailure } from "./signer/index.js";
import { USDC_ADDRESS } from "./constants.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const WALLET = process.env.WALLET_ADDRESS || "0x0000000000000000000000000000000000000001";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const TEST_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";

type Row = { tool: string; status: "PASS" | "FAIL"; note: string };
const rows: Row[] = [];

function isStructured(value: unknown): value is ToolResponse<unknown> {
  return !!value && typeof value === "object" && "success" in value && "error" in value && "timestamp" in value;
}

function normalize(value: unknown): ToolResponse<unknown> {
  if (isStructured(value)) return value;
  return ok(value);
}


function readAllToolSourceFiles(): Array<{ path: string; content: string }> {
  const root = join(process.cwd(), "src", "tools");
  const out: Array<{ path: string; content: string }> = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const rel = full.replace(process.cwd(), "").replace(/^[\\/]/, "").replace(/\\/g, "/");
        out.push({ path: rel, content: readFileSync(full, "utf8") });
      }
    }
  }
  walk(root);
  return out;
}


function runBuiltCli(args: string[]): ToolResponse<unknown> {
  const entry = join(process.cwd(), "dist", "index.js");
  if (!existsSync(entry)) return fail("CLI_DIST_MISSING", "Run npm run build before CLI smoke tests.", false, "cli_smoke");
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, WALLET_MODE: "none", WRITE_TOOLS_ENABLED: "false", PRIVATE_KEY: "" },
    encoding: "utf8",
  });
  const stdout = result.stdout.trim();
  try {
    return JSON.parse(stdout) as ToolResponse<unknown>;
  } catch {
    return fail("CLI_INVALID_STDOUT", `exit=${result.status} stdout=${stdout.slice(0, 240)} stderr=${result.stderr.slice(0, 240)}`, false, "cli_smoke");
  }
}

function runBuiltCliRaw(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const entry = join(process.cwd(), "dist", "index.js");
  if (!existsSync(entry)) return { status: 127, stdout: "", stderr: "dist/index.js missing" };
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, WALLET_MODE: "none", WRITE_TOOLS_ENABLED: "false", PRIVATE_KEY: "", X402_SIGNER_PRIVATE_KEY: "" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runNpmPackDryRun(): ToolResponse<unknown> {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    shell: true,
  });
  if (result.status !== 0 || result.error) return fail("NPM_PACK_DRY_RUN_FAILED", result.error?.message || result.stderr || result.stdout, false, "npm_pack");
  try {
    const parsed = JSON.parse(result.stdout.trim());
    const files = (parsed[0]?.files || []).map((f: { path: string }) => f.path);
    const unsafeExact = new Set([".env", ".env.local", "wallet-store.json"]);
    const unsafe = files.filter((file: string) =>
      unsafeExact.has(file) ||
      file.endsWith(".pem") ||
      file.endsWith(".key") ||
      file.includes("node_modules/") ||
      file.startsWith("logs/") ||
      file.endsWith(".log")
    );
    return unsafe.length ? fail("NPM_PACK_UNSAFE_FILES", unsafe.join(", "), false, "npm_pack") : ok({ totalFiles: files.length, unsafe, includesEnvExample: files.includes(".env.example") });
  } catch (err) {
    return fail("NPM_PACK_PARSE_FAILED", err instanceof Error ? err.message : String(err), false, "npm_pack");
  }
}

function hasAll(text: string, parts: string[]): boolean {
  return parts.every((part) => text.includes(part));
}

function summarize(value: ToolResponse<unknown>): string {
  if (!value.success) return `${value.error.code}: ${value.error.message}`;
  if (value.data && typeof value.data === "object") {
    const keys = Object.keys(value.data as Record<string, unknown>).slice(0, 6).join(", ");
    return `success data keys: ${keys || "none"}`;
  }
  return "success";
}

async function record(tool: string, fn: () => Promise<unknown>, expect?: (res: ToolResponse<unknown>) => boolean) {
  try {
    const result = normalize(await fn());
    const passed = expect ? expect(result) : true;
    rows.push({ tool, status: passed ? "PASS" : "FAIL", note: summarize(result) });
  } catch (err) {
    const result = fail("SMOKE_TEST_HANDLER_THROW", err instanceof Error ? err.message : String(err), false, tool);
    const passed = expect ? expect(result) : false;
    rows.push({
      tool,
      status: passed ? "PASS" : "FAIL",
      note: summarize(result),
    });
  }
}

async function withLocalServer<T>(handler: (url: string) => Promise<T>): Promise<T> {
  const app = express();
  app.get("/supported", (_req, res) => {
    res.json({ ok: true, kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:688689" }] });
  });

  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to open local test server");
    return await handler(`http://127.0.0.1:${address.port}/supported`);
  } finally {
    if ("closeAllConnections" in server) (server as any).closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function run() {
  console.log("\n🛡️  SafeHands — non-destructive tool smoke test");
  console.log(`Wallet used for dry/smoke checks: ${WALLET}`);

  await record("assess_risk_validation", () =>
    handleAssessRisk({ action: "swap", amount: "0.001", walletAddress: WALLET }),
    (res) => !res.success && res.error.code === "SMOKE_TEST_HANDLER_THROW"
  );

  await record("simulate_transaction_validation", () =>
    handleSimulateTransaction({ action: "transfer", amount: "0.001", walletAddress: WALLET })
  );

  await record("get_token_price_public_mode", () => handleGetTokenPrice({ token: "PHRS" }),
    (res) =>
      (res.success && typeof res.data === "object" && res.data !== null && "publicMode" in res.data) ||
      (!res.success && ["DODO_API_AUTH_REQUIRED", "DODO_API_UNAVAILABLE", "DODO_API_TIMEOUT", "DODO_API_RATE_LIMITED"].includes(res.error.code))
  );
  await record("get_wallet_balance_invalid_wallet", () => handleGetWalletBalance({ walletAddress: "not-an-address" }),
    (res) => !res.success && res.error.code === "INVALID_WALLET_ADDRESS"
  );
  await record("estimate_gas_invalid_wallet", () =>
    handleEstimateGas({ walletAddress: "not-an-address", action: "transfer", amount: "0.001", toAddress: RECIPIENT }),
    (res) => !res.success && res.error.code === "INVALID_WALLET_ADDRESS"
  );
  await record("check_token_security_invalid_address", () =>
    handleCheckTokenSecurity({ tokenAddress: "not-an-address" }),
    (res) => !res.success && res.error.code === "INVALID_TOKEN_ADDRESS"
  );

  await record("execute_swap_guard", () =>
    handleExecuteSwap({ tokenIn: "PHRS", tokenOut: "USDC", amountIn: "0.001" }),
    (res) => !res.success && res.error.code === "WRITE_TOOLS_DISABLED"
  );
  await record("send_payment_guard", () =>
    handleSendPayment({ toAddress: RECIPIENT, amount: "0.001" }),
    (res) => !res.success && res.error.code === "WRITE_TOOLS_DISABLED"
  );
  await record("approve_token_guard", () =>
    handleApproveToken({ token: "USDC", amount: "max" }),
    (res) => !res.success && res.error.code === "WRITE_TOOLS_DISABLED"
  );
  await record("publish_risk_score_guard", () =>
    handlePublishRiskScore({ action: "transfer", amount: "0.001", toAddress: RECIPIENT }),
    (res) => !res.success && res.error.code === "WRITE_TOOLS_DISABLED"
  );

  await record("x402_ssrf_block", () =>
    handleX402PayAndFetch({ url: "http://127.0.0.1:4021/supported" }),
    (res) => !res.success && res.error.code === "SSRF_BLOCKED"
  );

  await record("x402_free_local_allowed", async () =>
    withLocalServer(async (url) => {
      const previous = process.env.ALLOW_LOCAL_X402_FETCH;
      process.env.ALLOW_LOCAL_X402_FETCH = "true";
      try {
        return await handleX402PayAndFetch({ url });
      } finally {
        if (previous === undefined) delete process.env.ALLOW_LOCAL_X402_FETCH;
        else process.env.ALLOW_LOCAL_X402_FETCH = previous;
      }
    }),
    (res) => res.success === true && (res.data as { paymentExecuted?: boolean }).paymentExecuted === false
  );


  await record("safehands_preflight_allow", () =>
    handleSafeHandsPreflightCheck({ actionType: "send_payment", amount: "0.001", recipient: RECIPIENT, chainId: 688689, isMainnet: false }),
    (res) => res.success && (res.data as any).decision !== "BLOCK"
  );

  await record("safehands_preflight_block_mainnet", () =>
    handleSafeHandsPreflightCheck({ actionType: "send_payment", amount: "0.001", recipient: RECIPIENT, chainId: 1, isMainnet: true }),
    (res) => res.success && (res.data as any).decision === "BLOCK" && (res.data as any).riskLevel !== "LOW"
  );

  await record("safehands_preflight_block_unlimited_approval", () =>
    handleSafeHandsPreflightCheck({ actionType: "approve_token", approvalAmount: "max", spender: RECIPIENT }),
    (res) => res.success && (res.data as any).decision === "BLOCK"
  );

  await record("token_registry_status_canonical_usdc", () =>
    handleTokenRegistryStatus({ token: USDC_ADDRESS }),
    (res) => res.success && (res.data as any).status === "SKILL_ENGINE_CANONICAL_TOKEN" && (res.data as any).verificationStatus === "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE"
  );

  await record("token_registry_status_custom_token", () =>
    handleTokenRegistryStatus({ token: RECIPIENT }),
    (res) => res.success && (res.data as any).status === "CUSTOM_NON_REGISTRY"
  );

  await record("token_registry_status_invalid", () =>
    handleTokenRegistryStatus({ token: "not-an-address" }),
    (res) => res.success && (res.data as any).status === "INVALID_ADDRESS"
  );

  await record("safehands_x402_preflight_ssrf", () =>
    handleSafeHandsX402Preflight({ url: "http://127.0.0.1:4021/supported" }),
    (res) => !res.success && res.error.code === "SSRF_BLOCKED"
  );

  await record("safehands_wallet_health_no_wallet", () =>
    handleSafeHandsWalletHealth({}),
    (res) => res.success && ["NOT_READY", "DEGRADED"].includes(String((res.data as any).status))
  );

  await record("safehands_risk_report", () =>
    handleSafeHandsRiskReport({ actionType: "approve_token", approvalAmount: "max", spender: RECIPIENT }),
    (res) => res.success && typeof (res.data as any).summary === "string" && (res.data as any).decision === "BLOCK"
  );

  await record("explain_risk", () =>
    handleExplainRisk({ decision: "BLOCK", riskLevel: "HIGH", reasons: ["Unlimited approval requested"], requiredActions: ["Use limited approval"] }),
    (res) => res.success && String((res.data as any).explanation).includes("blocked")
  );

  await record("managed_wallet_signer_deobfuscates", async () => {
    const prevMode = process.env.WALLET_MODE;
    const prevKey = process.env.WALLET_ENCRYPTION_KEY;
    process.env.WALLET_MODE = "managed-testnet";
    process.env.WALLET_ENCRYPTION_KEY = "test-only-key-for-smoke";
    try {
      const created = await handleCreateAgentWallet({ agentId: "smoke-agent", overwrite: true });
      if (!created.success) return created;
      const signer = await getSigner("smoke-agent");
      if (isSignerFailure(signer)) return fail(signer.error.code, signer.error.message, false, "managed_wallet_signer");
      return ok({ address: signer.address, mode: signer.mode });
    } finally {
      if (prevMode === undefined) delete process.env.WALLET_MODE; else process.env.WALLET_MODE = prevMode;
      if (prevKey === undefined) delete process.env.WALLET_ENCRYPTION_KEY; else process.env.WALLET_ENCRYPTION_KEY = prevKey;
    }
  },
    (res) => res.success && (res.data as any).mode === "managed-testnet"
  );

  await record("private_key_never_returned_in_wallet_response", async () => {
    const prevMode = process.env.WALLET_MODE;
    const prevKey = process.env.WALLET_ENCRYPTION_KEY;
    process.env.WALLET_MODE = "managed-testnet";
    process.env.WALLET_ENCRYPTION_KEY = "test-only-key-for-smoke";
    try {
      const created = await handleCreateAgentWallet({ agentId: "smoke-agent-no-key", overwrite: true });
      const wallet = await handleGetAgentWallet({ agentId: "smoke-agent-no-key" });
      return ok({ created, wallet, serialized: JSON.stringify({ created, wallet }) });
    } finally {
      if (prevMode === undefined) delete process.env.WALLET_MODE; else process.env.WALLET_MODE = prevMode;
      if (prevKey === undefined) delete process.env.WALLET_ENCRYPTION_KEY; else process.env.WALLET_ENCRYPTION_KEY = prevKey;
    }
  },
    (res) => res.success && !String((res.data as any).serialized).toLowerCase().includes("privatekey") && !String((res.data as any).serialized).toLowerCase().includes("encryptedkey")
  );

  await record("write_tools_use_signer_provider", async () => {
    const offenders = readAllToolSourceFiles()
      .filter((f) => /process\.env\.PRIVATE_KEY/.test(f.content) && !f.path.endsWith("x402Server.ts"))
      .map((f) => f.path);
    return offenders.length ? fail("PRIVATE_KEY_DIRECT_USAGE", offenders.join(", "), false, "source_scan") : ok({ offenders });
  },
    (res) => res.success
  );

  await record("no_private_key_usage_outside_signer_provider", async () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const rel = full.replace(process.cwd(), "").replace(/^[\\/]/, "").replace(/\\/g, "/");
          if (rel.startsWith("src/lib/signer/")) continue;
          const content = readFileSync(full, "utf8");
          if (/process\.env\.PRIVATE_KEY/.test(content)) offenders.push(rel);
        }
      }
    }
    walk(root);
    return offenders.length ? fail("PRIVATE_KEY_DIRECT_USAGE", offenders.join(", "), false, "source_scan") : ok({ offenders });
  },
    (res) => res.success
  );


  await record("skill_cli_preflight_valid_json", async () =>
    runBuiltCli(["skill", "safehands_preflight_check", "--input-json", JSON.stringify({ actionType: "send_payment", chainId: 688689, isMainnet: false, amount: "0.001", recipient: RECIPIENT })]),
    (res) => res.success && (res.data as any).decision !== undefined && (res.data as any).chainId === 688689
  );

  await record("skill_cli_invalid_json_structured_error", async () =>
    runBuiltCli(["skill", "safehands_preflight_check", "--input-json", "{not-json"]),
    (res) => !res.success && res.error.code === "INVALID_INPUT_JSON" && res.error.source === "safehands_cli"
  );

  await record("skill_cli_readonly_without_private_key", async () =>
    runBuiltCli(["skill", "token_registry_status", "--input-json", JSON.stringify({ token: USDC_ADDRESS })]),
    (res) => res.success && (res.data as any).status === "SKILL_ENGINE_CANONICAL_TOKEN"
  );

  await record("skill_engine_example_files_exist", async () => {
    const files = [
      "examples/pharos-skill-engine/SKILL.safehands.md",
      "examples/pharos-skill-engine/references/safehands.md",
      "examples/pharos-skill-engine/assets/safehands/policy-defaults.json",
      "examples/pharos-skill-engine/assets/safehands/example-actions.json",
    ];
    const missing = files.filter((file) => !existsSync(join(process.cwd(), file)));
    return missing.length ? fail("SKILL_ENGINE_FILES_MISSING", missing.join(", "), false, "skill_engine_examples") : ok({ files });
  },
    (res) => res.success
  );

  await record("skill_engine_reference_required_sections", async () => {
    const text = readFileSync(join(process.cwd(), "examples/pharos-skill-engine/references/safehands.md"), "utf8");
    const required = [
      "## Overview",
      "## Command Template",
      "## SafeHands Preflight Check",
      "## SafeHands x402 Preflight",
      "## SafeHands Wallet Health",
      "## Token Registry Status",
      "## Explain Risk",
      "## SafeHands Risk Report",
      "### Error Handling",
      "### Agent Guidelines",
    ];
    return hasAll(text, required) ? ok({ required }) : fail("SKILL_ENGINE_REFERENCE_INCOMPLETE", "Missing one or more required reference sections.", false, "skill_engine_examples");
  },
    (res) => res.success
  );

  await record("skill_engine_skill_capability_rows", async () => {
    const text = readFileSync(join(process.cwd(), "examples/pharos-skill-engine/SKILL.safehands.md"), "utf8");
    const required = [
      "SafeHands Preflight Check",
      "SafeHands x402 Preflight",
      "SafeHands Wallet Health",
      "Token Registry Status",
      "Explain Risk",
      "SafeHands Risk Report",
      "references/safehands.md#safehands-preflight-check",
    ];
    return hasAll(text, required) ? ok({ required }) : fail("SKILL_ENGINE_CAPABILITY_ROWS_MISSING", "SKILL.safehands.md is missing required capability rows.", false, "skill_engine_examples");
  },
    (res) => res.success
  );

  // ── New: skill/ package structure tests ─────────────────────────────

  await record("skill_package_skill_md_exists", async () => {
    const path = join(process.cwd(), "skill/SKILL.md");
    return existsSync(path) ? ok({ file: "skill/SKILL.md" }) : fail("SKILL_PACKAGE_MISSING", "skill/SKILL.md not found", false, "skill_package");
  },
    (res) => res.success
  );

  await record("skill_package_yaml_frontmatter", async () => {
    const text = readFileSync(join(process.cwd(), "skill/SKILL.md"), "utf8");
    const hasYaml = text.startsWith("---") && text.includes("name: safehands-pharos-guard");
    return hasYaml ? ok({ frontmatter: true }) : fail("SKILL_PACKAGE_NO_FRONTMATTER", "YAML frontmatter missing or name mismatch", false, "skill_package");
  },
    (res) => res.success
  );

  await record("skill_package_references_exist", async () => {
    const path = join(process.cwd(), "skill/references/safehands.md");
    return existsSync(path) ? ok({ file: "skill/references/safehands.md" }) : fail("SKILL_PACKAGE_REF_MISSING", "skill/references/safehands.md not found", false, "skill_package");
  },
    (res) => res.success
  );

  await record("skill_package_assets_exist", async () => {
    const files = [
      "skill/assets/safehands/policy-defaults.json",
      "skill/assets/safehands/example-actions.json",
    ];
    const missing = files.filter((f) => !existsSync(join(process.cwd(), f)));
    return missing.length === 0 ? ok({ files }) : fail("SKILL_PACKAGE_ASSETS_MISSING", missing.join(", "), false, "skill_package");
  },
    (res) => res.success
  );

  await record("skill_package_example_uses_skill_engine_usdc", async () => {
    const text = readFileSync(join(process.cwd(), "skill/assets/safehands/example-actions.json"), "utf8");
    const usesSkillEngineUsdc = text.includes("0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8");
    const usesCircleUsdc = text.includes("0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B");
    return usesSkillEngineUsdc && !usesCircleUsdc
      ? ok({ correctUsdc: true })
      : fail("SKILL_EXAMPLE_WRONG_USDC", "example-actions.json should use Skill Engine USDC (0xE0BE...), not Circle USDC (0xcfC8...)", false, "skill_package");
  },
    (res) => res.success
  );

  await record("token_registry_circle_usdc_alternate", () =>
    handleTokenRegistryStatus({ token: "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B" }),
    (res) => res.success && (res.data as any).status === "ALTERNATE_SOURCE_TOKEN" && (res.data as any).verificationStatus === "CIRCLE_REFERENCED_USDC"
  );

  await record("cli_help_works", async () => {
    const raw = runBuiltCliRaw(["--help"]);
    return raw.status === 0 && raw.stdout.includes("Transaction Safety Firewall") && raw.stdout.includes("safehands_preflight_check")
      ? ok({ stdoutBytes: raw.stdout.length })
      : fail("CLI_HELP_FAILED", `status=${raw.status} stdout=${raw.stdout.slice(0, 200)} stderr=${raw.stderr.slice(0, 200)}`, false, "cli_help");
  },
    (res) => res.success
  );

  await record("demo_runs_or_fails_gracefully", async () => {
    const raw = runBuiltCliRaw(["--demo"]);
    return raw.status === 0 && raw.stdout.includes("Demo Complete") && raw.stdout.includes("SSRF_BLOCKED")
      ? ok({ stdoutBytes: raw.stdout.length })
      : fail("DEMO_FAILED", `status=${raw.status} stdout=${raw.stdout.slice(0, 300)} stderr=${raw.stderr.slice(0, 300)}`, false, "demo");
  },
    (res) => res.success
  );

  await record("readme_contains_final_positioning", async () => {
    const text = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const required = [
      "# SafeHands-Pharos — Transaction Safety Firewall for AI Agents",
      "Pharos Skill Engine-compatible MCP package",
      "ALLOW",
      "WRITE_TOOLS_ENABLED=false",
      "safehands_preflight_check",
      "Known Limitations",
    ];
    return hasAll(text, required) ? ok({ required }) : fail("README_POSITIONING_INCOMPLETE", "Missing final positioning text.", false, "readme");
  },
    (res) => res.success
  );

  await record("env_example_safe_placeholders", async () => {
    const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const required = ["WALLET_MODE=none", "WRITE_TOOLS_ENABLED=false", "PRIVATE_KEY=", "MAX_X402_PAYMENT_USDC=0.01"];
    const hasFakeSecret = /PRIVATE_KEY=0x[0-9a-fA-F]{16,}/.test(text) || /WALLET_ENCRYPTION_KEY=.+\S/.test(text);
    return hasAll(text, required) && !hasFakeSecret ? ok({ required }) : fail("ENV_EXAMPLE_UNSAFE", "Missing safe defaults or contains secret-looking placeholders.", false, "env_example");
  },
    (res) => res.success
  );

  await record("npm_pack_excludes_secrets", async () => runNpmPackDryRun(),
    (res) => res.success && (res.data as any).unsafe.length === 0
  );

  console.log("\n#  Status  Tool                         Note");
  console.log("─".repeat(100));
  rows.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2, "0")} ${r.status.padEnd(6)} ${r.tool.padEnd(28)} ${r.note}`);
  });

  const failed = rows.filter((r) => r.status === "FAIL");
  console.log("─".repeat(100));
  console.log(`${rows.length - failed.length}/${rows.length} smoke checks passed.`);

  if (failed.length > 0) {
    console.error("\nFailed smoke checks:");
    for (const f of failed) console.error(`- ${f.tool}: ${f.note}`);
    process.exit(1);
  }
}

run().catch((err) => {
  const structured = fail("SMOKE_TEST_FAILED", err instanceof Error ? err.message : String(err), false, "testTools");
  console.error(JSON.stringify(structured, null, 2));
  process.exit(1);
});
