// ─── Safe HTTP Helpers ─────────────────────────────────────────────────

import dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
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

interface SafeResolvedAddress {
  address: string;
  family: 4 | 6;
}

interface SafeFetchTarget {
  url: URL;
  address: SafeResolvedAddress;
}

const MAX_SAFE_REDIRECTS = 5;
const DNS_LOOKUP_TIMEOUT_MS = 2_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function headerPairs(headers: Headers): string[] {
  const pairs: string[] = [];
  headers.forEach((value, key) => pairs.push(key, value));
  return pairs;
}

function normalizeHeaders(headers: HeadersInit | undefined): Headers {
  return new Headers(headers);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function shouldRewriteRedirectToGet(status: number, method: string): boolean {
  const upper = method.toUpperCase();
  return (status === 301 || status === 302 || status === 303) && upper !== "GET" && upper !== "HEAD";
}

async function bodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== "undefined" && body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error("Unsupported request body type for SafeHands safe fetch.");
}

function responseFromNodeMessage(res: http.IncomingMessage, chunks: Buffer[]): Response {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(res.headers)) {
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
    } else if (raw !== undefined) {
      headers.set(key, String(raw));
    }
  }

  return new Response(Buffer.concat(chunks), {
    status: res.statusCode || 0,
    statusText: res.statusMessage || "",
    headers,
  });
}

export async function fetchWithTimeoutAndRetry(
  url: string | URL,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const { timeoutMs = 10_000, retries = 2, retryDelayMs = 250, ...requestInit } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await safeFetchWithTimeout(url, requestInit, timeoutMs, 0);

      if (!isRetryableStatus(response.status) || attempt === retries) {
        return response;
      }

      lastError = new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status, response.statusText);
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isProductionEnv(): boolean {
  return (process.env.NODE_ENV || "").toLowerCase() === "production";
}

/**
 * ALLOW_LOCAL_X402_FETCH is a LOCAL-ONLY escape hatch. It is hard-disabled in
 * production (NODE_ENV=production) and, even when set, it relaxes ONLY loopback
 * (localhost / 127.0.0.0/8 / ::1). Cloud-metadata (169.254.169.254), RFC1918,
 * CGNAT, and every other blocked range stay blocked via isBlockedIp regardless.
 */
function localFetchBypassEnabled(): boolean {
  return process.env.ALLOW_LOCAL_X402_FETCH === "true" && !isProductionEnv();
}

/**
 * Normalize a URL hostname for IP checks. WHATWG `URL.hostname` keeps the
 * brackets around an IPv6 literal (e.g. "[::1]"), and net.isIP("[::1]") is 0 —
 * so without stripping them a bracketed IPv6 literal skips isBlockedIp() and
 * falls through to DNS. Strip the surrounding brackets so the bare address is
 * seen by net.isIP / isBlockedIp.
 */
