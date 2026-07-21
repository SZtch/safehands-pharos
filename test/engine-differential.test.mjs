// ─── Cross-engine differential: TS analyzer vs hosted Anvita engine ────────
// SafeHands ships the same calldata safety logic TWICE: the TypeScript analyzer
// behind the MCP/HTTP surfaces (src/lib/analysis/calldata.ts + approval.ts) and
// a standalone hand-ported reimplementation inside the hosted skill
// (anvita/safehands/scripts/safehands-engine.js). They are synchronized by hand,
// which is exactly how two false-ALLOW bugs reached a release: the v2.4.2 intent
// composition dilution and the v2.7.0 proxy-shell codehash match. Both were
// caught by manual audit; no test could see them, because no test compared the
// two engines to each other.
//
// This file is that comparison. For identical calldata it asserts three layers:
//
//   A. Decode facts are IDENTICAL. Reading bytes is not a policy choice, so a
//      difference in method/spender/amount/unlimited is a bug in one of them.
//   B. Counterparty recognition is IDENTICAL. The two sides reach the registry
//      by different routes (TS: canonicalContractEvidence + addressTrustEvidence;
//      hosted: the generated known-pharos.json), and that single boolean is what
//      separates "unlimited approval blocked at 90" from "warned at 65". This
//      catches asset-generation drift that sync:anvita:check cannot see, because
//      that check compares JSON to registry, never classifier to classifier.
//   C. Verdict severity is IDENTICAL once mapped onto one ordinal, with every
//      accepted difference listed in DOCUMENTED_DIVERGENCES below. Silence is
//      never an accepted difference.
//
// Both decoders are pure and offline, so this runs in-process with no RPC mock.
// Env is pinned locally: CI exports job-wide vars (see .github/workflows/ci.yml).
// ───────────────────────────────────────────────────────────────────────────
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeCalldata } from "../src/lib/analysis/calldata.js";
import { analyzeTxCalldata, classifyCounterparty } from "../anvita/safehands/scripts/safehands-engine.js";

const KNOWN = JSON.parse(readFileSync(new URL("../anvita/safehands/assets/known-pharos.json", import.meta.url), "utf8"));
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const CANON = Object.keys(KNOWN.canonicalContracts).find((a) => a !== PERMIT2);
const UNKNOWN = "0x4444444444444444444444444444444444444444";
const RECIPIENT = "0x5555555555555555555555555555555555555555";

const SEL = {
  approve: "0x095ea7b3", permit: "0xd505accf", permit2Approve: "0x87517c45",
  setApprovalForAll: "0xa22cb465", transferFrom: "0x23b872dd", transfer: "0xa9059cbb",
  increaseAllowance: "0x39509351", decreaseAllowance: "0xa457c2d7",
  transferOwnership: "0xf2fde38b", renounceOwnership: "0x715018a6",
  upgradeTo: "0x3659cfe6", upgradeToAndCall: "0x4f1ef286", changeAdmin: "0x8f283970",
};

// ── word builders ──────────────────────────────────────────────────────────
const clean = (a) => "0".repeat(24) + a.replace(/^0x/, "").toLowerCase();
// Dirty upper padding: solc's ABI decoder reverts on it, and a decoder that
// silently masks it reports a normal-looking address for malformed calldata.
const dirty = (a) => "0".repeat(20) + "dead" + a.replace(/^0x/, "").toLowerCase();
const u = (n) => BigInt(n).toString(16).padStart(64, "0");
const MAX_UINT256 = "f".repeat(64);
const PERMIT2_MAX = ((1n << 160n) - 1n).toString(16).padStart(64, "0");

// ── ordinal mapping (docs/DECISION_CONTRACT.md) ────────────────────────────
// Hosted bands: <=30 allow, 31-69 warn, >=70 block.
const ORD = { allow: 0, warn: 1, block: 2 };
const ORD_NAME = ["allow", "warn", "block"];
const tsOrdinal = (r) => ({ ALLOW: ORD.allow, REQUIRE_CONFIRMATION: ORD.warn, BLOCK: ORD.block })[r.internalDecision] ?? ORD.warn;
const engineOrdinal = (c) => (c.floor >= 70 ? ORD.block : c.floor >= 31 ? ORD.warn : ORD.allow);

/**
 * Differences that are intentional and reviewed. Anything not listed here must
 * match. Keyed by the fact name; the predicate receives the case name.
 *
 * This list is deliberately EMPTY: as of the 2026-07 hardening round the two
 * engines agree on every decode fact, every counterparty recognition and every
 * verdict across this corpus. An entry here is a hole where real drift can hide,
 * so add one only with a reason that survives review, never to quiet a failure.
 */
