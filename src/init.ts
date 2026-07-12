import * as readline from "readline/promises";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { randomBytes } from "crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptKey } from "./lib/wallet/index.js";

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
    pk = await rl.question("2. Enter your Pharos Mainnet Private Key (leave blank to auto-generate a managed agent wallet instead): ");
  }

  const ansBackup = await rl.question("3. Do you want to enable persistent local backups for auto-generated agent wallets? (y/N): ");
  const enableBackup = ansBackup.trim().toLowerCase() === "y";

  const dodoKey = await rl.question("4. (Optional) Enter your DODO API Key for live mainnet routing (press Enter to skip): ");
  const goldskyUrl = await rl.question("5. (Optional) Enter your Goldsky Subgraph URL for historical data (press Enter to skip): ");

  rl.close();

  // Build .env content
  let newEnv = "";
  
  newEnv += `WRITE_TOOLS_ENABLED=${enableWrite ? "true" : "false"}\n`;
  
  if (pk.trim()) {
    newEnv += `WALLET_MODE=env\n`;
    newEnv += `PRIVATE_KEY=${pk.trim()}\n`;
  } else if (enableWrite) {
    newEnv += `WALLET_MODE=managed-mainnet\n`;
  } else {
    newEnv += `WALLET_MODE=none\n`;
  }

  if (enableBackup) {
    newEnv += `WALLET_STORE_PATH=./.agents/wallets.json\n`;
  }

  if (dodoKey.trim()) {
    newEnv += `DODO_API_KEY=${dodoKey.trim()}\n`;
  }
  if (goldskyUrl.trim()) {
    newEnv += `GOLDSKY_SUBGRAPH_URL=${goldskyUrl.trim()}\n`;
  }
  
  // Inject canonical mainnet contract addresses
  newEnv += `SAFEHANDS_REGISTRY_ADDRESS=0x428e02bf85412e7242d991cd6725ec59e8b06c8d\n`;
  newEnv += `SAFEHANDS_ATTESTATION_ADDRESS=0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c\n`;

  // Preserve existing lines if they don't conflict (basic merge)
  const finalEnvLines = [];
  const generatedKeys = ["WRITE_TOOLS_ENABLED", "WALLET_MODE", "PRIVATE_KEY", "WALLET_STORE_PATH", "DODO_API_KEY", "GOLDSKY_SUBGRAPH_URL", "SAFEHANDS_REGISTRY_ADDRESS", "SAFEHANDS_ATTESTATION_ADDRESS"];
  
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
    // Auto-create wallet + encryption key + store path
    const storePath = resolve(process.cwd(), "./.agents/wallets.json");
    const keyPath = join(dirname(storePath), ".key");

    // Ensure .agents/ directory exists
    mkdirSync(dirname(storePath), { recursive: true });

    // Generate or load encryption key
    let encKey: string;
    if (existsSync(keyPath)) {
      encKey = readFileSync(keyPath, "utf-8").trim();
    } else {
      encKey = randomBytes(32).toString("hex");
      writeFileSync(keyPath, encKey, { mode: 0o600 });
    }

    // Auto-create wallet
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const encrypted = encryptKey(privateKey, encKey);

    const walletData: Record<string, unknown> = {};
    if (existsSync(storePath)) {
      try { Object.assign(walletData, JSON.parse(readFileSync(storePath, "utf-8"))); } catch {}
    }
    walletData["default"] = {
      agentId: "default",
      address: account.address,
      encryptedKey: encrypted,
      environment: "pacific-mainnet",
      chainId: 1672,
      isMainnet: true,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(storePath, JSON.stringify(walletData, null, 2), "utf-8");

    // Append auto-generated config to .env
    const appendLines = [
      `WALLET_STORE_PATH=./.agents/wallets.json`,
    ];
    const currentEnv = readFileSync(envPath, "utf-8");
    if (!currentEnv.includes("WALLET_STORE_PATH")) {
      writeFileSync(envPath, currentEnv.trimEnd() + "\n" + appendLines.join("\n") + "\n");
    }

    console.log("");
    console.log(`   🛡️  Agent wallet created automatically!`);
    console.log(`   Address: ${account.address}`);
    console.log("");
    console.log(`   Next step: fund your wallet with PROS on Mainnet for gas:`);
    console.log(`   (No faucet available on mainnet. Transfer PROS to your wallet address.)`);
    console.log("");
    console.log(`   Wallet is encrypted (AES-256-GCM) and stored at .agents/wallets.json`);
    console.log(`   Encryption key saved to .agents/.key; do not share or delete this file.`);
  } else if (pk.trim() && enableWrite) {
    console.log("   Wallet mode: env (using your private key)");
  }

  console.log("\n🚀 SafeHands is ready to protect your AI Agent!\n");
}