function normalizeHostname(hostname: string): string {
  const h = hostname.toLowerCase();
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

function isLoopbackHost(host: string): boolean {
  const h = normalizeHostname(host);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const version = net.isIP(h);
  if (version === 4) return ipv4InCidr(h, "127.0.0.0", 8);
  if (version === 6) return h === "::1" || h.startsWith("::ffff:127.");
  return false;
}

async function safeFetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  redirectCount: number
): Promise<Response> {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url.href);

  // Local demo/test escape hatch, LOOPBACK-ONLY and never in production. Any
  // non-loopback URL — including cloud-metadata IPs — falls through to the
  // DNS-pinned, blocklist-enforcing path below, so the flag can no longer be
  // used to reach internal/metadata endpoints.
  if (localFetchBypassEnabled() && isLoopbackHost(parsed.hostname)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(parsed, { ...init, signal: init.signal ?? controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  const response = await safePinnedFetchOnce(parsed, init, timeoutMs);
  const redirectMode = init.redirect ?? "follow";

  if (redirectMode === "error" && isRedirectStatus(response.status)) {
    throw new Error(`Redirect blocked by policy (${response.status}).`);
  }

  if (redirectMode !== "manual" && isRedirectStatus(response.status)) {
    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount >= MAX_SAFE_REDIRECTS) {
      throw new Error("Too many redirects.");
    }

    const nextUrl = new URL(location, parsed.href);
    const method = (init.method || "GET").toUpperCase();
    const nextInit: RequestInit = { ...init };
    if (shouldRewriteRedirectToGet(response.status, method)) {
      nextInit.method = "GET";
      delete nextInit.body;
      const headers = normalizeHeaders(nextInit.headers);
      headers.delete("content-length");
      headers.delete("content-type");
      nextInit.headers = headers;
    }

    return safeFetchWithTimeout(nextUrl, nextInit, timeoutMs, redirectCount + 1);
  }

  return response;
}

async function safePinnedFetchOnce(parsed: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const target = await resolveSafeFetchTarget(parsed.href);
  const body = await bodyToBuffer(init.body);
  const headers = normalizeHeaders(init.headers);

  if (body && !headers.has("content-length")) {
    headers.set("content-length", String(body.byteLength));
  }

  return new Promise<Response>((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }, timeoutMs);

    if (init.signal) {
      if (init.signal.aborted) {
        clearTimeout(timeout);
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      init.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const client = target.url.protocol === "https:" ? https : http;
    const req = client.request(
      target.url,
      {
        method: init.method || "GET",
        headers: headerPairs(headers),
        signal: controller.signal,
        timeout: timeoutMs,
        lookup: (_hostname, options, callback) => {
          // DNS rebinding protection: connect only to the exact IP address that
          // was resolved and verified immediately before this request.
          //
          // Node may call custom lookup with options.all=true. In that mode the
          // callback must receive an array of addresses, not (address, family).
          // Returning the one pinned safe address preserves SSRF protection.
          const pinned = {
            address: target.address.address,
            family: target.address.family,
          };

          if ((options as { all?: boolean } | undefined)?.all) {
            callback(null, [pinned] as any);
            return;
          }

          callback(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          clearTimeout(timeout);
          resolve(responseFromNodeMessage(res, chunks));
        });
      }
    );

    req.on("timeout", () => req.destroy(new DOMException("The operation timed out.", "TimeoutError")));
    req.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    if (body) req.write(body);
    req.end();
  });
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

/**
 * Extract the embedded IPv4 from an IPv4-mapped IPv6 address, handling BOTH the
 * dotted-decimal form (`::ffff:127.0.0.1`) and its canonical hex form
 * (`::ffff:7f00:1`, which is what WHATWG `URL` produces). Returns null when the
 * input is not a `::ffff:`-mapped address. This lets isBlockedIp() run the
 * authoritative IPv4 CIDR table on the real octets instead of fragile textual
 * prefix matching (which both missed the hex form and over-blocked public space
 * like 172.2.0.0/16 via a "::ffff:172.2" prefix).
 */
function mappedIpv4(ipv6: string): string | null {
  const m = ipv6.toLowerCase().match(/^::ffff:(.+)$/);
  if (!m) return null;
  const rest = m[1];
  if (net.isIP(rest) === 4) return rest; // dotted-decimal tail
  const groups = rest.split(":");
  if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
    const hi = parseInt(groups[0], 16);
    const lo = parseInt(groups[1], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return (
      ipv4InCidr(ip, "0.0.0.0", 8) ||
      ipv4InCidr(ip, "10.0.0.0", 8) ||
      ipv4InCidr(ip, "100.64.0.0", 10) ||
      ipv4InCidr(ip, "127.0.0.0", 8) ||
      ipv4InCidr(ip, "169.254.0.0", 16) ||
      ipv4InCidr(ip, "172.16.0.0", 12) ||
      ipv4InCidr(ip, "192.0.0.0", 24) ||
      ipv4InCidr(ip, "192.0.2.0", 24) ||
      ipv4InCidr(ip, "192.168.0.0", 16) ||
      ipv4InCidr(ip, "198.18.0.0", 15) ||
      ipv4InCidr(ip, "198.51.100.0", 24) ||
      ipv4InCidr(ip, "203.0.113.0", 24) ||
      ipv4InCidr(ip, "224.0.0.0", 4) ||
      ipv4InCidr(ip, "240.0.0.0", 4) ||
      ip === "255.255.255.255"
    );
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    // IPv4-mapped IPv6: run the authoritative IPv4 table on the embedded address.
    // Any "::ffff:*" we cannot cleanly parse fails closed (blocked) — an
    // unparseable mapped form must never be treated as a safe public address.
    if (normalized.startsWith("::ffff:")) {
      const mapped = mappedIpv4(normalized);
      return mapped ? isBlockedIp(mapped) : true;
    }
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||   // ULA fc00::/7 (fc..)
      normalized.startsWith("fd") ||   // ULA fc00::/7 (fd..)
      normalized.startsWith("fe80:") || // link-local
      normalized.startsWith("ff") ||   // multicast
      normalized.startsWith("2001:db8:") || // documentation
      normalized.startsWith("2002:")   // 6to4
    );
  }

  return false;
}

async function lookupWithTimeout(host: string): Promise<{ address: string; family: number }[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SSRF_BLOCKED: DNS lookup timed out")), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveSafeFetchTarget(rawUrl: string): Promise<SafeFetchTarget> {
  const parsed = validateFetchUrlSyntax(rawUrl);
  const host = normalizeHostname(parsed.hostname);

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error(`SSRF_BLOCKED: blocked IP range (${host})`);
    }
    return { url: parsed, address: { address: host, family: net.isIP(host) as 4 | 6 } };
  }

  const lookupResults = await lookupWithTimeout(host);
  if (lookupResults.length === 0) {
    throw new Error("SSRF_BLOCKED: hostname has no DNS records");
  }

  for (const result of lookupResults) {
    if (isBlockedIp(result.address)) {
      throw new Error(`SSRF_BLOCKED: hostname resolves to blocked IP range (${result.address})`);
    }
  }

  const chosen = lookupResults[0];
  return { url: parsed, address: { address: chosen.address, family: chosen.family as 4 | 6 } };
}

function validateFetchUrlSyntax(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  const host = normalizeHostname(parsed.hostname);
  if (!host) throw new Error("SSRF_BLOCKED: missing hostname");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("SSRF_BLOCKED: localhost is not allowed");
  }

  if (/^\d+$/.test(host) || host.includes("%") || host.includes("\\")) {
    throw new Error("SSRF_BLOCKED: suspicious hostname format");
  }

  return parsed;
}

export async function assertSafeFetchUrl(rawUrl: string): Promise<void> {
  if (localFetchBypassEnabled()) {
    // The bypass only clears LOOPBACK. A non-loopback URL still goes through full
    // DNS resolution + blocklist, so metadata/private IPs are never waved through.
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("Invalid URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are allowed");
    }
    if (isLoopbackHost(parsed.hostname)) return;
  }
  await resolveSafeFetchTarget(rawUrl);
}