const DOCUMENTED_DIVERGENCES = [];
const isDocumented = (fact, name) =>
  DOCUMENTED_DIVERGENCES.some((d) => d.fact === fact && d.applies(name));

// Facts that describe what the bytes say. No policy judgement lives here.
const DECODE_FACTS = ["method", "category", "spender", "operator", "recipient", "from", "amountRaw", "unlimited", "isRevoke", "approved"];
const normalize = (v) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v ?? null);

/** Run both engines over the same bytes and report every difference found. */
function compare(name, data) {
  const ts = analyzeCalldata(data);
  const engine = analyzeTxCalldata(data, null);
  const problems = [];

  for (const fact of DECODE_FACTS) {
    if (isDocumented(fact, name)) continue;
    const a = normalize(ts.details[fact]);
    const b = normalize(engine[fact]);
    if (a !== b) problems.push(`decode fact "${fact}": TS=${a} hosted=${b}`);
  }

  if (ts.details.counterpartyKnown !== engine.counterpartyKnown) {
    problems.push(`counterpartyKnown: TS=${ts.details.counterpartyKnown} hosted=${engine.counterpartyKnown}`);
  }

  const a = tsOrdinal(ts);
  const b = engineOrdinal(engine);
  if (a !== b) {
    const direction = a < b ? "TS IS MORE PERMISSIVE" : "hosted is more permissive";
    problems.push(`verdict: TS=${ORD_NAME[a]} hosted=${ORD_NAME[b]} (floor ${engine.floor}) <<< ${direction}`);
  }
  return problems;
}

function assertAgree(name, data) {
  const problems = compare(name, data);
  assert.deepStrictEqual(problems, [], `${name}\n  calldata: ${data.slice(0, 90)}${data.length > 90 ? "…" : ""}\n  ${problems.join("\n  ")}`);
}

// ── corpus ─────────────────────────────────────────────────────────────────
const AMOUNTS = [["limited", u(1000)], ["unlimited", MAX_UINT256], ["revoke", u(0)]];
const PARTIES = [["unknown", UNKNOWN], ["canonical", CANON], ["permit2", PERMIT2]];
const PADDINGS = [["clean", clean], ["dirty", dirty]];

function buildCorpus() {
  const cases = [];
  const add = (name, data) => cases.push({ name, data });

  for (const [who, addr] of PARTIES) {
    for (const [pad, mk] of PADDINGS) {
      for (const [amt, word] of AMOUNTS) {
        add(`approve ${who}/${pad}/${amt}`, SEL.approve + mk(addr) + word);
        add(`increaseAllowance ${who}/${pad}/${amt}`, SEL.increaseAllowance + mk(addr) + word);
        add(`decreaseAllowance ${who}/${pad}/${amt}`, SEL.decreaseAllowance + mk(addr) + word);
        add(`permit ${who}/${pad}/${amt}`, SEL.permit + clean(UNKNOWN) + mk(addr) + word + u(0) + u(27) + u(1) + u(2));
      }
      add(`permit2Approve ${who}/${pad}/unlimited`, SEL.permit2Approve + clean(UNKNOWN) + mk(addr) + PERMIT2_MAX + u(0));
      add(`permit2Approve ${who}/${pad}/limited`, SEL.permit2Approve + clean(UNKNOWN) + mk(addr) + u(1000) + u(0));
      add(`permit2Approve ${who}/${pad}/revoke`, SEL.permit2Approve + clean(UNKNOWN) + mk(addr) + u(0) + u(0));
      add(`setApprovalForAll ${who}/${pad}/granted`, SEL.setApprovalForAll + mk(addr) + u(1));
      add(`setApprovalForAll ${who}/${pad}/revoked`, SEL.setApprovalForAll + mk(addr) + u(0));
    }
  }
  for (const [pad, mk] of PADDINGS) {
    add(`transfer ${pad}`, SEL.transfer + mk(RECIPIENT) + u(1000));
    add(`transferFrom ${pad}`, SEL.transferFrom + clean(UNKNOWN) + mk(RECIPIENT) + u(1000));
    add(`transferOwnership ${pad}`, SEL.transferOwnership + mk(UNKNOWN));
    add(`upgradeTo ${pad}`, SEL.upgradeTo + mk(UNKNOWN));
    add(`changeAdmin ${pad}`, SEL.changeAdmin + mk(UNKNOWN));
    add(`upgradeToAndCall ${pad}`, SEL.upgradeToAndCall + mk(UNKNOWN) + u(64) + u(4) + "12345678".padEnd(64, "0"));
  }
  add("renounceOwnership", SEL.renounceOwnership);
  add("unrecognized selector", "0xdeadbeef" + u(1));
  add("approve truncated payload", SEL.approve + clean(UNKNOWN));
  add("approve oversized payload", SEL.approve + clean(UNKNOWN) + u(1) + u(1));
  add("selector only", SEL.approve);
  return cases;
}

