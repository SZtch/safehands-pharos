# Wallet-Ready Transaction Handoff (P10A)

SafeHands supports the **mainnet transaction flow** by preparing **wallet-ready requests**
for external wallets. **The user/client signs and sends externally** — SafeHands never signs,
never broadcasts, never creates or manages a wallet, and holds no key.

Wallet connection happens **outside** SafeHands; SafeHands only **reads** the wallet context
from the request:

- a frontend/dApp connects the wallet and passes `userAddress`,
- an SDK receives `userAddress` from the app,
- a CLI user provides `--from`,
- an MCP/agent host asks the user for wallet approval.

## `POST /wallet/prepare`

Request:

```json
{ "to": "0x...", "data": "0x...", "value": "0", "chainId": 1672, "userAddress": "0x<wallet>" }
```

(`from` is accepted as an alias for `userAddress`.)

Behavior:

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
| `CONNECT_WALLET_OR_PROVIDE_ADDRESS` | No wallet context — connect a wallet or pass `userAddress`/`from`. |
| `SIGN_IN_EXTERNAL_WALLET` | Wallet-ready request prepared — sign + send it in your own wallet. |
| `REVIEW_FIRST` | Confirmation required — review before signing. |
| `STOP` | Blocked — do not proceed. |

The endpoint is read-only: `signingAvailable: false`, `broadcastAvailable: false`,
`readOnly: true`, `executionAvailable: false`. Activity is sanitized — the `walletRequest`,
the wallet address, and full calldata are never written to the public activity feed.

## What P10A does NOT do

No backend signing, no backend broadcast, no ENV private-key execution, no wallet creation,
no custody, no WalletConnect UI. SafeHands only reads wallet context and returns a request the
**external** wallet signs and sends.

