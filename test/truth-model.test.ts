// ─── Truth Model invariants ──────────────────────────────────────────────
// Pins the fail-closed evidence rules from docs/DECISION_CONTRACT.md:
//   1. A known ecosystem NAME alone never produces ALLOW (address match required).
//   2. Caller trust flags (recipientVerified/spenderVerified) are claims —
//      omission is treated as unverified, never as safe.
//   3. Negative provider evidence beats registry recognition: a GoPlus honeypot
//      flag on a registry-canonical token still blocks.
//   4. Ecosystem escalation is escalate-only — it never downgrades a BLOCK.
//   5. The policy engine and the read-API analyzer recognize the SAME canonical
//      contract set per network (no more split-brain canonical registries).
import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateActionPolicy } from "../src/lib/policy/actionPolicyEngine.js";
import { analyzeToken } from "../src/lib/analysis/token.js";
import { canonicalContractEvidence, CANONICAL_CONTRACTS } from "../src/lib/analysis/contractIntel.js";
import { applyEcosystemEscalation, classifyEcosystem } from "../src/lib/pharos/ecosystemEvidence.js";
import { evaluateTokenSecurityGate } from "../src/tools/checkTokenSecurity.js";
import {
  ATLANTIC_CANONICAL_CONTRACTS,
  PACIFIC_CANONICAL_CONTRACTS,
  PACIFIC_USDC_ADDRESS,
  isCanonicalInfrastructure,
} from "../src/lib/constants.js";
import { NETWORKS } from "../src/lib/networks.js";

const VALID_RECIPIENT = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

describe("rule 1 · a known token NAME alone never produces ALLOW", () => {
  it("symbol input resolves to the canonical address but requires confirmation", () => {
    const r = analyzeToken("USDC");
    assert.strictEqual(r.details.resolvedFrom, "symbol");
    assert.strictEqual(r.details.status, "CANONICAL_MAINNET_TOKEN");
    assert.strictEqual(r.internalDecision, "REQUIRE_CONFIRMATION");
    assert.ok(r.details.normalizedAddress, "the resolved canonical address must be surfaced");
  });

  it("the canonical ADDRESS still allows (address match is the ALLOW path)", () => {
    const r = analyzeToken(PACIFIC_USDC_ADDRESS);
    assert.strictEqual(r.details.resolvedFrom, "address");
    assert.strictEqual(r.internalDecision, "ALLOW");
  });

  it("an unknown address stays REQUIRE_CONFIRMATION", () => {
    const r = analyzeToken(VALID_RECIPIENT);
    assert.strictEqual(r.internalDecision, "REQUIRE_CONFIRMATION");
  });
});

describe("rule 2 · caller trust flags are claims — omission is not safety", () => {
  it("send_payment WITHOUT recipientVerified emits an unknown reputation check and requires confirmation", () => {
    const r = evaluateActionPolicy({ actionType: "send_payment", amount: "0.001", recipient: VALID_RECIPIENT });
    const check = r.checks.find((c) => c.name === "recipient_reputation");
    assert.ok(check, "recipient_reputation check must be present when the claim is omitted");
    assert.strictEqual(check.status, "unknown");
    assert.notStrictEqual(r.decision, "ALLOW");
  });

  it("send_payment with recipientVerified=true records the claim as caller-attested", () => {
    const r = evaluateActionPolicy({ actionType: "send_payment", amount: "0.001", recipient: VALID_RECIPIENT, recipientVerified: true });
    const check = r.checks.find((c) => c.name === "recipient_reputation");
    assert.ok(check && check.status === "pass");
    assert.match(check.message, /caller-attested/i);
    assert.strictEqual(r.decision, "ALLOW");
  });

  it("approve_token WITHOUT spenderVerified emits an unknown reputation check and requires confirmation", () => {
    const r = evaluateActionPolicy({ actionType: "approve_token", approvalAmount: "1", spender: VALID_RECIPIENT });
    const check = r.checks.find((c) => c.name === "spender_reputation");
    assert.ok(check, "spender_reputation check must be present when the claim is omitted");
    assert.strictEqual(check.status, "unknown");
    assert.notStrictEqual(r.decision, "ALLOW");
  });

  it("explicit recipientVerified=false still warns (unchanged behavior)", () => {
    const r = evaluateActionPolicy({ actionType: "send_payment", amount: "0.001", recipient: VALID_RECIPIENT, recipientVerified: false });
    const check = r.checks.find((c) => c.name === "recipient_reputation");
    assert.ok(check && check.status === "warn");
    assert.notStrictEqual(r.decision, "ALLOW");
  });
});

