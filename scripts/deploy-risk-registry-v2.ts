import { network } from "hardhat";
import type { Address } from "viem";

const EXPECTED_CHAIN_ID = 688689;

async function main() {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  if (chainId !== EXPECTED_CHAIN_ID) {
    console.error(`\n❌ Chain ID mismatch: expected ${EXPECTED_CHAIN_ID} (Pharos Atlantic Testnet), got ${chainId}`);
    console.error("   RiskRegistry V2 must only be deployed to Pharos Atlantic Testnet.");
    process.exit(1);
  }

  const [deployer] = await viem.getWalletClients();
  const deployerAddress = deployer.account.address;
  console.log(`\n🛡️  RiskRegistry V2 Deployment`);
  console.log(`   Network: Pharos Atlantic Testnet (chain ${chainId})`);
  console.log(`   Deployer: ${deployerAddress}`);

  const balance = await publicClient.getBalance({ address: deployerAddress });
  console.log(`   Balance: ${Number(balance) / 1e18} PHRS`);

  if (balance === 0n) {
    console.error("\n❌ Deployer has no PHRS. Fund at https://testnet.pharosnetwork.xyz/");
    process.exit(1);
  }

  console.log("\n   Deploying RiskRegistryV2...");
  const registry = await viem.deployContract("RiskRegistryV2");
  const contractAddress = registry.address as Address;
  console.log(`\n✅ RiskRegistry V2 deployed!`);
  console.log(`   Contract: ${contractAddress}`);
  console.log(`   Owner: ${deployerAddress}`);

  console.log("\n📋 Next steps (Phase 3):");
  console.log(`   1. Update RISK_REGISTRY_V2_ADDRESS in src/lib/constants.ts:`);
  console.log(`      export const RISK_REGISTRY_V2_ADDRESS = "${contractAddress}";`);
  console.log(`   2. Copy ABI from artifacts to contracts/RiskRegistryV2.json`);
  console.log(`   3. Update publish_risk_score and risk_report tools to use V2`);
  console.log(`   4. Add managed-wallet authorization checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
