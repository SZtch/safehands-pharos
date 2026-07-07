# Known Improvements & Applied Hardening

## Applied in v2.3.0 (verify on first build)
MCP hardening is now IN the code (`src/index.ts`), applied without a local compiler — so the very first `npm run build` after cloning is the verification gate. If it ever fails, these are the only unverified lines; revert with `git checkout src/index.ts`.

1. **Entry guard** — importing the package no longer auto-starts the MCP server (`invokedDirectly` check via `pathToFileURL`). Running the bin/CLI is unchanged.
2. **Explicit shutdown** — `transport.onclose` + SIGINT/SIGTERM handlers exit cleanly when the MCP client disconnects.
3. **Help text** — install/usage examples in `--help` now use the working `npx github:SZtch/safehands-pharos` form (registry form becomes valid again after `npm publish`).

## Contract-layer note (found in design review)
`SafeHandsRegistry.verifyRiskRecord` proves records against the **single** `currentMerkleRoot` — by design a "current risk snapshot", not an append-only history. The flush tooling, however, builds each tree from the *pending queue only*, so committing a new batch drops prior records from on-chain verifiability. Fix is operational (no contract change): make the flush build a **cumulative tree** of all non-expired records each commit, so the current root always covers the full live set.

## Engine roadmap (`anvita/safehands/`)
- Parallelize the two GoPlus token lookups inside swap-intent analysis.
- Calibrate risk weights against real incident data once Pharos accumulates it.
- Phishing-URL check (GoPlus + typosquat detection against official Pharos domains).
- Publish/attest capabilities the moment the hosted platform supports agent-side writes — contracts (`onlyOperator`, multi-operator) and Merkle batching are already deployed and waiting.
