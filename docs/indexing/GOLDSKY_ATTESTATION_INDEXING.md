# SafeHands Goldsky Indexing Design

SafeHands does **not** use Goldsky as the source of truth for attestations.

The source of truth is always Pharos Pacific mainnet:

- `SafeHandsAttestation.sol` records immutable transaction attestations.
- `SafeHandsRegistry.sol` records the latest Merkle risk root and operator/agent authorization.

Goldsky is the fast query/index layer. It indexes on-chain events so users, agents, and dashboards can search SafeHands proofs without scanning the chain manually.

## Flow

```text
SafeHands broadcasts a verified transaction
→ SafeHands waits for receipt success
→ SafeHands calls SafeHandsAttestation.attest(...)
→ contract emits SafeHandsAttested(...)
→ Goldsky indexes the event
→ /attestation/:txHash returns local + Goldsky + contract fallback evidence
```

## Lookup order

`GET /attestation/:txHash` combines three sources:

1. **Local state** — pending/retry lifecycle from the SafeHands worker.
2. **Goldsky** — indexed on-chain `SafeHandsAttested` event for fast lookup.
3. **Contract fallback** — direct RPC read from `SafeHandsAttestation` if Goldsky has not synced yet.

This means Goldsky can be delayed or down without breaking the proof model. The contract remains authoritative.

## New endpoints

```text
GET /goldsky/status
GET /attestation/:txHash
GET /registry/latest
```

`/goldsky/status` shows whether the Goldsky subgraph is configured and what entity names SafeHands will query.

`/registry/latest` attempts to read the latest indexed risk root from Goldsky. If `SAFEHANDS_REGISTRY_REFERENCE_WALLET` is set, it also includes an on-chain registry read.

## Environment

```env
GOLDSKY_ENABLED=true
GOLDSKY_SUBGRAPH_URL=
GOLDSKY_ALLOWED_HOSTS=
GOLDSKY_MAX_QUERY_LENGTH=8000
GOLDSKY_TIMEOUT_MS=10000
GOLDSKY_ATTESTATION_ENTITIES=safeHandsAttesteds,attestations
GOLDSKY_ATTESTATION_TX_HASH_FIELD=txHash
GOLDSKY_RISK_ROOT_ENTITIES=riskRootCommitteds,safeHandsRiskRootCommitteds
SAFEHANDS_REGISTRY_REFERENCE_WALLET=
```

If your Goldsky entity names differ, update `GOLDSKY_ATTESTATION_ENTITIES` and `GOLDSKY_RISK_ROOT_ENTITIES` instead of changing code.

## Security behavior

SafeHands only allows read-only GraphQL queries:

- `mutation` is rejected.
- `subscription` is rejected.
- query length is capped by `GOLDSKY_MAX_QUERY_LENGTH`.
- `GOLDSKY_SUBGRAPH_URL` must be HTTPS unless `GOLDSKY_ALLOW_INSECURE_HTTP=true` is explicitly set for local development.
- private/local hosts are blocked unless `GOLDSKY_ALLOW_PRIVATE_HOSTS=true` is explicitly set for local development.

## Positioning

Use this wording in the demo:

> SafeHands writes attestations on-chain and uses Goldsky as the indexing layer for fast attestation, risk registry, and agent accountability queries. Contract proves it; Goldsky makes it searchable.
