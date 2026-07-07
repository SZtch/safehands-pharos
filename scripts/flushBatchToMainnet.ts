import { getPendingRecords, buildMerkleTree, clearPendingRecords } from "../src/lib/merkleBatcher.js";
import { SAFEHANDS_REGISTRY_ADDRESS, SAFEHANDS_REGISTRY_ABI } from "../src/lib/constants.js";
import { publicClient, createPharosWalletClientFromAccount } from "../src/lib/pharosClient.js";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import fs from "fs";
import path from "path";

try {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    content.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [k, ...rest] = trimmed.split("=");
        const v = rest.join("=").replace(/^['"]|['"]$/g, "");
        if (!process.env[k]) process.env[k] = v;
      }
    });
  }
} catch (e) {}

async function main() {
  const records = getPendingRecords();
  if (records.length === 0) {
    console.log("No pending records to batch.");
    return;
  }

  console.log(`Building Merkle Tree for ${records.length} records...`);
  const tree = buildMerkleTree(records);
  const root = tree.getHexRoot() as `0x${string}`;
  console.log(`Merkle Root: ${root}`);

  const operatorKey = process.env.PHAROS_DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!operatorKey) {
    throw new Error("Operator private key not found in environment.");
  }
  const account = privateKeyToAccount(operatorKey as `0x${string}`);
  const wallet = createPharosWalletClientFromAccount(account);

  const registryAddress = SAFEHANDS_REGISTRY_ADDRESS as `0x${string}`;
  if (!registryAddress) {
    throw new Error("SAFEHANDS_REGISTRY_ADDRESS not configured.");
  }

  // Write batch data to local storage for Data Availability (DA).
  // expiresAt is a BigInt, so serialize it with the same "<n>n" tagging the queue
  // uses — the read-path (normalizeRiskRecords) coerces it back. A plain
  // JSON.stringify would throw on BigInt and never produce the batch file.
  const batchData = JSON.stringify(records, (_k, v) => (typeof v === "bigint" ? v.toString() + "n" : v), 2);
  const dataHash = keccak256(new TextEncoder().encode(batchData));
  const batchFilename = `batch_${dataHash.slice(2)}.json`;
  const batchDir = path.join(process.cwd(), "public", "batches");
  if (!fs.existsSync(batchDir)) {
    fs.mkdirSync(batchDir, { recursive: true });
  }
  fs.writeFileSync(path.join(batchDir, batchFilename), batchData);

  // In a distributed setup this would be an IPFS CID. The Data Availability base
  // URL is operator-configured (no hardcoded domain): SAFEHANDS_DA_BASE_URL must
  // point to wherever the batch JSON written to ./public/batches is actually
  // served. Fail closed rather than commit a dead pointer on-chain.
  const daBaseUrl = (process.env.SAFEHANDS_DA_BASE_URL || "").replace(/\/+$/, "");
  if (!daBaseUrl) {
    throw new Error(
      "SAFEHANDS_DA_BASE_URL not configured. Set it to the public base URL that serves the batch JSON under ./public/batches — commitRiskRoot writes this data-availability pointer on-chain, so an unreachable URL would publish a dead reference."
    );
  }
  const ipfsURI = `${daBaseUrl}/${batchFilename}`;

  console.log(`Broadcasting commitRiskRoot to Pharos Mainnet...`);
  console.log(`Target Contract: ${registryAddress}`);
  console.log(`Operator Account: ${account.address}`);

  const txHash = await wallet.writeContract({
    address: registryAddress,
    abi: SAFEHANDS_REGISTRY_ABI,
    functionName: "commitRiskRoot",
    args: [root, ipfsURI],
  });

  console.log(`Transaction submitted: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  
  if (receipt.status === "success") {
    console.log(`Successfully committed L2 Batch to Mainnet (Gas Used: ${receipt.gasUsed})`);
    clearPendingRecords();
    console.log("Local pending queue cleared.");
  } else {
    console.error("Transaction reverted!");
  }
}

main().catch(console.error);
