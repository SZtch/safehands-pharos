// ─── SSRF guard behavioral tests (hermetic — no network, no DNS) ───────────
// src/lib/http.ts is the security boundary for EVERY outbound fetch (GoPlus,
// DODO route API, x402 preflight, DA-batch reads). These tests pin its
// contract: the blocklist tables, the URL-syntax rejections, and the fact that
// a blocked target is refused BEFORE any socket/DNS work. Every case below uses
// either the pure isBlockedIp() or an IP-literal / syntactically-invalid URL,
// both of which are decided without DNS — the suite runs fully offline.
//
// Not covered here (needs a controlled live server): redirect re-validation and
// DNS-pinned connect. Those paths share resolveSafeFetchTarget with the cases
// below; see safeFetchWithTimeout/safePinnedFetchOnce in src/lib/http.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, after } from "node:test";
import assert from "node:assert";
import { isBlockedIp, assertSafeFetchUrl, fetchWithTimeoutAndRetry } from "../src/lib/http.js";

// Env keys the bypass tests mutate — snapshot + restore.
const MUTATED_ENV_KEYS = ["ALLOW_LOCAL_X402_FETCH", "NODE_ENV"] as const;
const savedEnv = Object.fromEntries(MUTATED_ENV_KEYS.map((k) => [k, process.env[k]]));
// The strict-path cases below assume the loopback bypass is OFF. CI (and local
// shells) may export ALLOW_LOCAL_X402_FETCH=true for OTHER suites, so clear it
// here — the bypass-specific tests re-enable it explicitly themselves.
delete process.env.ALLOW_LOCAL_X402_FETCH;
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("isBlockedIp · IPv4 blocklist", () => {
  const blocked = [
    "0.0.0.0", "0.255.255.255",            // 0.0.0.0/8
    "10.0.0.1", "10.255.255.254",          // RFC1918 10/8
    "100.64.0.1", "100.127.255.254",       // CGNAT 100.64/10
    "127.0.0.1", "127.255.255.255",        // loopback
    "169.254.169.254", "169.254.0.1",      // link-local incl. cloud metadata
    "172.16.0.1", "172.31.255.254",        // RFC1918 172.16/12
    "192.0.0.1",                            // IETF protocol assignments 192.0.0/24
    "192.0.2.1",                            // TEST-NET-1
    "192.168.1.1", "192.168.255.255",      // RFC1918 192.168/16
    "198.18.0.1", "198.19.255.255",        // benchmarking 198.18/15
    "198.51.100.7",                         // TEST-NET-2
    "203.0.113.9",                          // TEST-NET-3
    "224.0.0.1", "239.255.255.255",        // multicast
    "240.0.0.1",                            // reserved
    "255.255.255.255",                      // broadcast
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => assert.strictEqual(isBlockedIp(ip), true));
  }

  const allowed = [
    "8.8.8.8", "1.1.1.1", "9.9.9.9",
    "100.63.255.255",   // just below CGNAT
    "100.128.0.1",      // just above CGNAT
    "172.15.255.255",   // just below 172.16/12
    "172.32.0.1",       // just above 172.16/12
    "198.17.255.255",   // just below 198.18/15
    "223.255.255.255",  // just below multicast
  ];
  for (const ip of allowed) {
    it(`allows public ${ip}`, () => assert.strictEqual(isBlockedIp(ip), false));
  }
});

describe("isBlockedIp · IPv6 blocklist (incl. IPv4-mapped forms)", () => {
  const blocked = [
    "::1", "::",
    "fc00::1", "fd12:3456::1",       // ULA fc00::/7
    "fe80::1",                        // link-local
    "ff02::1",                        // multicast
    "2001:db8::1",                    // documentation
    "2002:7f00:1::1",                 // 6to4
    "::ffff:127.0.0.1",               // mapped loopback (dotted)
    "::ffff:7f00:1",                  // mapped loopback (canonical hex — what URL produces)
    "::ffff:10.1.2.3",                // mapped RFC1918 (dotted)
    "::ffff:0a01:0203",               // mapped RFC1918 (hex)
    "::ffff:169.254.169.254",         // mapped cloud metadata (dotted)
    "::ffff:a9fe:a9fe",               // mapped cloud metadata (hex)
    "::ffff:172.16.0.1", "::ffff:172.31.0.1",
    "::ffff:192.168.0.1",
    "::ffff:c0a8:1",                  // mapped 192.168.0.1 (hex)
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => assert.strictEqual(isBlockedIp(ip), true));
  }

  const allowed = [
    "2606:4700:4700::1111", "2001:4860:4860::8888",
    "::ffff:8.8.8.8",   // mapped PUBLIC IPv4 must NOT be blocked (dotted)
    "::ffff:0808:0808", // mapped 8.8.8.8 (hex)
    "::ffff:172.2.1.1", // mapped 172.2/16 is PUBLIC — the old ::ffff:172.2 prefix over-blocked it
  ];
  for (const ip of allowed) {
    it(`allows public ${ip}`, () => assert.strictEqual(isBlockedIp(ip), false));
  }

  it("non-IP input is not blocked by the IP table (hostnames go through DNS + per-address checks)", () => {
    assert.strictEqual(isBlockedIp("example.com"), false);
    assert.strictEqual(isBlockedIp(""), false);
  });
});

