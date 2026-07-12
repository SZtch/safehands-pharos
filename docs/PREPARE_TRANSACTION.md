# SafeHands: Prepare-Only Transaction Mode (P9)

`POST /prepare/tx` builds an **UNSIGNED transaction request object** after a real SafeHands
check. SafeHands holds **no keys**: it **never signs, never broadcasts, never creates/manages a
wallet, and never publishes on-chain**. Hosted (Anvita Flow) and self-hosted read-only modes stay read-only; `executionAvailable`,
`signingAvailable`, `managedWalletAvailable`, and broadcast all remain **false**. Future paid
endpoints use x402 (not this).

---

## Flow
1. Validate the caller's intended call (`to` valid + non-zero, `data` hex, `value` ≥ 0).
2. Run the real **escalate-only** SafeHands check (policy presets apply; a `BLOCK` is never weakened).
3. **If the verdict is `BLOCK`** → prepare nothing (`preparedTransaction: null`, `decision: BLOCK`,
   `requiresUserSignature: false`).
4. **Otherwise** → return the unsigned tx + `requiresUserSignature: true` and `decision: PREPARE_ONLY`.
   A `REQUIRE_CONFIRMATION` underlying verdict is surfaced as `confirmationRequired: true`.

The caller signs + broadcasts externally with their own wallet.

## Request
```jsonc
POST /prepare/tx
{ "to": "0x…", "data": "0x…"?, "value": "0"?, "chainId": 1672?, "policyPreset": "strict"? }
```

## Response (inside the `ok()` envelope → `data`)
```jsonc
{
  "decision": "PREPARE_ONLY",            // or "BLOCK"
  "guardianDecision": "ALLOW",           // underlying 4-decision verdict
  "riskLevel": "LOW",
  "reasons": [ … ],
  "confirmationRequired": false,
  "requiresUserSignature": true,         // false on BLOCK
  "preparedTransaction": {
    "to": "0x…", "data": "0x…", "value": "0", "chainId": 1672,
    "from": null,                        // SafeHands holds no keys
    "unsigned": true, "signature": null
  },
  "network": "pacific-mainnet", "chainId": 1672,
  "policyPreset": "agent", "policyVersion": "p8c-2026.06",
  "signingAvailable": false, "broadcastAvailable": false,
  "readOnly": true, "executionAvailable": false,
  "nextStep": "Review, then sign … externally. SafeHands holds no keys, signs nothing, broadcasts nothing.",
  "source": "prepare_tx"
}
```

## Access, quota & policy
`/prepare/tx` flows through the same middleware as the rest of the API: request-id, **scoped
access** (scope `prepare:tx`, in the default read bundle; gated only in require-key mode),
**tiered quota** (`X-RateLimit-*`), and **policy presets** (`SAFEHANDS_POLICY_PRESET` / request
`policyPreset`, tighten-only). Public read API stays open by default.

## Activity
A prepare request records a **sanitized** activity item (coarse target: 4-byte selector +
shortened address); never the full calldata and never the `preparedTransaction` object.

## Guarantees
- **No signing/broadcast/keys/wallets/publishing** (boundary-tested: no signer/write primitives
  in `prepareRoutes.ts`).
- **A BLOCK is never prepared** (escalate-only SafeHands check).
- Capability flags: `prepareTxAvailable: true`; `signingAvailable` / `userSignedBroadcastAvailable`
  / `managedWalletAvailable` / `onchainPublishingAvailable` / `premiumEndpointsAvailable` /
  `x402PaidEndpointsAvailable` stay **false**.

