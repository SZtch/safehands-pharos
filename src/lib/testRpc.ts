// ─── RPC Connection Test ───────────────────────────────────────────────
// Quick smoke test: connects to Pharos Atlantic Testnet and verifies
// the chain ID matches 688689.
// ────────────────────────────────────────────────────────────────────────

import { publicClient } from "./pharosClient.js";
import { CHAIN_ID } from "./constants.js";

async function main() {
  console.log("🔌 Connecting to Pharos Atlantic Testnet...");
  console.log(`   RPC: https://atlantic.dplabs-internal.com/`);

  try {
    const chainId = await publicClient.getChainId();
    console.log(`   Chain ID returned: ${chainId}`);

    if (chainId === CHAIN_ID) {
      console.log(`✅ SUCCESS — Chain ID matches expected ${CHAIN_ID}`);
    } else {
      console.error(`❌ MISMATCH — Expected ${CHAIN_ID}, got ${chainId}`);
      process.exit(1);
    }

    const blockNumber = await publicClient.getBlockNumber();
    console.log(`   Latest block: ${blockNumber}`);

    console.log("\n🎉 Pharos RPC connection verified.");
  } catch (error) {
    console.error("❌ RPC connection failed:", error);
    process.exit(1);
  }
}

main();
