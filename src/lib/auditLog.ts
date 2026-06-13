// ─── Audit Log ──────────────────────────────────────────────────────────
// Append-only JSON log of every MCP tool invocation.
// Activated by setting AUDIT_LOG_PATH in .env.
// Each line is a JSON object — parseable with `jq` or log aggregators.
// ────────────────────────────────────────────────────────────────────────

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export interface AuditEntry {
  ts: string;
  tool: string;
  success: boolean;
  errorCode?: string;
  durationMs?: number;
}

const LOG_PATH = process.env.AUDIT_LOG_PATH || "";

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

let dirEnsured = false;

export function auditLog(entry: AuditEntry): void {
  if (!LOG_PATH) return;
  try {
    if (!dirEnsured) {
      ensureDir(LOG_PATH);
      dirEnsured = true;
    }
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Never throw from audit log — logging must not affect tool behavior
  }
}
