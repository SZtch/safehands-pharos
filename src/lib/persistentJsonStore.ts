// ─── Small persistent JSON store ───────────────────────────────────────
// Single-process durable storage for the Single-Instance Production Architecture.
// It writes atomically
// to a local file/volume and is intentionally dependency-free. For multi-node
// deployments, replace this adapter with Postgres/Redis.
// ────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export function safeHandsStateDir(): string {
  return process.env.SAFEHANDS_STATE_DIR || process.env.STATE_DIR || ".safehands";
}

export function stateFile(name: string, envName?: string): string {
  return (envName ? process.env[envName] : undefined) || join(safeHandsStateDir(), name);
}

function ensureParent(filePath: string): void {
  const dir = dirname(filePath);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFileAtomic<T>(filePath: string, value: T): void {
  ensureParent(filePath);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}
