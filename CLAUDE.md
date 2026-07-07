# CLAUDE.md — SafeHands (Pharos)

Guidance + resume-context for Claude working in this repo. **Read this first.**

## What SafeHands is
A **pre-execution security & policy layer for autonomous agent finance on Pharos Pacific Mainnet (chain 1672)**. Before an agent signs / approves / swaps / pays, a deterministic policy engine returns `ALLOW` / `BLOCK` / `REQUIRE_CONFIRMATION` / `PREPARE_ONLY`. Zero-custody: never holds keys, never signs.

## ⚠️ TWO separate codebases in ONE repo — do not conflate them
1. **`anvita/safehands/`** — the **Anvita Flow hosted skill** = the hackathon deliverable. A standalone, **zero-dependency** engine (`scripts/safehands-engine.js`) that reads Pharos RPC + GoPlus directly. Read-only, no backend, no keys. **Does NOT import `src/`.** Package with `npm run package:anvita` → `dist/safehands.zip`.
2. **`src/`** — the full TypeScript product: **MCP server + CLI + npm SDK + HTTP API + x402 + attestation**, compiled to `dist/`. IMPORTANT: **MCP, CLI, and SDK ARE this** (`package.json` `bin`/`main`/`exports` → `dist/index.js`). **Deleting `src/` kills all three.**

## 🎯 Anvita Agent Carnival — Phase 2 hosting rule (authoritative, from organizers, 2026-07-07)
> "The service agent will be hosted by Anvita Flow, not your own local cloud. Developers should go to our developer platform to upload the skills, and we'll package the skills and provide agent runtime."

