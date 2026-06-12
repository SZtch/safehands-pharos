// ─── Quick test: RiskRegistry publish + query ──────────────────────────
import { readFileSync } from "fs";
import { resolve } from "path";
import { handleAssessRisk } from "../tools/assessRisk.js";
import { handleQueryRiskRegistry } from "../tools/queryRiskRegistry.js";
function loadEnv() {
    const envPath = resolve(process.cwd(), ".env");
    const envFile = readFileSync(envPath, "utf-8");
    const vars = {};
    for (const line of envFile.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1)
            continue;
        vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
    return vars;
}
const env = loadEnv();
async function main() {
    console.log("🧪 Testing RiskRegistry: assess + publish + query\n");
    // 1. assess_risk WITH privateKey → auto-publishes
    console.log("1️⃣  assess_risk with auto-publish...");
    const assessment = await handleAssessRisk({
        action: "swap",
        tokenIn: "PHRS",
        tokenOut: "USDC",
        amount: "1",
        walletAddress: env.WALLET_ADDRESS,
        privateKey: env.PRIVATE_KEY,
    });
    console.log(JSON.stringify(assessment, null, 2));
    // 2. query_risk_registry
    console.log("\n2️⃣  query_risk_registry...");
    const query = await handleQueryRiskRegistry({
        walletAddress: env.WALLET_ADDRESS,
    });
    console.log(JSON.stringify(query, null, 2));
    console.log("\n✅ RiskRegistry end-to-end test complete!");
}
main().catch(console.error);
//# sourceMappingURL=testRegistry.js.map