describe("assertSafeFetchUrl · URL syntax and scheme rejections (no DNS needed)", () => {
  const rejected: Array<[string, RegExp]> = [
    ["ftp://example.com/x", /Only HTTP and HTTPS/],
    ["file:///etc/passwd", /Only HTTP and HTTPS/],
    ["ws://example.com/", /Only HTTP and HTTPS/],
    ["not a url", /Invalid URL/],
    ["http://localhost/admin", /SSRF_BLOCKED: localhost/],
    ["http://api.localhost/", /SSRF_BLOCKED: localhost/],
    // WHATWG URL canonicalizes these integer/hex IPv4 forms to 127.0.0.1, so the
    // blocklist catches them as a blocked IP range (stronger than the syntax heuristic).
    ["http://2130706433/", /SSRF_BLOCKED: blocked IP range/], // decimal-encoded 127.0.0.1
    ["http://0x7f000001/", /SSRF_BLOCKED: blocked IP range/], // hex-encoded 127.0.0.1
  ];
  for (const [url, re] of rejected) {
    it(`rejects ${url}`, async () => {
      await assert.rejects(assertSafeFetchUrl(url), re);
    });
  }
});

describe("assertSafeFetchUrl · IP-literal targets (decided without DNS)", () => {
  const blocked = [
    "http://127.0.0.1:8545/",
    "https://10.0.0.5/internal",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/router",
    "http://100.64.0.7/cgnat",
    "http://0.0.0.0:9/",
    "http://[::1]:3000/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[2001:db8::1]/",
  ];
  for (const url of blocked) {
    it(`blocks ${url}`, async () => {
      await assert.rejects(assertSafeFetchUrl(url), /SSRF_BLOCKED/);
    });
  }

  const allowed = ["https://8.8.8.8/", "https://1.1.1.1/dns-query", "https://[2606:4700:4700::1111]/"];
  for (const url of allowed) {
    it(`allows public literal ${url}`, async () => {
      await assert.doesNotReject(assertSafeFetchUrl(url));
    });
  }
});

describe("fetchWithTimeoutAndRetry · blocked targets are refused before any socket", () => {
  it("refuses the cloud-metadata endpoint with SSRF_BLOCKED (no retries, no network)", async () => {
    await assert.rejects(
      fetchWithTimeoutAndRetry("http://169.254.169.254/latest/meta-data/", { retries: 0, timeoutMs: 1_000 }),
      /SSRF_BLOCKED/
    );
  });

  it("refuses loopback JSON-RPC style targets", async () => {
    await assert.rejects(
      fetchWithTimeoutAndRetry("http://127.0.0.1:8545/", { retries: 0, timeoutMs: 1_000 }),
      /SSRF_BLOCKED/
    );
  });
});

describe("ALLOW_LOCAL_X402_FETCH bypass · loopback-only, never in production", () => {
  it("clears ONLY loopback when enabled outside production", async () => {
    process.env.ALLOW_LOCAL_X402_FETCH = "true";
    delete process.env.NODE_ENV;
    await assert.doesNotReject(assertSafeFetchUrl("http://localhost:3999/paid"));
    await assert.doesNotReject(assertSafeFetchUrl("http://127.0.0.1:3999/paid"));
    // Metadata / private ranges stay blocked even with the bypass on.
    await assert.rejects(assertSafeFetchUrl("http://169.254.169.254/latest/meta-data/"), /SSRF_BLOCKED/);
    await assert.rejects(assertSafeFetchUrl("http://10.0.0.5/"), /SSRF_BLOCKED/);
  });

  it("is hard-disabled in production (loopback blocked again)", async () => {
    process.env.ALLOW_LOCAL_X402_FETCH = "true";
    process.env.NODE_ENV = "production";
    await assert.rejects(assertSafeFetchUrl("http://localhost:3999/paid"), /SSRF_BLOCKED: localhost/);
    await assert.rejects(assertSafeFetchUrl("http://127.0.0.1:3999/paid"), /SSRF_BLOCKED/);
  });
});
