// ─── Safe HTTP Helpers ─────────────────────────────────────────────────

import dns from "node:dns/promises";
import net from "node:net";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly statusText?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function fetchWithTimeoutAndRetry(
  url: string | URL,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const { timeoutMs = 10_000, retries = 2, retryDelayMs = 250, ...requestInit } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...requestInit,
        signal: requestInit.signal ?? controller.signal,
      });

      if (!isRetryableStatus(response.status) || attempt === retries) {
        return response;
      }

      lastError = new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status, response.statusText);
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    } finally {
      clearTimeout(timeout);
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function redactSensitive(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= 10) return "[REDACTED]";
  return `${value.slice(0, 6)}...[REDACTED]`;
}

function ipv4ToNumber(ip: string): number | null {
  if (net.isIP(ip) !== 4) return null;
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function ipv4InCidr(ip: string, cidrBase: string, prefix: number): boolean {
  const ipNum = ipv4ToNumber(ip);
  const baseNum = ipv4ToNumber(cidrBase);
  if (ipNum === null || baseNum === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return (
      ipv4InCidr(ip, "0.0.0.0", 8) ||
      ipv4InCidr(ip, "10.0.0.0", 8) ||
      ipv4InCidr(ip, "127.0.0.0", 8) ||
      ipv4InCidr(ip, "169.254.0.0", 16) ||
      ipv4InCidr(ip, "172.16.0.0", 12) ||
      ipv4InCidr(ip, "192.168.0.0", 16)
    );
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized === "::" ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }

  return false;
}

export async function assertSafeFetchUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  const allowLocal = process.env.ALLOW_LOCAL_X402_FETCH === "true";
  if (allowLocal) return;

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("SSRF_BLOCKED: localhost is not allowed");
  }

  if (net.isIP(host) && isBlockedIp(host)) {
    throw new Error(`SSRF_BLOCKED: blocked IP range (${host})`);
  }

  if (/^\d+$/.test(host) || host.includes("%") || host.includes("\\")) {
    throw new Error("SSRF_BLOCKED: suspicious hostname format");
  }

  const lookupResults = await dns.lookup(host, { all: true });
  for (const result of lookupResults) {
    if (isBlockedIp(result.address)) {
      throw new Error(`SSRF_BLOCKED: hostname resolves to blocked IP range (${result.address})`);
    }
  }
}
