import { broadcastSignedSchema } from "./schemas.js";
import { getPreparedTx, markPreparedTxUsed } from "../lib/preparedTxStore.js";
import { parseTransaction, recoverTransactionAddress, keccak256, isAddressEqual } from "viem";
import { broadcastSignedTransaction } from "../lib/pharos/userSignedBroadcaster.js";
import { checkAttestationConfig, publishAttestation, getAttestationRecord } from "../lib/pharos/attestationPublisher.js";
import { lookupAttestationInGoldsky, lookupAttestationOnchain } from "../lib/goldsky.js";
import { auditLog } from "../lib/auditLog.js";
import { getActiveNetworkName } from "../lib/networks.js";
import { readOnlyMeta } from "./response.js";

export async function handleBroadcastSigned(raw: unknown) {
  const input = broadcastSignedSchema.parse(raw);
  
  // 1. Load prepared record
  const record = getPreparedTx(input.preparedTransactionId);
  if (!record) {
    throw new Error("Prepared transaction not found or expired.");
  }
  
  if (record.hash !== input.preparedTransactionHash) {
    throw new Error("Prepared transaction hash mismatch.");
  }
  
  if (record.usedAt) {
    throw new Error("Prepared transaction has already been broadcast.");
  }
  
  if (record.expiresAt < Date.now()) {
    throw new Error("Prepared transaction has expired.");
  }
  
  if (record.decision === "BLOCK") {
    throw new Error("Action is blocked by SafeHands policy.");
  }
  
  // Deliberate stance split vs the MCP write gate (see docs/DECISION_CONTRACT.md):
  // the MCP tools accept caller `confirm=true` because the MCP host / human operator
  // relaying the call is the trust anchor attesting the review happened. This HTTP
  // relay has NO such trusted channel — any client can set a boolean — so a
  // REQUIRE_CONFIRMATION record is refused outright rather than self-confirmed.
  if (record.decision === "REQUIRE_CONFIRMATION") {
    throw new Error("Action requires confirmation. No trusted confirmation-satisfied mechanism is currently implemented.");
  }

  // 2. Decode and verify the raw signed transaction
  const parsedTx = parseTransaction(input.rawSignedTransaction as `0x${string}`);
  
  // Recover the sender from the signature
  const recoveredAddress = await recoverTransactionAddress({
    serializedTransaction: input.rawSignedTransaction as any,
  });
  
  if (!isAddressEqual(recoveredAddress, record.from as `0x${string}`)) {
    throw new Error(`Signer mismatch: expected ${record.from}, got ${recoveredAddress}`);
  }
  
  if (parsedTx.to && !isAddressEqual(parsedTx.to, record.to as `0x${string}`)) {
    throw new Error(`To address mismatch: expected ${record.to}, got ${parsedTx.to}`);
  }
  
  const expectedValue = record.value ? BigInt(record.value) : 0n;
  const actualValue = parsedTx.value || 0n;
  if (expectedValue !== actualValue) {
    throw new Error(`Value mismatch: expected ${expectedValue}, got ${actualValue}`);
  }
  
  const actualData = parsedTx.data || "0x";
  const actualDataHash = keccak256(actualData);
  if (actualDataHash !== record.dataHash) {
    throw new Error("Transaction data mismatch.");
  }
  
  if (parsedTx.chainId !== record.chainId) {
    throw new Error(`ChainId mismatch: expected ${record.chainId}, got ${parsedTx.chainId}`);
  }
  
  // 3. Check for Live Broadcast capability
  const isBroadcastEnabled = process.env.SAFEHANDS_USER_SIGNED_BROADCAST_ENABLED === "true";
  
  let txHash: string | undefined;
  let broadcastStatus: "success" | "verify_only_passed" = "verify_only_passed";
  let attestationStatus = "skipped";
  const executionStatus = "UNKNOWN";
  let message = "Transaction signature and fields verified successfully. Broadcast is disabled in verify-only mode.";

  if (isBroadcastEnabled) {
    if (record.chainId !== 1672) {
      throw new Error("Live broadcast is only supported on Pharos Pacific Mainnet (chainId 1672).");
    }

    // 3.5 Check attestation config before broadcast
    checkAttestationConfig();
    
    // 4. Mark used BEFORE broadcast to eliminate async race window
    markPreparedTxUsed(record.id);
    
    // 5. Broadcast
    txHash = await broadcastSignedTransaction(input.rawSignedTransaction, record.chainId);
    
    // 6. Attest. In production required/sync mode, wait for the first attempt so
    // the response reflects durable state; retries continue from the persistent queue.
    attestationStatus = "pending_retry";
    const shouldSyncAttestation = process.env.SAFEHANDS_ATTESTATION_REQUIRED === "true" || process.env.SAFEHANDS_ATTESTATION_SYNC === "true";
    if (shouldSyncAttestation) {
      attestationStatus = await publishAttestation(txHash, parsedTx, record);
    } else {
      publishAttestation(txHash, parsedTx, record).catch(console.error);
    }

    auditLog({
      ts: new Date().toISOString(),
      tool: "broadcast_signed",
      success: true,
      txHash,
      preparedTransactionId: record.id,
      preparedTransactionHash: record.hash,
      attestationStatus,
      chainId: record.chainId,
    });

    broadcastStatus = "success";
    message = "Transaction verified and successfully broadcast.";
  }

  return {
    broadcastStatus,
    attestationStatus,
    executionStatus,
    message,
    txHash,
    preparedTransactionId: record.id,
    preparedTransactionHash: record.hash,
    decision: record.decision,
    network: getActiveNetworkName(),
    chainId: record.chainId,
    ...readOnlyMeta(),
  };
}


export async function handleGetBroadcastAttestationStatus(txHash: string) {
  const localRecord = getAttestationRecord(txHash);
  const goldsky = await lookupAttestationInGoldsky(txHash);
  const onchain = goldsky.indexed
    ? { source: "contract", skipped: true, reason: "Goldsky already indexed the on-chain attestation event." }
    : await lookupAttestationOnchain(txHash);

  const attestationStatus = localRecord?.status || (goldsky.indexed ? "indexed" : ("skipped"));
  return {
    txHash,
    status: goldsky.indexed || ("onchainVerified" in onchain && onchain.onchainVerified)
      ? "attested"
      : localRecord?.status === "pending_retry"
        ? "pending_retry"
        : localRecord?.status === "failed"
          ? "failed"
          : "not_found",
    attestationStatus,
    local: {
      found: Boolean(localRecord),
      record: localRecord,
    },
    goldsky,
    onchain,
    lookupOrder: ["local", "goldsky", "contract_fallback"],
    network: getActiveNetworkName(),
    ...readOnlyMeta(),
  };
}
