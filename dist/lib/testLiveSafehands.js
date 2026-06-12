// ─── Live SafeHands CLI Verification ───────────────────────────────────
// Runs real CLI safety checks without broadcasting transactions.
// All checks are read-only or dry-run preflight checks.
// ────────────────────────────────────────────────────────────────────────
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
const results = [];
function runCli(args) {
    const entry = join(process.cwd(), "dist", "index.js");
    if (!existsSync(entry)) {
        console.error("❌ dist/index.js not found. Run: npm run build");
        process.exit(1);
    }
    const result = spawnSync(process.execPath, [entry, ...args], {
        cwd: process.cwd(),
        env: { ...process.env, WALLET_MODE: "none", WRITE_TOOLS_ENABLED: "false", PRIVATE_KEY: "" },
        encoding: "utf8",
        timeout: 30_000,
    });
    return { exitCode: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}
function parseJson(stdout) {
    try {
        return JSON.parse(stdout.trim());
    }
    catch {
        return null;
    }
}
function check(name, args, expected, validator) {
    const { stdout } = runCli(args);
    const json = parseJson(stdout);
    const passed = json !== null && validator(json);
    const actual = json !== null
        ? (json.success ? `success: ${JSON.stringify(json.data).slice(0, 120)}` : `error: ${json.error?.code}`)
        : `invalid JSON: ${stdout.slice(0, 100)}`;
    results.push({ name, status: passed ? "PASS" : "FAIL", expected, actual });
}
console.log("═══════════════════════════════════════════════════════════");
console.log("  SafeHands — Live CLI Verification (read-only)");
console.log("═══════════════════════════════════════════════════════════");
console.log("");
// 1. Wallet health — no wallet configured
check("wallet_health_no_wallet", ["skill", "safehands_wallet_health", "--input-json", "{}"], "valid JSON with status NOT_READY or DEGRADED", (json) => json.success && ["NOT_READY", "DEGRADED"].includes(json.data?.status));
// 2. Token registry — Pharos Skill Engine USDC (DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE)
check("token_registry_skill_engine_usdc", ["skill", "token_registry_status", "--input-json", JSON.stringify({ tokenAddress: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8" })], "SKILL_ENGINE_CANONICAL_TOKEN with DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE", (json) => json.success && json.data?.status === "SKILL_ENGINE_CANONICAL_TOKEN" && json.data?.verificationStatus === "DOCS_VERIFIED_FROM_PHAROS_SKILL_ENGINE");
// 3. Token registry — Circle USDC (ALTERNATE_SOURCE_TOKEN)
check("token_registry_circle_usdc", ["skill", "token_registry_status", "--input-json", JSON.stringify({ tokenAddress: "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B" })], "ALTERNATE_SOURCE_TOKEN with CIRCLE_REFERENCED_USDC", (json) => json.success && json.data?.status === "ALTERNATE_SOURCE_TOKEN" && json.data?.verificationStatus === "CIRCLE_REFERENCED_USDC");
// 4. Token registry — USDT (DOCS_VERIFIED)
check("token_registry_usdt_docs_verified", ["skill", "token_registry_status", "--input-json", JSON.stringify({ tokenAddress: "0xE7E84B8B4f39C507499c40B4ac199B050e2882d5" })], "CANONICAL_TESTNET_TOKEN with DOCS_VERIFIED", (json) => json.success && json.data?.status === "CANONICAL_TESTNET_TOKEN" && json.data?.verificationStatus === "DOCS_VERIFIED");
// 5. Preflight — unlimited approval → BLOCK
check("preflight_block_unlimited_approval", ["skill", "safehands_preflight_check", "--input-json", JSON.stringify({
        actionType: "approve_token",
        chainId: 688689,
        tokenAddress: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
        targetAddress: "0x0000000000000000000000000000000000000001",
        amount: "unlimited",
        approvalAmount: "max",
    })], "decision=BLOCK", (json) => json.success && json.data?.decision === "BLOCK");
// 6. Preflight — mainnet action → BLOCK
check("preflight_block_mainnet", ["skill", "safehands_preflight_check", "--input-json", JSON.stringify({
        actionType: "send_payment",
        chainId: 1,
        isMainnet: true,
        targetAddress: "0x0000000000000000000000000000000000000001",
        amount: "0.001",
    })], "decision=BLOCK", (json) => json.success && json.data?.decision === "BLOCK");
// 7. Preflight — safe testnet action → ALLOW or WARN (not BLOCK)
check("preflight_allow_testnet", ["skill", "safehands_preflight_check", "--input-json", JSON.stringify({
        actionType: "send_payment",
        chainId: 688689,
        isMainnet: false,
        amount: "0.001",
        recipient: "0x000000000000000000000000000000000000dEaD",
    })], "decision=ALLOW or WARN (not BLOCK)", (json) => json.success && json.data?.decision !== "BLOCK");
// Print results
console.log(`\n${"#".padStart(2)} ${"Status".padEnd(8)} ${"Check".padEnd(42)} Expected`);
console.log("─".repeat(100));
for (const [i, r] of results.entries()) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`${String(i + 1).padStart(2)} ${icon} ${r.status.padEnd(5)} ${r.name.padEnd(42)} ${r.expected}`);
}
const failed = results.filter(r => r.status === "FAIL");
console.log("─".repeat(100));
console.log(`${results.length - failed.length}/${results.length} live CLI checks passed.`);
if (failed.length > 0) {
    console.error("\nFailed checks:");
    for (const f of failed)
        console.error(`  - ${f.name}: got ${f.actual}`);
    process.exit(1);
}
//# sourceMappingURL=testLiveSafehands.js.map