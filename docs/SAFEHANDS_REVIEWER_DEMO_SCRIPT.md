# SafeHands Reviewer Demo Script

## 1. Project One-Liner

SafeHands is an open-source reusable Pharos Skill that gives AI agents a safety gateway before on-chain actions.

## 2. Why SafeHands Matters

AI agents making on-chain transactions need guardrails. Without safety checks, an agent could:
- Send funds to the wrong address or chain
- Approve unlimited token spending
- Execute swaps above policy limits
- Pay x402 invoices to SSRF targets
- Operate on mainnet with testnet assumptions

SafeHands sits between the agent and the blockchain. Every action goes through preflight, risk scoring, policy checks, and authorization gates before execution is allowed.

## 3. Execution Modes

| Mode | Wallet | Auth | Use Case |
|------|--------|------|----------|
| Preflight / Read-only | None | None | Safety checks, demos |
| User-signed | User's own | None | User signs after SafeHands validates |
| Managed execution | Auto-created | V2 required | Full agent autonomy (testnet) |
| Env wallet (advanced) | `PRIVATE_KEY` in env | None | Local testnet dev |
| Operator / demo | Owner key | Auto-authorized | Onboarding flows |

## 4. RiskRegistry V2

```
Network:  Pharos Atlantic Testnet
Chain ID: 688689
Address:  0x92e7b0d7029b1fe43f7da44ca9b0f805f3f31c25
Owner:    0x6730d3a2a217108ab53ccfe60ffdad05d3c124e5
```

Deployed Solidity contract that serves as an authorized-agent registry and on-chain risk memory / attestation registry.

## 5. Demo Commands

### Quick demo (no setup required)

```bash
npm ci && npm run build
npx safehands-pharos --demo
```

### Full test suite

```bash
npm test              # 75 smoke tests
npm run demo          # 10 demo scenarios
npm run test:contracts # 37 Solidity tests
npm run test:all      # All combined
```

## 6. Expected Outputs

### Safe small testnet preflight -> ALLOW

```
Action: payment
Chain ID: 688689 (Pharos Atlantic Testnet)
Amount: 0.001 PHRS
-> Decision: ALLOW
```

### Mainnet chainId -> BLOCK

```
Action: payment
Chain ID: 1 (Ethereum Mainnet)
-> Decision: BLOCK
-> Reason: Mainnet not allowed — SafeHands is testnet-only
```

### Invalid token -> BLOCK

```
Action: approve_token
Token: 0xDEAD...BEEF (unknown token)
-> Decision: BLOCK
-> Reason: Token not in SafeHands registry
```

### Unlimited approval -> BLOCK

```
Action: approve_token
Amount: unlimited / MaxUint256
-> Decision: BLOCK
-> Reason: Unlimited approvals are blocked
```

### x402 SSRF / invalid amount -> BLOCK

```
Action: x402_pay_and_fetch
URL: http://169.254.169.254/metadata (internal IP)
-> Decision: BLOCK
-> Reason: SSRF — internal/private IP blocked

Action: x402_pay_and_fetch
Amount: -1 USDC
-> Decision: BLOCK
-> Reason: Invalid amount
```

### Risk report -> local + V2 section

```
Tool: safehands_risk_report
-> Risk analysis with local scoring
-> RiskRegistry V2 section (graceful degradation if RPC unavailable)
```

### Policy: advanced allows large swap, conservative blocks

```
Policy: advanced
Action: swap 1000 PHRS
-> Decision: ALLOW (within advanced policy maxSwapPHRS: 1000)

Policy: conservative
Action: swap 1000 PHRS
-> Decision: BLOCK (exceeds conservative policy maxSwapPHRS: 1)
```

### Hard safety rules override any policy

```
Policy: advanced
Action: payment on mainnet (chainId: 1)
-> Decision: BLOCK (mainnet blocked regardless of policy)

Policy: advanced
Action: unlimited approval
-> Decision: BLOCK (unlimited approval blocked regardless of policy)

Policy: advanced
Action: x402 to internal IP
-> Decision: BLOCK (SSRF blocked regardless of policy)
```

## 7. 29 Tools (Grouped)

| Category | Tools |
|----------|-------|
| Safety Preflight | `safehands_preflight_check` |
| Risk + Analysis | `assess_risk`, `safehands_risk_report`, `explain_risk` |
| RiskRegistry | `publish_risk_score`, `query_risk_registry` |
| Payment + x402 | `send_payment`, `safehands_x402_preflight`, `x402_pay_and_fetch` |
| Swap + Approval | `execute_swap`, `approve_token`, `check_allowance` |
| Wallet + Agent | `create_agent_wallet`, `get_agent_wallet`, `get_agent_wallet_balance`, `get_wallet_balance`, `safehands_wallet_health` |
| Market + Chain | `get_token_price`, `get_pool_info`, `get_gas_price`, `estimate_gas`, `get_transaction_status`, `get_execution_history`, `check_token_security`, `token_registry_status`, `simulate_transaction` |
| Agent Policy | `get_agent_policy`, `set_agent_policy` |
| Managed Execution | `safehands_safe_execute` |

## 8. Limitations (Honest)

- **Pharos Atlantic Testnet-only** — mainnet and Pacific are blocked by design
- **Not audited** for mainnet custody or production wallet management
- **User-signed prepared transaction** output is a future enhancement (preflight works, formal handler is roadmap)
- **x402 full idempotency cache** is future hardening (policy/preflight guards exist)
- **Per-agent daily spend accumulation** is documented but accumulation is still global
- **Live V2 reads** are tested offline only in deterministic smoke tests
- **npm audit vulnerabilities** may remain from dependencies (not force-fixed)
