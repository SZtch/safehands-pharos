// ─── SafeHands mainnet deploy script ───────────────────────────────────
// Deploys the two-contract on-chain layer to Pharos Pacific Mainnet (1672):
//   1. SafeHandsRegistry   — trust + reputation oracle (governed)
//   2. SafeHandsAttestation — immutable proof ledger (reads operator auth from Registry)
//
// Run (requires the deployer key in the keystore/env as PHAROS_DEPLOYER_PRIVATE_KEY):
//   npx hardhat run scripts/deploy-safehands.ts --network pharosPacific
//
// The script refuses to run on any chain other than 1672. The attester/operator
// defaults to the deployer; override with SAFEHANDS_ATTESTER_ADDRESS.
// ────────────────────────────────────────────────────────────────────────

import { network } from "hardhat";
import { formatEther } from "viem";

const PHAROS_PACIFIC_CHAIN_ID = 1672;

async function main() {
  // Connect to Pharos Pacific as an l1 chain so the viem helpers are available.
  const { viem } = await network.connect<"l1">("pharosPacific");
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();

  const chainId = await publicClient.getChainId();
  console.log(`Deployer:  ${deployer.account.address}`);
  console.log(`Chain ID:  ${chainId}`);

  if (chainId !== PHAROS_PACIFIC_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy: expected Pharos Pacific Mainnet (${PHAROS_PACIFIC_CHAIN_ID}), got ${chainId}. ` +
        `Run with --network pharosPacific.`,
    );
  }

  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`Balance:   ${formatEther(balance)} PROS`);
  if (balance === 0n) {
    throw new Error("Deployer has 0 PROS — fund the wallet before deploying.");
  }

  console.log("\nDeploying SafeHandsRegistry...");
  const registry = await viem.deployContract("SafeHandsRegistry");
  console.log(`  → SafeHandsRegistry:    ${registry.address}`);

  console.log("Deploying SafeHandsAttestation (linked to Registry)...");
  const attestation = await viem.deployContract("SafeHandsAttestation", [registry.address]);
  console.log(`  → SafeHandsAttestation: ${attestation.address}`);

  // Authorize the attester as an operator so it can write attestations + risk records.
  const attester = (process.env.SAFEHANDS_ATTESTER_ADDRESS ?? deployer.account.address) as `0x${string}`;
  console.log(`\nAuthorizing operator (attester): ${attester}`);
  const txHash = await registry.write.setOperator([attester, true]);
  console.log(`  → setOperator tx: ${txHash}`);

  console.log("\n✅ Deployment complete. Add these to your .env:\n");
  console.log(`SAFEHANDS_REGISTRY_ADDRESS=${registry.address}`);
  console.log(`SAFEHANDS_ATTESTATION_ADDRESS=${attestation.address}`);
  console.log(
    `\nVerify on PharosScan:\n` +
      `  https://www.pharosscan.xyz/address/${registry.address}\n` +
      `  https://www.pharosscan.xyz/address/${attestation.address}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
