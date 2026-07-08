#!/usr/bin/env node
// ─── SafeHands Background Worker ───────────────────────────────────────
// Runs durable background jobs for the hosted/full-enabled deployment.
// Keep this as a separate service on Railway/Fly/VPS so public HTTP latency is
// not tied to retry loops. Current jobs:
//   - attestation retry queue from SAFEHANDS_ATTESTATION_STORE_PATH
// Future jobs can be added here (risk-root batching, DA uploads, indexing).
// ────────────────────────────────────────────────────────────────────────

import "./lib/envLoader.js";
import { retryPendingAttestations, startAttestationRetryLoop } from "./lib/pharos/attestationPublisher.js";
import { assertProductionPosture } from "./lib/productionGuards.js";

// Same fail-fast posture check as the API server (active only when
// NODE_ENV=production) — the worker can hold an attester key, so it must not
// silently boot into a custody-unsafe configuration either.
assertProductionPosture();

const intervalMs = Number(process.env.SAFEHANDS_WORKER_HEARTBEAT_MS || 60_000);

process.on("unhandledRejection", (reason) => {
  console.error("SafeHands worker unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("SafeHands worker uncaught exception:", error);
  process.exit(1);
});

console.log("🛡️  SafeHands worker started");
console.log(`   Attestation retry enabled: ${process.env.SAFEHANDS_ATTESTATION_RETRY_ENABLED !== "false"}`);
console.log(`   Store: ${process.env.SAFEHANDS_ATTESTATION_STORE_PATH || process.env.SAFEHANDS_STATE_DIR || ".safehands"}`);

startAttestationRetryLoop();

// Run once immediately so a restarted worker drains due records without waiting
// for the first interval. The loop imported above continues afterwards.
retryPendingAttestations()
  .then((count) => console.log(`   Initial attestation retry attempts: ${count}`))
  .catch((err) => console.error("   Initial attestation retry failed:", err instanceof Error ? err.message : String(err)));

setInterval(() => {
  console.log(`SafeHands worker heartbeat ${new Date().toISOString()}`);
}, intervalMs);

// The ref'ed interval above keeps Railway/Fly/VPS worker processes alive.
// Avoid an unsettled top-level await here because Node may terminate ESM modules
// with warning code 13 when the only remaining work is an unresolved Promise.