- Deliverable = the **skill uploaded to Anvita's dev platform**; Anvita provides the runtime.
- The agent must NOT depend on your own backend/cloud → **Railway / self-hosted backend must NOT be presented as the service agent.**
- `anvita/safehands/` already complies (zero backend; public RPC + GoPlus only).
- MCP/CLI/SDK do **not** break the rule (they're developer self-host/distribution, not the hosted agent) — keeping them is fine; just don't frame them as the Anvita agent.

## ✅ DONE — Option A executed (2026-07-07): Railway story removed, `src/` kept as self-host reference
User chose **Option A**. `src/` (MCP/CLI/SDK/HTTP API) kept as open-source reference / optional self-host; Anvita skill is the star. The Railway/own-cloud deploy story is fully removed and docs reframed to generic self-host.
- **Deleted:** `railway.json`, `Procfile`, `docs/RAILWAY_DEPLOYMENT.md`, `docs/RAILWAY_SMOKE_TESTS.md`, `docs/deployment/RAILWAY_ZERO_CUSTODY_ENV.md`, `scripts/railway-smoke-test.mjs`, and the `railway:smoke` npm script. (Backups were in the session scratchpad only — not restorable long-term since this isn't a git repo.)
- **Reframed** (no dead URL / no broken link left): README (self-host heading), `REVIEWER_QUICKSTART` + `SAFEHANDS_REVIEWER_DEMO_SCRIPT` (shipped docs → Anvita agent + `npx --demo` + `localhost:4022`), INDEX, PRODUCTION_BACKEND, REFERENCES, ANVITA_FLOW, REALFI_RWA_ALIGNMENT, SECURITY, OBSERVABILITY_AND_ACTIVITY, ACCESS_CONTROL, PREPARE_TRANSACTION; **full host-agnostic rewrite** of `docs/deployment/ARCHITECTURE_DECISION.md` + `FULL_SERVICE_DESIGN.md`. Dockerfile comments softened (Dockerfile kept). `.gitignore` internal-docs block restored.
- **Deliberately NOT changed:** `src/` code untouched. The public API field name `railwayReady` is **KEPT** (renaming would break the `/public-config` capability contract of the live API); docs keep the literal identifier. This is the only remaining "railway" token, plus generic `Railway/Fly/VPS` example-host comments in `src/`.
- **Verified green end-to-end (this session):** `tsc` build exit 0; MCP stdio handshake → **33 tools** (8/8 write + all read, none missing); CLI `--help`/`skill` list; READ preflight → `BLOCK`; WRITE gated (`WRITE_TOOLS_DISABLED`; with `WRITE_TOOLS_ENABLED=true` → advances to `NO_SIGNER_AVAILABLE`, pipeline intact); HTTP API `/health` + `/public-config` (chain 1672) + gated write route; `npm pack --dry-run` + `package:anvita` (`dist/safehands.zip`, `unzip -t`) OK. **SDK caveat:** `src/index.ts` has no top-level `export`, so `import('safehands-pharos')` yields no named exports — pre-existing, unchanged; the real programmatic surface is the `safehands skill <tool>` CLI.

## ✅ Already done — audit Phase 2 (do NOT redo)
A full strict audit + minimal fixes were applied and **verified green**:
- Fixed the fresh-clone build (was broken: `src/api/server.ts` imported missing `./demoPage.js`; real file is `consolePage.ts`).
- Added secret-free `.env.example`; repointed `package:anvita` to the lean packager (`scripts/package-anvita-safehands.mjs`) and deleted the misleading full-backend `package-anvita.mjs`; fixed `package.json` `files[]`; renamed `.agents/policies/a.json` → `default.json`; corrected README/quickstart overclaims (removed unverifiable "19 offline tests" claim; honest `npm test` = live-RPC wording; roadmap → v2.3.0); fixed `Dockerfile` (`--ignore-scripts` on both `npm ci`, `EXPOSE` 4022).
- Verified: `npm ci` / build / `npm test` (12/12) / `npm run demo` / `package:anvita` / `unzip -t` / `npm pack --dry-run` / `docker build`+run(`/health`) / compiled CLI — all pass. Prod-dep `npm audit` = 0 vulns (the 2 high are dev-only Hardhat).
- Clean GitHub-publish zip already built at `dist/safehands-pharos-github.zip` (excludes internal docs + build artifacts + secrets).

## 🔒 Internal docs — NEVER publish to public GitHub
`docs/pitch/` (all), `docs/deployment/DESIGN_DECISION_REGISTER.md`, `docs/deployment/PHASE_D_LIVE_MAINNET_RUNBOOK.md`, `docs/deployment/NPM_PUBLISH_CHECKLIST.md`.
✅ The `.gitignore` "Internal docs" block is now **restored** (2026-07-07) — these stay out of any `git push`. Rule: publish only external-audience docs (reviewers/judges/users); keep pitch strategy, operator runbooks, and work-tracking local.

## Build / verify
`npm ci` (runs build via `prepare`) · `npm run build` · `npm test` (12 tests; **uses live Pharos RPC**, never broadcasts) · `npm run demo` (12 non-destructive scenarios) · `npm run package:anvita` → `dist/safehands.zip` · `docker build` (optional self-host backend image; **default port 4022**, set `PORT` for your host).

## Guardrails
- **Never invent or alter on-chain addresses** — Registry `0x428e02bf…8b06c8d`, Attestation `0x71a7a87b…5b4588c`, chain `1672`. Verify on Pharosscan; do not fabricate.
- **No secrets in the repo** — `.env.example` = placeholders only.
- Keep changes **minimal & submission-oriented**; don't redesign or add major features (LP manager, paymaster, new contracts/chains, wallet infra) without explicit user approval.
- **Keep the build green:** `tsconfig` has `noEmitOnError`, so a single missing-module import (e.g. a renamed file whose import wasn't updated) breaks `npm ci` everywhere. Watch for this.

## Key facts / state
- Railway/own-cloud deploy story removed (Option A, 2026-07-07). We present **no hosted HTTP API of our own** — the hosted agent is the Anvita skill; `src/`'s HTTP API is optional self-host only. (An external Railway instance may still be running at v2.2.0; it's no longer part of the repo story — tear it down when convenient.)
- Anvita agent (per prior notes): "SafeHands Agent" `agent_7UCLA5MLTGNE` — **NOT live yet** (confirmed 2026-07-07). Verify it's actually live/registered before any "live on Anvita" claim.
- **Pitch deck (`docs/pitch/SAFEHANDS_PITCH_DECK.html`) still carries the old Railway URL/story — intentionally deferred** until the Anvita agent is live (can't yet make an honest "live on Anvita" claim; don't swap a dead URL for an unverified one). Update it to Anvita-first + local demo (`npx --demo` / `localhost:4022`) once the agent is registered. Internal DDR + Phase-D runbook were reconciled 2026-07-07 (Option A banner + host-agnostic).
- Contracts (`SafeHandsRegistry.sol`, `SafeHandsAttestation.sol`) are sound: `Ownable2Step`, renounce disabled, double-hashed Merkle leaves, immutable privacy-preserving attestation.
