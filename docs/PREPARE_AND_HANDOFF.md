# SafeHands: Prepare-only mode & wallet-ready handoff

Two read-only endpoints let SafeHands run a real safety check and then hand back something the
**user signs and sends externally**. SafeHands holds **no keys**: it never signs, never
broadcasts, never creates or manages a wallet, and never publishes on-chain. `executionAvailable`,
`signingAvailable`, `managedWalletAvailable`, and broadcast all stay **false** on both paths.
Future paid endpoints use x402, not these.

- **`POST /prepare/tx`** returns an UNSIGNED transaction object (no wallet context needed).
- **`POST /wallet/prepare`** returns a wallet-ready request bound to a caller-supplied address.

---

## `POST /prepare/tx` (prepare-only)

Builds an **UNSIGNED transaction request object** after a real SafeHands check. The caller signs
and broadcasts externally with their own wallet.

### Flow
1. Validate the caller's intended call (`to` valid + non-zero, `data` hex, `value` ≥ 0).
2. Run the real **escalate-only** SafeHands check (policy presets apply; a `BLOCK` is never weakened).
3. **If the verdict is `BLOCK`** → prepare nothing (`preparedTransaction: null`, `decision: BLOCK`,
   `requiresUserSignature: false`).
4. **Otherwise** → return the unsigned tx + `requiresUserSignature: true` and `decision: PREPARE_ONLY`.
   A `REQUIRE_CONFIRMATION` underlying verdict is surfaced as `confirmationRequired: true`.

### Request
```jsonc
POST /prepare/tx
{ "to": "0x…", "data": "0x…"?, "value": "0"?, "chainId": 1672?, "policyPreset": "strict"? }
```

### Response (inside the `ok()` envelope → `data`)
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

### Guarantees
- **No signing/broadcast/keys/wallets/publishing** (boundary-tested: no signer/write primitives
  in `prepareRoutes.ts`).
- **A BLOCK is never prepared** (escalate-only SafeHands check).
- Capability flags: `prepareTxAvailable: true`; `signingAvailable` / `userSignedBroadcastAvailable`
  / `managedWalletAvailable` / `onchainPublishingAvailable` / `premiumEndpointsAvailable` /
  `x402PaidEndpointsAvailable` stay **false**.

---

## `POST /wallet/prepare` (wallet-ready handoff)

Prepares **wallet-ready requests** for external wallets. Wallet connection happens **outside**
SafeHands; SafeHands only **reads** the wallet context from the request:

- a frontend/dApp connects the wallet and passes `userAddress`,
- an SDK receives `userAddress` from the app,
- a CLI user provides `--from`,
- an MCP/agent host asks the user for wallet approval.

### Request
```json
{ "to": "0x...", "data": "0x...", "value": "0", "chainId": 1672, "userAddress": "0x<wallet>" }
```

(`from` is accepted as an alias for `userAddress`.)

### Behavior
- **No `userAddress`/`from`** → `requiresWalletConnection: true`,
  `nextAction: "CONNECT_WALLET_OR_PROVIDE_ADDRESS"`, `walletRequest: null`.
- **Wallet provided + not blocked** → `walletRequest` for external signing/sending:

  ```json
  { "from": "0x<wallet>", "to": "0x...", "data": "0x...", "value": "0", "chainId": 1672 }
  ```

- **BLOCK** → `walletRequest: null`, `nextAction: "STOP"` (a BLOCK never produces a request).
- **REQUIRE_CONFIRMATION** → `confirmationRequired: true`, `nextAction: "REVIEW_FIRST"`
  (the review signal is preserved); the wallet request is still provided for the wallet to
  show the user.

Decisions stay within the public contract: `ALLOW`, `BLOCK`, `REQUIRE_CONFIRMATION`,
`PREPARE_ONLY`. `nextAction` is a UX hint, never a substitute for the decision:

| nextAction | Meaning |
|---|---|
| `CONNECT_WALLET_OR_PROVIDE_ADDRESS` | No wallet context; connect a wallet or pass `userAddress`/`from`. |
| `SIGN_IN_EXTERNAL_WALLET` | Wallet-ready request prepared; sign + send it in your own wallet. |
| `REVIEW_FIRST` | Confirmation required; review before signing. |
| `STOP` | Blocked; do not proceed. |

The endpoint is read-only: `signingAvailable: false`, `broadcastAvailable: false`,
`readOnly: true`, `executionAvailable: false`. Activity is sanitized: the `walletRequest`,
the wallet address, and full calldata are never written to the public activity feed.

### What it does NOT do
No backend signing, no backend broadcast, no ENV private-key execution, no wallet creation,
no custody, no WalletConnect UI. SafeHands only reads wallet context and returns a request the
**external** wallet signs and sends.

---

## Shared access, quota & policy

Both endpoints flow through the same middleware as the rest of the API: request-id, **scoped
access** (scopes `prepare:tx` / `wallet:prepare`, both in the default read bundle; gated only in
require-key mode), **tiered quota** (`X-RateLimit-*`), and **policy presets**
(`SAFEHANDS_POLICY_PRESET` / request `policyPreset`, tighten-only). The public read API stays open
by default. Each request records a **sanitized** activity item (coarse target: 4-byte selector +
shortened address); never the full calldata, the `preparedTransaction`, or the `walletRequest`.
