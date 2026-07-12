# SafeHands deterministic demo

Run:

```bash
npm run demo
# or
npx -y github:SZtch/safehands-pharos --demo
```

The demo is non-destructive. It does not load a private key, does not create a wallet, and does not broadcast transactions.

## What the demo shows

1. `safehands_wallet_health` returns read-only/default wallet status.
2. `safehands_preflight_check` allows a small PROS payment intent on Pharos Pacific Mainnet.
3. `safehands_preflight_check` blocks an unlimited USDC approval.
4. `token_registry_status` recognizes Pacific Mainnet USDC from the active mainnet registry.
5. `safehands_x402_preflight` validates an x402 URL, amount, and Pacific USDC payment token without signing.
6. `x402_pay_and_fetch` fetches a free endpoint without payment.
7. `x402_pay_and_fetch` refuses paid execution while write tools are disabled.
8. SSRF protection blocks localhost/private-IP fetches by default.
9. `send_payment` fails closed because write tools are disabled by default.
10. `explain_risk` returns a human-readable reason for the blocked approval.
11. **Tokenized-asset (RWA) transfer compliance**: an approval on an unregistered asset token with an unverified spender returns `REQUIRE_CONFIRMATION` (risk `MEDIUM`): SafeHands demands human review instead of letting an agent move an unvetted tokenized asset.
12. **Real-Fi settlement cap**: an x402/USDC settlement of 5 USDC over the active policy cap (0.1 USDC, `balanced`) returns `BLOCK` (risk `HIGH`): deterministic spend limits on real-world payment rails that no model can override.

## Expected default network

```json
{
  "environment": "pacific-mainnet",
  "chainId": 1672,
  "isMainnet": true
}
```

## Expected token-registry behavior

Pacific Mainnet USDC should be recognized as canonical:

```json
{
  "symbol": "USDC",
  "status": "CANONICAL_MAINNET_TOKEN",
  "chainId": 1672,
  "environment": "pacific-mainnet",
  "isMainnet": true
}
```

Atlantic/testnet USDC must not be reported as the canonical Pacific Mainnet USDC when the active network is `pacific-mainnet`.

## Expected x402 behavior

Default x402 payment token on Pacific Mainnet is Pacific USDC. Pacific WPROS/PROS-compatible wrapped payment is also supported by the x402 allowlist.

Preflight should pass static checks when the URL is explicitly allowed for the local demo:

```json
{
  "decision": "ALLOW",
  "guardianDecision": "ALLOW",
  "paymentTokenAddress": "0xc879c018db60520f4355c26ed1a6d572cdac1815",
  "signerAvailable": false
}
```

Paid execution should still fail closed by default because `WRITE_TOOLS_ENABLED=false`.

## Manual validation commands

```bash
npm run build
npm test
npm run demo
npm pack --dry-run
```