// Deterministic PRNG so a fuzz failure is replayable from the printed seed.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENV_KEYS = ["SAFEHANDS_RECIPIENT_DENYLIST"];
const saved = {};

describe("cross-engine differential: TS analyzer vs hosted engine", () => {
  before(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; }
    // Both sides parse the denylist per call; pin it empty so neither side sees
    // an operator list the other does not.
    process.env.SAFEHANDS_RECIPIENT_DENYLIST = "";
  });
  after(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("uses a real canonical contract from the shipped asset", () => {
    assert.ok(CANON, "known-pharos.json must contain a canonical contract besides Permit2");
  });

  describe("structured corpus", () => {
    for (const { name, data } of buildCorpus()) {
      it(name, () => assertAgree(name, data));
    }
  });

  it("agrees on 400 pseudo-random payloads across every shared selector", () => {
    const seed = Number(process.env.DIFFERENTIAL_SEED || 0x5afe4a4d);
    const rnd = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const addrs = [UNKNOWN, CANON, PERMIT2, RECIPIENT, "0x" + "0".repeat(40)];
    const amounts = [u(0), u(1), u(1000), MAX_UINT256, PERMIT2_MAX, u((1n << 255n).toString()), u(((1n << 255n) - 1n).toString())];
    const failures = [];

    for (let i = 0; i < 400; i++) {
      const selName = pick(Object.keys(SEL));
      const mk = rnd() < 0.3 ? dirty : clean;
      const addr = pick(addrs);
      const amt = pick(amounts);
      let data;
      switch (selName) {
        case "permit": data = SEL.permit + mk(pick(addrs)) + mk(addr) + amt + u(0) + u(27) + u(1) + u(2); break;
        case "permit2Approve": data = SEL.permit2Approve + mk(pick(addrs)) + mk(addr) + amt + u(0); break;
        case "setApprovalForAll": data = SEL.setApprovalForAll + mk(addr) + u(rnd() < 0.5 ? 1 : 0); break;
        case "transferFrom": data = SEL.transferFrom + mk(pick(addrs)) + mk(addr) + amt; break;
        case "renounceOwnership": data = SEL.renounceOwnership; break;
        case "upgradeToAndCall": data = SEL.upgradeToAndCall + mk(addr) + u(64) + u(4) + "12345678".padEnd(64, "0"); break;
        case "transferOwnership": case "upgradeTo": case "changeAdmin": data = SEL[selName] + mk(addr); break;
        default: data = SEL[selName] + mk(addr) + amt; break;
      }
      const name = `fuzz#${i} ${selName}`;
      const problems = compare(name, data);
      if (problems.length) failures.push(`${name} (${data.slice(0, 74)}…)\n    ${problems.join("\n    ")}`);
    }

    assert.deepStrictEqual(
      failures, [],
      `seed ${seed} (re-run with DIFFERENTIAL_SEED=${seed}); ${failures.length} divergent payload(s):\n  ${failures.slice(0, 12).join("\n  ")}`
    );
  });
});

describe("counterparty recognition parity", () => {
  // The single boolean that decides block-vs-warn on an unlimited approval. TS
  // reaches it through the registry, the hosted engine through the generated
  // asset; drift between those two routes is invisible to sync:anvita:check.
  it("agrees for every canonical address in the shipped asset", () => {
    const mismatches = [];
    for (const addr of Object.keys(KNOWN.canonicalContracts)) {
      const data = SEL.approve + clean(addr) + u(1000);
      const ts = analyzeCalldata(data).details.counterpartyKnown;
      const engine = classifyCounterparty(addr).known;
      if (ts !== engine) mismatches.push(`${addr} (${KNOWN.canonicalContracts[addr]}): TS=${ts} hosted=${engine}`);
    }
    assert.deepStrictEqual(mismatches, [], `counterparty recognition drift:\n  ${mismatches.join("\n  ")}`);
  });

  it("agrees that unrelated addresses are not known", () => {
    for (const addr of [UNKNOWN, RECIPIENT, "0x" + "9".repeat(40)]) {
      const data = SEL.approve + clean(addr) + u(1000);
      assert.strictEqual(
        analyzeCalldata(data).details.counterpartyKnown, classifyCounterparty(addr).known,
        `recognition drift for ${addr}`
      );
    }
  });
});
