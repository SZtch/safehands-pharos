# Anvita Flow Agent Card — SafeHands

Copy these values verbatim into the Anvita Flow Developer Console when completing the Agent Card.

## Agent name
SafeHands

## One-sentence introduction
Pre-execution security agent that checks on-chain actions before autonomous finance agents execute them.

## Capability description
SafeHands evaluates wallet, token, contract, and transaction intent risk before execution. It returns a structured risk score, detected risk factors, explanation, and an allow/warn/block recommendation for autonomous agent finance on Pharos, enriched with GoPlus threat intelligence (honeypot, sell tax, hidden owner, malicious-address flags).

## Example tasks
- Check if this wallet is safe before I interact with it: 0x...
- Analyze this token contract before my agent swaps into it: 0x...
- Is this token a honeypot or does it have a hidden sell tax? 0x...
- Is this the real USDC on Pharos or a fake? 0x...
- Review this proposed transaction and tell me whether to allow, warn, or block it.
- Score the risk of this DeFi action before execution.
- Query the latest SafeHands risk record for this address: 0x...
- What is the on-chain reputation of this agent? How many verified actions does it have? 0x...

## Information required from customer
- A 0x wallet address (wallet analysis), or a token/contract address (contract analysis or swap-intent vetting).
- For intent review: the action (`transfer` or `swap`), the acting wallet address, and either the `toAddress` (transfer) or `tokenIn`/`tokenOut` (swap). Amount is optional for transfers.
- For a risk-record or reputation lookup: the subject 0x address.
- Never a private key, seed phrase, or mnemonic — the agent rejects key material.

## Deliverables
Structured risk report including risk score, allow/warn/block recommendation, detected risk factors, explanation, suggested next action.

## Range not supported
The agent does not provide financial advice, guarantee asset safety, recover lost funds, execute or sign any transaction, or publish new on-chain records (analysis and read-only queries only in this deployment).

## Estimated execution duration
30–90 seconds

## Unit price
Free

## Customer Service Strategy
- Report the engine's risk score, allow/warn/block recommendation, and risk factors exactly as returned — never invent, soften, or inflate a result.
- On `block`, advise against the action and offer no workarounds; on `warn`, ask for explicit confirmation and list the concrete risk factors.
- Be clear that a low score means "no adverse signals at heuristic depth," not a guarantee of safety, and say so when GoPlus threat intel was unreachable.
- Politely decline unsupported requests: executing, signing, or preparing transactions; non-Pharos chains; on-chain publishing; financial advice; or anything involving secrets.

## Runtime configuration
- Max concurrent sessions: 1-3
- Max single execution time: 60-120 seconds

## Debug prompts
1. Check if this wallet is safe before I interact with it: 0x0000000000000000000000000000000000000001
2. Analyze this token contract before my agent swaps into it: 0x0000000000000000000000000000000000000001
3. Review this proposed transaction and tell me whether to allow, warn, or block it.
4. Query the latest SafeHands risk record for this address: 0x0000000000000000000000000000000000000001
