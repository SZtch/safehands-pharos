// ─── Hosted engine: escalate-only composition, as a property ───────────────
// test/anvita-engine-composition.test.mjs pins the v2.4.2 audit findings with
// hand-written cases. This file pins the same rules as PROPERTIES over a large
// generated input space, including inputs a caller should never produce.
//
// The rule that broke in v2.4.2: a sub-report's contribution was
// `score += Math.min(cap, riskScore / 2)`, so a component the engine itself
// scored WARN could still yield an ALLOW intent. The floor
// `Math.max(score, sub.riskScore)` is what makes an intent verdict incapable of
// being more permissive than its worst component, and it is asserted here for
// every generated shape rather than for a handful of chosen ones.
//
// The score-to-verdict mapping is pinned too. `scoreToRec` and `scoreToLevel`
// are ternary chains whose FINAL branch is the most severe, which is what makes
// a non-finite score fail closed (every comparison against NaN is false, so NaN
// falls through to "block"/"critical"). Reordering those chains into the more
// natural "block first" form would silently turn NaN into "allow", so the
// behaviour is locked rather than left to chance.
// ───────────────────────────────────────────────────────────────────────────
import { describe, it } from "node:test";
import assert from "node:assert";
import { composeComponent, scoreToRec, scoreToLevel } from "../anvita/safehands/scripts/safehands-engine.js";

// Deterministic PRNG so a failure is replayable from the printed seed.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values a well-behaved caller produces, plus values it never should. */
const HOSTILE_SUBREPORTS = [
  null, undefined, {}, { riskScore: null }, { riskScore: "70" }, { riskScore: true },
  { riskScore: NaN }, { riskScore: Infinity }, { riskScore: -Infinity }, { riskScore: -100 },
  { riskScore: 1e308 }, { riskScore: 0 }, { riskScore: 100 },
  { riskScore: 55, riskLevel: undefined, riskFactors: undefined },
  { riskScore: 80, riskLevel: "high", riskFactors: [] },
];

describe("composeComponent is escalate-only", () => {
  it("never returns less than the running score, for any sub-report shape", () => {
    const rnd = mulberry32(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const score = Math.floor(rnd() * 140) - 20; // includes out-of-band inputs
      const sub = HOSTILE_SUBREPORTS[Math.floor(rnd() * HOSTILE_SUBREPORTS.length)];
      const out = composeComponent(score, sub, "component", [], Math.floor(rnd() * 40));
      if (Number.isNaN(out)) continue; // a NaN sub-score poisons the sum; verdict mapping handles it
      assert.ok(out >= score, `composeComponent(${score}, ${JSON.stringify(sub)}) = ${out} < ${score}`);
    }
  });

  it("never returns less than the component's own score (the v2.4.2 floor)", () => {
    const rnd = mulberry32(0x5afe);
    for (let i = 0; i < 2000; i++) {
      const score = Math.floor(rnd() * 100);
      const riskScore = Math.floor(rnd() * 101);
      const cap = Math.floor(rnd() * 40);
      const out = composeComponent(score, { riskScore, riskLevel: "x", riskFactors: ["f"] }, "component", [], cap);
      assert.ok(
        out >= riskScore,
        `score ${score} + component ${riskScore} (cap ${cap}) composed to ${out}, below the component`
      );
      assert.ok(out >= score, `composition lowered the running score: ${score} -> ${out}`);
    }
  });

  it("a warn-band component can never leave the intent in the allow band", () => {
    // The exact v2.4.2 false-ALLOW: a component the engine scored WARN (31-69)
    // diluted into an ALLOW intent.
    for (let riskScore = 31; riskScore <= 100; riskScore++) {
      const out = composeComponent(0, { riskScore, riskLevel: "medium", riskFactors: ["f"] }, "token", [], 25);
      assert.notStrictEqual(scoreToRec(out), "allow", `component ${riskScore} composed to ${out} = allow`);
    }
  });

  it("a block-band component always leaves the intent in the block band", () => {
    for (let riskScore = 70; riskScore <= 100; riskScore++) {
      const out = composeComponent(0, { riskScore, riskLevel: "high", riskFactors: ["f"] }, "token", [], 25);
      assert.strictEqual(scoreToRec(out), "block", `component ${riskScore} composed to ${out}`);
    }
  });

  it("chained components end at or above the worst component in the chain", () => {
    const rnd = mulberry32(0xd00d);
    for (let round = 0; round < 500; round++) {
      const components = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => Math.floor(rnd() * 101));
      let score = 0;
      for (const riskScore of components) {
        score = composeComponent(score, { riskScore, riskLevel: "x", riskFactors: ["f"] }, "c", [], 25);
      }
      const worst = Math.max(...components);
      assert.ok(score >= worst, `chain ${components.join(",")} composed to ${score}, below worst ${worst}`);
    }
  });

  it("reports a factor for every component it escalates on", () => {
    const factors = [];
    composeComponent(0, { riskScore: 65, riskLevel: "medium", riskFactors: ["reason"] }, "tokenOut", factors, 25);
    assert.strictEqual(factors.length, 1, "an escalating component must be disclosed in the factor list");
    assert.match(factors[0], /tokenOut/);
  });
});

describe("score to verdict mapping fails closed", () => {
  it("maps an unknown or unbounded score to the most severe verdict, never allow", () => {
    // Guards the ternary ORDER in scoreToRec/scoreToLevel: the final branch is
    // the severe one, so a value that compares false against every threshold
    // (NaN, undefined) lands on block/critical instead of falling through to
    // allow. Rewriting these as "block first" would invert that silently.
    for (const bad of [NaN, undefined, Infinity]) {
      assert.strictEqual(scoreToRec(bad), "block", `scoreToRec(${bad}) must fail closed`);
      assert.strictEqual(scoreToLevel(bad), "critical", `scoreToLevel(${bad}) must fail closed`);
    }
  });

  it("cannot be reached with a score below the allow band", () => {
    // -Infinity maps to "allow", which is arithmetically right and unreachable:
    // composition starts at 0 and is escalate-only, so it can never hand the
    // mapping a score below its inputs. That is the property that matters.
    const out = composeComponent(0, { riskScore: -Infinity, riskLevel: "x", riskFactors: [] }, "c", [], 25);
    assert.strictEqual(out, 0, "a negative component score must not drag the running score down");
    assert.ok(composeComponent(40, { riskScore: -1e308, riskLevel: "x", riskFactors: [] }, "c", [], 25) >= 40);
  });

  it("pins the documented band boundaries", () => {
    // docs/DECISION_CONTRACT.md: hosted allow <=30, warn 31-69, block >=70.
    assert.strictEqual(scoreToRec(30), "allow");
    assert.strictEqual(scoreToRec(31), "warn");
    assert.strictEqual(scoreToRec(69), "warn");
    assert.strictEqual(scoreToRec(70), "block");
    assert.strictEqual(scoreToLevel(30), "low");
    assert.strictEqual(scoreToLevel(31), "medium");
    assert.strictEqual(scoreToLevel(60), "medium");
    assert.strictEqual(scoreToLevel(61), "high");
    assert.strictEqual(scoreToLevel(85), "high");
    assert.strictEqual(scoreToLevel(86), "critical");
  });

  it("is monotonic: a higher score never yields a more permissive verdict", () => {
    const rank = { allow: 0, warn: 1, block: 2 };
    let previous = 0;
    for (let score = 0; score <= 100; score++) {
      const current = rank[scoreToRec(score)];
      assert.ok(current >= previous, `scoreToRec became more permissive at ${score}`);
      previous = current;
    }
  });
});
