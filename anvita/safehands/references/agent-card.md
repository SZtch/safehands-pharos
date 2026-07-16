# Anvita Flow Agent Card: SafeHands

Copy these values into the Anvita Flow Developer Console when completing the Agent Card.

## Agent name

SafeHands

## One-sentence introduction

SafeHands is the transaction firewall for AI agent finance on Pharos: safety infrastructure that checks token, approval, contract, bridge, vault, staking, tokenized-asset, gas, transaction, and x402 payment risk before an agent signs or moves capital.

## Capability description

SafeHands is safety infrastructure (the transaction firewall) for AI agent finance on Pharos. Hosted here it runs in no-custody mode: read-only verdicts before the signature, never execution. It checks token, approval, contract, bridge, vault, staking, tokenized asset, gas, transaction, and x402 payment risks before an agent signs or moves capital, and decodes approval/transfer/admin calldata offline (unlimited-approval detection, blanket operator grants, dangerous-admin calls, MultiSend batches). Zero-custody and read-only, it evaluates wallet, token, contract, and transaction-intent risk, including RealFi actions (bridges, vault/yield deposits, staking, tokenized assets, x402 payments), and returns a structured risk score, detected risk factors, explanation, and an allow/warn/block verdict for AI agent finance on Pharos Pacific Mainnet. It also serves read-only market and network data: live Chainlink Push token prices, gas price, ERC-20 allowances and approval risk, transaction status, gas estimates, and `eth_call` simulations. Token checks are enriched with GoPlus threat intelligence (honeypot, sell tax, hidden owner, malicious-address flags). Unknown or unverified targets fail closed; unconfigured providers return a structured NOT_CONFIGURED response rather than invented data. Built to make Level 2 and Level 3 agents safe: the calling agent proposes and prepares, SafeHands decides deterministically, and the user's own wallet signs.

## Example tasks

- Check if this wallet is safe before I interact with it: `0x...`
- Analyze this token contract before my agent swaps into it: `0x...`
- Is this token a honeypot or does it have a hidden sell tax? `0x...`
- Is this the real USDC on Pharos or a fake? `0x...`
- Before my agent bridges USDC through this router, check the risk.
- Before my agent deposits PROS into this vault/staking contract, check the risk.
- Run SafeHands preflight before this agent pays this x402 API.
- What's the PROS/USD price? (harga 1 pharos berapa?)
- What's the current gas price, and does this spender have an unlimited approval? `0x...`
- What's the status of this transaction? `0x...`
- Query the latest SafeHands risk record / on-chain reputation for this address: `0x...`

## Information required from customer

A `0x` wallet address for wallet analysis, or a token/contract address for contract analysis or swap-intent vetting. For intent review, provide the action type, acting wallet address, and either the `toAddress` for transfers or `tokenIn`/`tokenOut` for swaps. Amount is optional. For a risk-record or reputation lookup, provide the subject `0x` address. SafeHands never requires private keys, seed phrases, or mnemonics, and rejects key material.

## Deliverables

Structured risk report including risk score, allow/warn/block recommendation, detected risk factors, explanation, and suggested next action.

## Range not supported

SafeHands does not provide financial or trading advice, guarantee asset/vault/campaign safety, recover lost funds, or execute anything: it never signs, broadcasts, approves, swaps, bridges, deposits, stakes, pays, creates/manages wallets, handles private keys, or publishes on-chain records in this deployment. It does not fetch arbitrary URLs, use API keys/pass-keys, or treat DEX quotes as canonical prices. It is non-custodial by design: a transaction firewall that issues verdicts before signing and never touches keys, signatures, or funds. Where data is unavailable (unconfigured provider, unsupported RPC method, stale feed), it says so rather than inventing an answer.

## Estimated execution duration

10–60 seconds

## Unit price

0

## Customer Service Strategy

Report the engine's risk score, allow/warn/block recommendation, and risk factors exactly as returned. Never invent, soften, or inflate a result. On block, advise against the action and offer no workaround. On warn, recommend human/operator review and list the concrete risk factors. Be clear that a low score means “no adverse signals at the current heuristic depth,” not a guarantee of safety. If GoPlus threat intelligence is unreachable or incomplete, clearly state that limitation. Politely decline unsupported requests: executing, signing, custody, private-key handling, non-Pharos chains, on-chain publishing, financial advice, or anything involving secrets.

## Runtime configuration

- Max concurrent sessions: 1
- Max single execution time: 120 seconds

## Debug prompts

1. Check if this wallet is safe before I interact with it: `0x0000000000000000000000000000000000000001`
2. Analyze this token contract before my agent swaps into it: `0x0000000000000000000000000000000000000001`
3. Review this transfer intent: `action=transfer`, `from=0x0000000000000000000000000000000000000001`, `to=0x0000000000000000000000000000000000000002`, `amount=1`
4. Query the latest SafeHands risk record for this address: `0x0000000000000000000000000000000000000001`
