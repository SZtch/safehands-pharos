// Quick script to fetch the receipt for the deploy tx
import { publicClient } from "../lib/pharosClient.js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const TX_HASH = "0x7f2106b5bc8c5eddcd2ea7782669ccb0b4a107da4943cffd5d49357ab5820d2e";
async function main() {
    console.log("Fetching receipt for deploy tx...");
    console.log(`TX: ${TX_HASH}`);
    const receipt = await publicClient.getTransactionReceipt({ hash: TX_HASH });
    console.log(`Status:   ${receipt.status}`);
    console.log(`Contract: ${receipt.contractAddress}`);
    console.log(`Block:    ${receipt.blockNumber}`);
    console.log(`Gas Used: ${receipt.gasUsed}`);
    if (receipt.contractAddress) {
        // Update .env
        const envPath = resolve(process.cwd(), ".env");
        let envContent = readFileSync(envPath, "utf-8");
        envContent = envContent.replace(/\nRISK_REGISTRY_ADDRESS=.*/, "");
        envContent = envContent.trimEnd() + `\n\n# Risk Registry\nRISK_REGISTRY_ADDRESS=${receipt.contractAddress}\n`;
        writeFileSync(envPath, envContent);
        console.log(`\n✅ .env updated with RISK_REGISTRY_ADDRESS=${receipt.contractAddress}`);
    }
}
main().catch(console.error);
//# sourceMappingURL=checkDeploy.js.map