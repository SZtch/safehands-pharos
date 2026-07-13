// One-off, key-free helper to queue a single REAL risk record into the local
// Merkle batch pending file (public/batches). It runs the read-only risk engine
// and writes the record with queueRiskRecord; it never needs a signer or an
// operator key (that is only for scripts/flushBatchToMainnet.ts, which commits
// the root on-chain). Target is the agent/operator wallet, so a later
// `query <that address>` surfaces this record. Delete after use if not needed.
import { assessRisk } from "../src/lib/riskEngine.js";
import { queueRiskRecord } from "../src/lib/merkleBatcher.js";
import { deriveActionHash, riskLevelToEnum, recommendationToEnum } from "../src/lib/safeHandsRegistry.js";
import { CHAIN_ID } from "../src/lib/constants.js";
import { keccak256, stringToHex } from "viem";
import { createRequire } from "module";

const PKG_VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

async function main() {
  // The agent/operator wallet the reputation record is about (registry owner).
  const walletAddress = "0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5";
  const action = "swap" as const;
  const tokenIn = "0xc879c018db60520f4355c26ed1a6d572cdac1815";  // USDC (Circle-deployed)
  const tokenOut = "0x52c48d4213107b20bc583832b0d951fb9ca8f0b0"; // WPROS
  const amount = "1";

  const assessment = await assessRisk({ action, tokenIn, tokenOut, amount, walletAddress });
  const actionHash = deriveActionHash(CHAIN_ID, action, walletAddress, { tokenIn, tokenOut, amount });

  queueRiskRecord({
    target: walletAddress,
    actionHash,
    score: assessment.riskScore,
    level: riskLevelToEnum(assessment.riskLevel),
    recommendation: recommendationToEnum(assessment.recommendation),
    policyVersionHash: keccak256(stringToHex(PKG_VERSION)),
    evidenceHash: keccak256(stringToHex("none")),
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
  });

  console.log("Queued 1 risk record:");
  console.log(JSON.stringify({
    target: walletAddress,
    action,
    riskScore: assessment.riskScore,
    riskLevel: assessment.riskLevel,
    recommendation: assessment.recommendation,
    actionHash,
    policyVersion: PKG_VERSION,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
