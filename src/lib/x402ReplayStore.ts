// ─── x402 Replay Store ─────────────────────────────────────────────────
// Durable replay protection. Uses Upstash Redis REST when configured, falling
// back to an atomic local JSON file so a Single-Instance Production Deployment does
// not lose replay state on process restart.
// ────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { fetchWithTimeoutAndRetry } from "./http.js";
import { readJsonFile, stateFile, writeJsonFileAtomic } from "./persistentJsonStore.js";

interface ReplayFileState {
  seen: Record<string, number>;
}

export interface ReplayRecordResult {
  allowed: boolean;
  backend: "upstash" | "file";
}

const FILE_PATH = stateFile("x402_replay.json", "SAFEHANDS_X402_REPLAY_STORE_PATH");

function replayKey(paymentHeader: string): string {
  return `x402:${createHash("sha256").update(paymentHeader).digest("hex")}`;
}

async function upstashCommand(args: unknown[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.SAFEHANDS_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.SAFEHANDS_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis REST is not configured");
  // The URL is operator-controlled env, so it goes through the SSRF-safe layer.
  // A failed call falls back to the file store (or throws when
  // SAFEHANDS_X402_REPLAY_REDIS_REQUIRED=true), so the retry budget stays small.
  const res = await fetchWithTimeoutAndRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    timeoutMs: 5_000,
    retries: 1,
  });
  if (!res.ok) throw new Error(`Upstash Redis REST returned ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

async function checkAndRecordUpstash(paymentHeader: string, windowMs: number): Promise<ReplayRecordResult> {
  const key = replayKey(paymentHeader);
  const exists = await upstashCommand(["GET", key]);
  if (exists !== null && exists !== undefined) return { allowed: false, backend: "upstash" };
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const setResult = await upstashCommand(["SET", key, String(Date.now()), "EX", String(ttlSeconds), "NX"]);
  if (setResult === null) return { allowed: false, backend: "upstash" };
  return { allowed: true, backend: "upstash" };
}

function checkAndRecordFile(paymentHeader: string, windowMs: number): ReplayRecordResult {
  const now = Date.now();
  const key = replayKey(paymentHeader);
  const state = readJsonFile<ReplayFileState>(FILE_PATH, { seen: {} });
  for (const [k, ts] of Object.entries(state.seen)) {
    if (now - ts >= windowMs) delete state.seen[k];
  }
  const previous = state.seen[key];
  if (previous !== undefined && now - previous < windowMs) {
    writeJsonFileAtomic(FILE_PATH, state);
    return { allowed: false, backend: "file" };
  }
  state.seen[key] = now;
  writeJsonFileAtomic(FILE_PATH, state);
  return { allowed: true, backend: "file" };
}

export async function checkAndRecordX402Replay(paymentHeader: string, windowMs: number): Promise<ReplayRecordResult> {
  const hasUpstash = Boolean((process.env.UPSTASH_REDIS_REST_URL || process.env.SAFEHANDS_REDIS_REST_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.SAFEHANDS_REDIS_REST_TOKEN));
  if (hasUpstash) {
    try {
      return await checkAndRecordUpstash(paymentHeader, windowMs);
    } catch (err) {
      if (process.env.SAFEHANDS_X402_REPLAY_REDIS_REQUIRED === "true") throw err;
    }
  }
  return checkAndRecordFile(paymentHeader, windowMs);
}
