// ─── Live RPC Verification ─────────────────────────────────────────────
// Real read-only test against Pharos Atlantic Testnet.
// Does NOT require a private key. Wallet balance check requires WALLET_ADDRESS.
// ────────────────────────────────────────────────────────────────────────
import { publicClient } from "./pharosClient.js";
import { CHAIN_ID, RPC_URL, PHAROS_ENVIRONMENT } from "./constants.js";
import { formatEther, isAddress } from "viem";
async function main() {
    const result = {
        rpcReachable: false,
        chainId: null,
        chainIdMatch: false,
        latestBlock: null,
        walletBalance: null,
        walletBalanceCheck: "SKIPPED_NO_WALLET_ADDRESS",
        status: "FAIL",
        rpcUrl: RPC_URL,
        environment: PHAROS_ENVIRONMENT,
        expectedChainId: CHAIN_ID,
        errors: [],
    };
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  SafeHands — Live RPC Verification (read-only)");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  RPC URL:      ${RPC_URL}`);
    console.log(`  Environment:  ${PHAROS_ENVIRONMENT}`);
    console.log(`  Expected ID:  ${CHAIN_ID}`);
    console.log("");
    // 1. Chain ID
    try {
        const chainId = await publicClient.getChainId();
        result.rpcReachable = true;
        result.chainId = chainId;
        result.chainIdMatch = chainId === CHAIN_ID;
        console.log(`  RPC reachable: ✅ yes`);
        console.log(`  Chain ID:      ${chainId} ${result.chainIdMatch ? "✅ match" : "❌ MISMATCH"}`);
    }
    catch (err) {
        result.errors.push(`RPC connect: ${err.message || String(err)}`);
        console.log(`  RPC reachable: ❌ no`);
        console.log(`  Error: ${err.message || String(err)}`);
        result.status = "SKIPPED_NETWORK";
        console.log(`\n  Status: ${result.status}`);
        console.log(JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
        process.exit(0);
    }
    // 2. Latest block
    try {
        const blockNumber = await publicClient.getBlockNumber();
        result.latestBlock = blockNumber;
        console.log(`  Latest block:  ${blockNumber}`);
    }
    catch (err) {
        result.errors.push(`Block number: ${err.message || String(err)}`);
        console.log(`  Latest block:  ❌ failed (${err.message})`);
    }
    // 3. Wallet balance
    const walletAddress = process.env.WALLET_ADDRESS;
    if (walletAddress && isAddress(walletAddress)) {
        try {
            const balance = await publicClient.getBalance({ address: walletAddress });
            result.walletBalance = formatEther(balance);
            result.walletBalanceCheck = "PASS";
            console.log(`  Wallet:        ${walletAddress}`);
            console.log(`  Balance:       ${result.walletBalance} PHRS ✅`);
        }
        catch (err) {
            result.walletBalanceCheck = "FAIL";
            result.errors.push(`Balance: ${err.message || String(err)}`);
            console.log(`  Balance check: ❌ failed (${err.message})`);
        }
    }
    else {
        console.log(`  Wallet check:  SKIPPED_NO_WALLET_ADDRESS`);
    }
    // Final status
    result.status = result.rpcReachable && result.chainIdMatch && result.latestBlock !== null ? "PASS" : "FAIL";
    console.log("");
    console.log(`  Status: ${result.status}`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log(JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
    if (result.status === "FAIL")
        process.exit(1);
}
main().catch((err) => {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
});
//# sourceMappingURL=testRpcLive.js.map