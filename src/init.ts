import * as readline from "readline/promises";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";

export async function runInit() {
  console.log("\n🛡️  Welcome to SafeHands-Pharos Setup Wizard\n");
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const envPath = resolve(process.cwd(), ".env");
  let existingEnv = "";
  if (existsSync(envPath)) {
    existingEnv = readFileSync(envPath, "utf-8");
  }

  const ansWrite = await rl.question("1. Do you want your AI Agent to execute write operations (Swap, Transfer, Approve)? (y/N): ");
  const enableWrite = ansWrite.trim().toLowerCase() === "y";

  let pk = "";
  if (enableWrite) {
    pk = await rl.question("2. Enter your Pharos Testnet Private Key (leave blank to auto-generate a managed agent wallet instead): ");
  }

  const ansBackup = await rl.question("3. Do you want to enable persistent local backups for auto-generated agent wallets? (y/N): ");
  const enableBackup = ansBackup.trim().toLowerCase() === "y";

  const dodoKey = await rl.question("4. (Optional) Enter your DODO API Key for live testnet routing (press Enter to skip): ");

  rl.close();

  // Build .env content
  let newEnv = "";
  
  newEnv += `WRITE_TOOLS_ENABLED=${enableWrite ? "true" : "false"}\n`;
  
  if (pk.trim()) {
    newEnv += `WALLET_MODE=env\n`;
    newEnv += `PRIVATE_KEY=${pk.trim()}\n`;
  } else if (enableWrite) {
    newEnv += `WALLET_MODE=managed-testnet\n`;
  } else {
    newEnv += `WALLET_MODE=none\n`;
  }

  if (enableBackup) {
    newEnv += `WALLET_STORE_PATH=./.agents/wallets.json\n`;
  }

  if (dodoKey.trim()) {
    newEnv += `DODO_API_KEY=${dodoKey.trim()}\n`;
  }

  // Preserve existing lines if they don't conflict (basic merge)
  const finalEnvLines = [];
  const generatedKeys = ["WRITE_TOOLS_ENABLED", "WALLET_MODE", "PRIVATE_KEY", "WALLET_STORE_PATH", "DODO_API_KEY"];
  
  if (existingEnv) {
    const lines = existingEnv.split("\n");
    for (const line of lines) {
      const key = line.split("=")[0];
      if (key && !generatedKeys.includes(key)) {
        finalEnvLines.push(line);
      }
    }
  }
  
  const finalContent = finalEnvLines.join("\n") + "\n" + newEnv;
  writeFileSync(envPath, finalContent.trim() + "\n");

  console.log("\n✅ Configuration saved to .env!");
  if (!pk.trim() && enableWrite) {
    console.log("   Since you enabled write tools without providing a Private Key,");
    console.log("   SafeHands will use 'managed-testnet' mode.");
    console.log("   Run 'npx safehands-pharos skill create_agent_wallet --input-json \"{}\"' to generate one.");
  }
  console.log("🚀 SafeHands is ready to protect your AI Agent!\n");
}
