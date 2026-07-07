> [!NOTE]
> Pharos Pacific Mainnet (chain `1672`) is the default and live network. Any Atlantic Testnet (`688689`) references below are legacy/secondary context.

# SafeHands — Optional ZAN RPC Provider (Phase 5C)

> **ZAN RPC is optional and never required.** The hosted default uses the public Pharos
> RPC. If ZAN (or another provider) env vars are set, SafeHands uses them for read-only
> calls — but **secrets are never exposed through public config**. SafeHands holds no
> keys and never hardcodes a premium/keyed URL.
>
> Source of truth: official Pharos ZAN docs (`docs.pharos.xyz/tooling-and-infrastructure/rpc/zan`)
> and the Phase 5A audit. Status legend: **IMPLEMENTED** · **EXPERIMENTAL** · **ROADMAP**
> · **TO_VERIFY** · **NOT_IMPLEMENTED**.

---

## 1. ZAN as an optional provider — IMPLEMENTED (env-only)

ZAN supports Pharos mainnet + testnet. Official URL format (API key required):

```
https://api.zan.top/node/v1/pharos/{mainnet|testnet}/{apikey}
```

SafeHands reads provider URLs from the environment only. RPC URL resolution precedence
(mainnet) in `src/lib/networks.ts` `resolveRpcUrl`:

1. `PHAROS_MAINNET_RPC_URL`
2. `ZAN_PHAROS_MAINNET_RPC_URL` or `PHAROS_ZAN_RPC_URL` *(alias, added 5C)*
3. `ALCHEMY_PHAROS_MAINNET_RPC_URL`
4. `NIRVANA_PHAROS_MAINNET_RPC_URL`
5. the public, key-free default RPC (`https://rpc.pharos.xyz`)

(Atlantic: `PHAROS_ATLANTIC_RPC_URL` → public default.) An optional
`PHAROS_RPC_PROVIDER` label may name a custom provider for evidence purposes only.

## 2. Secrets are never exposed — IMPLEMENTED

Public/status responses include only a **redacted** provider descriptor
(`resolveRpcProvider` → `rpcEvidence.provider`):

```
provider: { name: "zan" | "alchemy" | "nirvana" | "custom" | "pharos-public",
            configuredViaEnv: boolean, usingPublicDefault: boolean, secretsRedacted: true }
```

- The **URL and API key are never included** in any payload.
- `GET /public-config` still emits only the hardcoded **public** default RPC
  (`network.defaultRpcUrl`), never `resolveRpcUrl()`/env values.
- Offline tests plant a fake premium RPC URL **and** a fake ZAN URL and assert neither
  appears in `/public-config`, `/infra/status`, `/guardian/check`, or agent payloads.

## 3. Defaults & live checks

- **Hosted default:** public Pharos RPC; ZAN is not required.
- **Live read-only checks** are off by default. Enable with
  `SAFEHANDS_LIVE_MAINNET_CHECK=true` plus a dedicated
  `SAFEHANDS_LIVE_MAINNET_RPC_URL` (kept separate from planted test env). The optional
  live check asserts `eth_chainId === 1672` via the read-only adapter.

## 4. Hard rules

Do not hardcode premium RPC keys. Do not expose env secrets. ZAN/Alchemy/Nirvana are
optional read-only providers — they add **no** execution, signing, wallet, or key
capability. The read-only method whitelist applies regardless of provider.

