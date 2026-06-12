// ─── Compile & Deploy RiskRegistry ─────────────────────────────────────
// Compiles the Solidity contract with solc and deploys to Pharos Atlantic.
// ────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import solc from "solc";
import { createPharosWalletClient, publicClient } from "../lib/pharosClient.js";
// ─── Load .env ─────────────────────────────────────────────────────────
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
const PRIVATE_KEY = env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not found in .env");
    process.exit(1);
}
// ─── Compile ───────────────────────────────────────────────────────────
console.log("📝 Compiling RiskRegistry.sol...");
const contractPath = resolve(process.cwd(), "contracts", "RiskRegistry.sol");
const source = readFileSync(contractPath, "utf-8");
const input = JSON.stringify({
    language: "Solidity",
    sources: {
        "RiskRegistry.sol": { content: source },
    },
    settings: {
        outputSelection: {
            "*": {
                "*": ["abi", "evm.bytecode.object"],
            },
        },
        optimizer: { enabled: true, runs: 200 },
    },
});
const output = JSON.parse(solc.compile(input));
if (output.errors) {
    const errors = output.errors.filter((e) => e.severity === "error");
    if (errors.length > 0) {
        console.error("❌ Compilation errors:");
        errors.forEach((e) => console.error(e.formattedMessage));
        process.exit(1);
    }
}
const contract = output.contracts["RiskRegistry.sol"]["RiskRegistry"];
const abi = contract.abi;
const bytecode = `0x${contract.evm.bytecode.object}`;
console.log("✅ Compiled successfully");
console.log(`   ABI: ${abi.length} functions/events`);
console.log(`   Bytecode: ${bytecode.length} chars`);
// Save ABI for reference
const artifactPath = resolve(process.cwd(), "contracts", "RiskRegistry.json");
writeFileSync(artifactPath, JSON.stringify({ abi, bytecode }, null, 2));
console.log(`   Artifact saved: contracts/RiskRegistry.json`);
// ─── Deploy ────────────────────────────────────────────────────────────
console.log("\n🚀 Deploying to Pharos Atlantic Testnet...");
const wallet = createPharosWalletClient(PRIVATE_KEY);
const account = wallet.account;
console.log(`   Deployer: ${account.address}`);
const balance = await publicClient.getBalance({ address: account.address });
console.log(`   Balance:  ${Number(balance) / 1e18} PHRS`);
// Deploy using viem
const hash = await wallet.deployContract({
    abi,
    bytecode,
    args: [],
});
console.log(`   TX Hash:  ${hash}`);
console.log("   Waiting for confirmation...");
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") {
    console.error("❌ Deployment failed!");
    process.exit(1);
}
const contractAddress = receipt.contractAddress;
console.log(`\n✅ RiskRegistry deployed successfully!`);
console.log(`   Contract: ${contractAddress}`);
console.log(`   Block:    ${receipt.blockNumber}`);
console.log(`   Gas Used: ${receipt.gasUsed}`);
console.log(`   Explorer: https://atlantic.pharosscan.xyz/tx/${hash}`);
// ─── Update .env ───────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env");
let envContent = readFileSync(envPath, "utf-8");
// Remove old entry if exists
envContent = envContent.replace(/\nRISK_REGISTRY_ADDRESS=.*/, "");
envContent = envContent.trimEnd() + `\n\n# Risk Registry\nRISK_REGISTRY_ADDRESS=${contractAddress}\n`;
writeFileSync(envPath, envContent);
console.log(`\n📝 Updated .env with RISK_REGISTRY_ADDRESS=${contractAddress}`);
//# sourceMappingURL=deployRegistry.js.map