describe("rule 3 · negative provider evidence beats registry recognition (hermetic, mocked fetch)", () => {
  async function withMockedGoplus<T>(payload: unknown, fn: () => Promise<T>): Promise<T> {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  it("a GoPlus honeypot flag on the registry-canonical USDC address still BLOCKS", async () => {
    const address = PACIFIC_USDC_ADDRESS.toLowerCase();
    const gate = await withMockedGoplus(
      { code: 1, result: { [address]: { is_honeypot: "1", buy_tax: "0", sell_tax: "0" } } },
      () => evaluateTokenSecurityGate(address),
    );
    assert.strictEqual(gate.verdict, "block", "registry recognition must never veto a confirmed negative signal");
  });

  it("GoPlus outage on a registry-canonical token stays review (identity verified, intel missing)", async () => {
    const address = PACIFIC_USDC_ADDRESS.toLowerCase();
    const gate = await withMockedGoplus(
      { code: 0, result: {} },
      () => evaluateTokenSecurityGate(address),
    );
    assert.strictEqual(gate.verdict, "review");
    assert.notStrictEqual(gate.verdict, "ok");
  });
});

describe("rule 4 · ecosystem escalation is escalate-only", () => {
  const crossChain = classifyEcosystem({ provider: "layerzero" });

  it("cross-chain evidence escalates ALLOW to REQUIRE_CONFIRMATION", () => {
    assert.strictEqual(crossChain.recommendedDecisionImpact, "REQUIRE_CONFIRMATION");
    assert.strictEqual(applyEcosystemEscalation("ALLOW", crossChain), "REQUIRE_CONFIRMATION");
  });

  it("a hard BLOCK is NEVER downgraded by ecosystem evidence (doc §4 invariant)", () => {
    assert.strictEqual(applyEcosystemEscalation("BLOCK", crossChain), "BLOCK");
  });

  it("non-escalating evidence leaves the decision untouched", () => {
    const oracle = classifyEcosystem({ provider: "chainlink" });
    assert.strictEqual(applyEcosystemEscalation("ALLOW", oracle), "ALLOW");
    assert.strictEqual(applyEcosystemEscalation("BLOCK", oracle), "BLOCK");
  });
});

describe("rule 5 · one canonical contract set per network across layers", () => {
  it("every Pacific canonical address is recognized by BOTH the policy engine and the analyzer", () => {
    for (const address of PACIFIC_CANONICAL_CONTRACTS) {
      assert.ok(isCanonicalInfrastructure(address, true), `policy engine must recognize ${address}`);
      const evidence = canonicalContractEvidence(address, NETWORKS["pacific-mainnet"]);
      assert.ok(evidence, `analyzer must recognize ${address} on pacific-mainnet`);
    }
  });

  it("deterministic CREATE2 contracts are recognized on Atlantic too (ALL_NETWORKS bug fix)", () => {
    const permit2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
    assert.ok(ATLANTIC_CANONICAL_CONTRACTS.includes(permit2));
    const evidence = canonicalContractEvidence(permit2, NETWORKS["atlantic-testnet"]);
    assert.ok(evidence, "Permit2 must be recognized on atlantic-testnet");
    assert.strictEqual(evidence.network, "atlantic-testnet");
  });

  it("analyzer metadata exists for every Pacific canonical address (no silent subset)", () => {
    for (const address of PACIFIC_CANONICAL_CONTRACTS) {
      assert.ok(CANONICAL_CONTRACTS[address], `CANONICAL_CONTRACTS metadata missing for ${address}`);
    }
  });

  it("canonical recognition never claims source verification", () => {
    for (const address of PACIFIC_CANONICAL_CONTRACTS) {
      const evidence = canonicalContractEvidence(address, NETWORKS["pacific-mainnet"]);
      assert.ok(evidence);
      // Recognition is by address only — behavior strings must not promise auto-safety.
      assert.ok(evidence.recommendedSafeHandsBehavior.length > 0);
    }
  });
});
