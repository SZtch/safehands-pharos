# Contracts v2: design note

> **Status: design note, not scheduled work.** The v1 contracts on Pharos Pacific Mainnet remain the canonical deployment and none of the limitations below is a security vulnerability: v1 holds no funds, signs nothing, and gates no execution on-chain today. This note records what a second iteration should fix and why, so the boundaries of the current design are documented before anyone trips over them. Written 2026-07-12.

## 1. What v1 actually guarantees (and what it does not)

`SafeHandsRegistry` v1 lets an authorized operator commit a Merkle root of risk records (`commitRiskRoot`) and lets anyone verify a record's inclusion against that root (`verifyRiskRecord`). Read the guarantees narrowly:

1. **Single root slot.** `currentMerkleRoot` is one storage slot, overwritten by every commit, and `verifyRiskRecord` checks proofs only against the latest root. Committing batch N+1 therefore invalidates every proof from batch N. Historical roots survive only in `RiskRootCommitted` events, so an off-chain indexer can still verify old batches, but the contract's own view function cannot.
2. **Inclusion, not correctness.** A valid proof shows that SafeHands published this exact record; it does not show the assessment was right. Commits are `onlyOperator`, so the trust chain ends at a single operator: this is a tamper-evident log, not a trustless oracle.
3. **Data availability by mutable URL.** `currentDataURI` is a plain URL chosen by the operator. If the file moves or the host disappears, the committed root becomes unreadable; nothing binds the URL's content to the root except convention.
4. **Long-lived, target-scoped verdicts.** Records default to a 30-day expiry and score a target, not a specific transaction. Chain state moves; a verdict published at time T says nothing certain about time T+1.

`SafeHandsAttestation` v1 has no known design flaw: append-only, hashes-only records with per-agent reputation counts, and it already has live mainnet usage.

## 2. Registry v2

Fixes in order of importance:

- **Committed-root history.** Replace the single slot with `mapping(bytes32 => BatchInfo)` (committed timestamp, dataURI, operator) plus a monotonically increasing batch id. `verifyRiskRecord` accepts any committed root, so proofs stay valid for the life of the chain. An optional "superseded" marker lets the operator signal that a newer batch replaces an older one without breaking old proofs.
- **Content-addressed data availability.** Require the dataURI to be a content hash (IPFS CID) and, ideally, bind that hash in the commit itself. The batch data then cannot change silently, and anyone can re-pin it; availability stops depending on one operator-controlled URL.
- **Revocation.** Verdicts can turn out wrong. A per-leaf revocation registry (or an epoch bump) makes `verifyRiskRecord` fail for a revoked record even with a valid proof, with an event trail explaining when and by whom.
- **Reproducible verdicts.** Each record already binds `policyVersionHash`; add an input-snapshot hash. Because the policy engine is deterministic, a third party holding the snapshot can re-run the published engine version and check that the score matches. That upgrades the registry from "trust what the operator said" to "recompute it yourself if you doubt it", which is a far cheaper path to credibility than multi-operator quorums or staking, and fits what SafeHands already is.

## 3. Intent tickets: where "firewall" becomes literal

The registry answers "what did SafeHands think of target Y?". An execution gate needs a different question answered: "was THIS transaction approved?". That object is an intent ticket:

- binds the hash of the exact transaction parameters (chainId, to, calldata hash, value), not a target address;
- expires in minutes, not days, because verdicts age with chain state;
- is single-use: a nonce consumed at execution so one approval cannot be replayed for a look-alike transaction;
- carries the `policyVersionHash` that approved it.

An execution contract or wallet module then refuses any transaction without a valid, unconsumed ticket. This is the piece that turns a `BLOCK` from advice into enforcement, and it composes with the rest of the planned write-gating v2 set: per-agent spend caps, scoped delegation, and revocation/timelock.

## 4. Attestation: deliberately unchanged, one coupling to decide

Attestation logic needs no v2. But it holds its registry reference as an `immutable` constructor argument and derives operator authorization from it, so a registry v2 deployment forces a choice:

- **Keep attestation pointing at registry v1 (recommended default).** v1 stays on-chain forever and its operator list keeps working. The decisive argument: accumulated reputation (`reputationOf`, `attestationCount`) keeps growing in one place. For a feature whose whole point is an unbroken on-chain track record, continuity beats diagram tidiness.
- **Redeploy attestation linked to v2.** Cleaner wiring, but on-chain history does not migrate: counts restart at zero at the new address and the old record set is stranded at the old one. Only worth it if v2 changes attestation's own authorization needs (for example per-agent scoped attesters).

## 5. Migration posture and non-goals

The contracts are not proxies, on purpose. v2 means new contracts at new addresses; v1 remains live and readable forever. The backend already reads `SAFEHANDS_REGISTRY_ADDRESS` / `SAFEHANDS_ATTESTATION_ADDRESS` from the environment, so repointing requires no code change, and the docs must always state which deployment is canonical.

Non-goals, unchanged from v1: no upgradeable proxies (verifiability stays simple), no custody (v2 never holds keys or funds), no score computation on-chain (the engine stays off-chain and deterministic; the chain stores commitments to its outputs).
