// ─── SafeHands registry/attestation read-default resolution ────────────────
// The Pacific-mainnet contract addresses are baked as READ-path defaults with:
//   • env override (env wins on any chain)
//   • a chainId guard (baked default applies ONLY on Pacific mainnet 1672; any
//     other chain resolves to "" → fail-closed / NOT_CONFIGURED)
// No write path is affected (write availability reads process.env separately).
// Resolvers read process.env at call time, so we snapshot + restore to isolate.
// Pure + deterministic: no chain, no network, no key.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  resolveSafeHandsRegistryAddress,
  resolveSafeHandsAttestationAddress,
} from "../src/lib/constants.js";

const PACIFIC = 1672;
const ATLANTIC = 688689;
const REGISTRY_PACIFIC = "0x428e02bf85412e7242d991cd6725ec59e8b06c8d";
const ATTESTATION_PACIFIC = "0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c";
const OVERRIDE = "0x1234567890123456789012345678901234567890";

const ENV_KEYS = [
  "SAFEHANDS_REGISTRY_ADDRESS",
  "SAFEHANDS_ATTESTATION_ADDRESS",
  "SAFEHANDS_RISK_REGISTRY_ADDRESS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("SafeHands registry read-default resolution", () => {
  it("resolves the baked Pacific-mainnet address on chainId 1672 (no env)", () => {
    assert.strictEqual(resolveSafeHandsRegistryAddress(PACIFIC), REGISTRY_PACIFIC);
  });

  it("resolves to \"\" off Pacific mainnet — chainId-guarded, fail-closed (NOT_CONFIGURED)", () => {
    assert.strictEqual(resolveSafeHandsRegistryAddress(ATLANTIC), "");
  });

  it("env override wins on any chain", () => {
    process.env.SAFEHANDS_REGISTRY_ADDRESS = OVERRIDE;
    assert.strictEqual(resolveSafeHandsRegistryAddress(PACIFIC), OVERRIDE);
    assert.strictEqual(resolveSafeHandsRegistryAddress(ATLANTIC), OVERRIDE);
  });
});

describe("SafeHands attestation read-default resolution", () => {
  it("resolves the baked Pacific-mainnet address on chainId 1672 (no env)", () => {
    assert.strictEqual(resolveSafeHandsAttestationAddress(PACIFIC), ATTESTATION_PACIFIC);
  });

  it("resolves to \"\" off Pacific mainnet — chainId-guarded, fail-closed (NOT_CONFIGURED)", () => {
    assert.strictEqual(resolveSafeHandsAttestationAddress(ATLANTIC), "");
  });

  it("env override wins on any chain", () => {
    process.env.SAFEHANDS_ATTESTATION_ADDRESS = OVERRIDE;
    assert.strictEqual(resolveSafeHandsAttestationAddress(PACIFIC), OVERRIDE);
    assert.strictEqual(resolveSafeHandsAttestationAddress(ATLANTIC), OVERRIDE);
  });
});
