#!/usr/bin/env node
/**
 * SafeHands Local Wallet Helper
 * 
 * This is an OPTIONAL, SELF-HOSTED local script for agent operators who choose
 * to run SafeHands locally with their own wallet.
 * 
 * WARNING: Use a dedicated test wallet, not your main wallet.
 * 
 * This script strictly uses the existing verified broadcast path. It does
 * NOT bypass the SafeHands read-only validation. SafeHands (the public server) 
 * NEVER signs and NEVER holds keys.
 */

import readline from "node:readline/promises";
import { privateKeyToAccount } from "viem/accounts";
import { handleWalletPrepare } from "../dist/api/walletPrepareRoutes.js";
import { handleBroadcastSigned } from "../dist/api/broadcastRoutes.js";

async function run() {
  if (process.env.SAFEHANDS_LOCAL_WALLET_HELPER_ENABLED !== "true") {
    console.error("❌ Local wallet helper is disabled.");
    console.error("   To enable this self-hosted script, set SAFEHANDS_LOCAL_WALLET_HELPER_ENABLED=true");
    process.exit(1);
  }

  const pk = process.env.SAFEHANDS_LOCAL_WALLET_PRIVATE_KEY;
  if (!pk) {
    console.error("❌ Missing SAFEHANDS_LOCAL_WALLET_PRIVATE_KEY.");
    console.error("   This script requires a local private key to sign the transaction offline.");
    console.error("   This key is NEVER sent to the SafeHands server or logged.");
    process.exit(1);
  }

  // Ensure pk is 0x prefixed for viem
  const formattedPk = pk.startsWith("0x") ? pk : `0x${pk}`;
  
  let account;
  try {
    account = privateKeyToAccount(formattedPk);
  } catch (err) {
    console.error("❌ Invalid private key format.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  console.log("=== SafeHands Local Wallet Helper ===");
  console.log(`Loaded local wallet: ${account.address}`);
  console.log("-------------------------------------");

  const to = await rl.question("Enter recipient address (0x...): ");
  const value = await rl.question("Enter value in wei (default 0): ") || "0";
  const data = await rl.question("Enter calldata hex (default 0x): ") || "0x";
  
  rl.close();

  console.log("\n[1] Calling /wallet/prepare...");
  const prepareRes = await handleWalletPrepare({
    to,
    value,
    data,
    userAddress: account.address,
    chainId: 1672
  });

  if (prepareRes.decision === "BLOCK") {
    console.error("❌ Action blocked by policy.", prepareRes);
    process.exit(1);
  }

  if (!prepareRes.walletRequest) {
    console.error("❌ No walletRequest returned.", prepareRes);
    process.exit(1);
  }

  if (prepareRes.walletRequest.from.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Signer mismatch! Wallet request from ${prepareRes.walletRequest.from} does not match local wallet ${account.address}`);
    process.exit(1);
  }

  console.log("✅ Transaction prepared. ID:", prepareRes.preparedTransactionId);
  
  if (prepareRes.decision === "REQUIRE_CONFIRMATION") {
    console.error("❌ Action requires confirmation. This helper intentionally does not support confirmation flows (fail-closed) — review the decision and use the SafeHands tools/API (confirm=true) directly instead.");
    process.exit(1);
  }

  console.log("\n[2] Signing transaction locally...");
  const signedTx = await account.signTransaction({
    to: prepareRes.walletRequest.to,
    data: prepareRes.walletRequest.data,
    value: BigInt(prepareRes.walletRequest.value),
    chainId: prepareRes.walletRequest.chainId,
    type: "legacy"
  });

  console.log("✅ Transaction signed. Submitting to /broadcast/signed...");

  try {
    const broadcastRes = await handleBroadcastSigned({
      preparedTransactionId: prepareRes.preparedTransactionId,
      preparedTransactionHash: prepareRes.preparedTransactionHash,
      rawSignedTransaction: signedTx
    });
    console.log("\n✅ Broadcast Success!");
    console.log(JSON.stringify(broadcastRes, null, 2));
  } catch (err) {
    console.error("\n❌ Broadcast Failed:");
    console.error(err.message);
  }
}

run().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
