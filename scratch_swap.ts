import { handleSafeHandsSafeExecute } from "./src/tools/safehandsSafeExecute.js";

process.env.WALLET_MODE = "local";
process.env.PRIVATE_KEY = "0x7b68a15ec2b16b43245abd52dfe6ae7547e8493d38aae1c19a79ef6f78d1f775";
process.env.WRITE_TOOLS_ENABLED = "true";

async function main() {
  const result = await handleSafeHandsSafeExecute({
    path: "safe_execute_swap",
    execute: true,
    confirmExecution: true,
    action: {
      tokenIn: "PHRS",
      tokenOut: "USDC",
      amountIn: "0.001"
    }
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
