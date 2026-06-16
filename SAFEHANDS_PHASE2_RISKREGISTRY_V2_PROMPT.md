# SafeHands Phase 2 — RiskRegistry V2 Contract Prompt

Act as a senior Solidity engineer, Web3 security engineer, smart-contract reviewer, TypeScript maintainer, Hardhat/Foundry-style contract QA lead, and Pharos Atlantic Testnet deployment reviewer.

## Repository Context

This repository is **SafeHands / safehands-pharos**, an open-source reusable Pharos Skill for AI agents.

SafeHands is a Pharos Atlantic Testnet-only safety gateway that other AI agents can call before executing on-chain actions such as:

- payments
- approvals
- swaps
- x402 payments
- custom contract calls
- risk reports
- managed agent wallet checks

## Phase 2 Goal

Build and optionally deploy **RiskRegistry V2**.

RiskRegistry V2 should make the on-chain contract a meaningful part of SafeHands, not a decorative add-on.

RiskRegistry V2 must act as:

```txt
authorized-agent registry + on-chain risk memory / risk attestation registry
```

This phase is focused on the **contract layer and deployment artifacts only**.

---

## Hard Constraints

Do **not** undo Phase 1 fixes.

Do **not** modify broad app logic unless required for contract compile/test artifacts.

Do **not** implement Phase 3 integration yet.

Do **not** change SafeHands execution behavior yet.

Do **not** enable mainnet.

Do **not** add UI.

Do **not** require normal users to provide private keys.

Do **not** commit private keys, mnemonics, RPC secrets, API keys, or owner wallet secrets.

Do **not** put real private keys in `.env.example`, README, reports, tests, screenshots, or ZIP artifacts.

RiskRegistry V2 must remain **Pharos Atlantic Testnet-only** in documentation and deployment instructions.

---

# 1. Required Contract Positioning

RiskRegistry V2 must support two main roles:

## A. Authorized Agent Registry

SafeHands-managed agent wallets can be marked as authorized for managed autonomous execution.

This is used later in Phase 3 as a trust gate:

```txt
managed agent wallet wants to execute
↓
SafeHands checks RiskRegistry V2 authorized status
↓
if not authorized: REQUIRE_AUTHORIZATION
↓
if authorized: continue funding + policy + preflight checks
```

Important:

- This does **not** apply to basic preflight mode.
- This does **not** apply to user-signed transactions by default.
- This is for SafeHands-managed autonomous execution.

## B. On-chain Risk Memory / Attestation Registry

RiskRegistry V2 stores risk attestations for a wallet/action.

A risk record should answer:

```txt
who/what wallet was assessed?
what action was assessed?
what risk score was assigned?
what risk level and recommendation were given?
which policy version was used?
when does this attestation expire?
was the record revoked?
where is optional supporting evidence?
```

---

# 2. Contract Requirements

Create a new contract file such as:

```txt
contracts/RiskRegistryV2.sol
```

or another clearly named V2 contract path that fits the repo structure.

Do not delete the V1 contract unless there is a strong reason. V1 can remain as legacy/reference.

## Required Solidity Version

Use the Solidity version already used by the repo unless there is a strong compatibility reason to change it.

Prefer stable, simple Solidity.

---

# 3. Required State and Struct Design

RiskRegistry V2 should include at minimum:

```solidity
struct RiskRecord {
    uint256 recordId;
    address wallet;
    address agent;
    bytes32 actionHash;
    uint8 score;
    string riskLevel;
    string recommendation;
    string policyVersion;
    string evidenceURI;
    uint256 createdAt;
    uint256 expiresAt;
    bool revoked;
}
```

You may adjust exact types if there is a strong reason, but preserve the meaning.

Required mappings or equivalent:

```solidity
mapping(address => bool) public authorizedAgents;
mapping(uint256 => RiskRecord) public riskRecords;
mapping(address => uint256[]) public walletRecords;
mapping(bytes32 => uint256) public actionRecord;
```

If using a different structure, document why.

---

# 4. Required Validation Rules

RiskRegistry V2 must reject invalid records.

Required checks:

```txt
wallet != address(0)
agent != address(0)
score <= 100
riskLevel must not be empty
recommendation must not be empty
actionHash must not be bytes32(0)
expiresAt must be 0 or greater than block.timestamp
```

Notes:

- `expiresAt = 0` may mean “no expiry”.
- `evidenceURI` may be empty because evidence can be optional.
- `policyVersion` should be required unless you have a strong reason to default it.

Recommended:

```txt
policyVersion must not be empty
```

---

# 5. Required Access Control

Implement clear owner/admin control.

Minimum requirement:

```txt
Only owner/admin can authorize or revoke agent wallets.
Only authorized agent wallets or owner/admin can publish risk records.
Only owner/admin can revoke risk records.
```

Use repo-compatible access-control style.

If OpenZeppelin is already available, you may use `Ownable`.

If OpenZeppelin is not available or would add too much dependency weight, implement minimal owner control safely.

Do not introduce unnecessary complexity.

---

# 6. Required Functions

Implement functions equivalent to:

## Ownership / Admin

```solidity
function owner() external view returns (address);
```

If using OpenZeppelin, this is already available.

## Agent Authorization

```solidity
function setAuthorizedAgent(address agent, bool authorized) external onlyOwner;
function batchSetAuthorizedAgents(address[] calldata agents, bool authorized) external onlyOwner;
function isAuthorizedAgent(address agent) external view returns (bool);
```

Required behavior:

- zero address must be rejected
- emit event when authorization changes
- batch function should reject empty arrays
- batch function should reject zero address entries

## Risk Publishing

```solidity
function publishRiskRecord(
    address wallet,
    address agent,
    bytes32 actionHash,
    uint8 score,
    string calldata riskLevel,
    string calldata recommendation,
    string calldata policyVersion,
    string calldata evidenceURI,
    uint256 expiresAt
) external returns (uint256 recordId);
```

Required behavior:

- only owner or authorized agent can publish
- validate all required fields
- increment record IDs safely
- store record
- index by wallet
- index by actionHash
- emit event

## Risk Querying

```solidity
function getRiskRecord(uint256 recordId) external view returns (RiskRecord memory);
function getLatestRiskRecordForWallet(address wallet) external view returns (RiskRecord memory);
function getRiskRecordsForWallet(address wallet) external view returns (uint256[] memory);
function getRiskRecordByActionHash(bytes32 actionHash) external view returns (RiskRecord memory);
```

Required behavior:

- querying nonexistent records should behave clearly
- if using zero/default return for not found, document it
- better: revert with a clear custom error for nonexistent record

## Risk Revocation

```solidity
function revokeRiskRecord(uint256 recordId) external onlyOwner;
```

Required behavior:

- cannot revoke nonexistent record
- should be idempotent or clearly reject already revoked
- emit event

## Optional Helper

```solidity
function isRiskRecordValid(uint256 recordId) external view returns (bool);
```

Recommended logic:

```txt
exists
not revoked
not expired
```

---

# 7. Required Events

Add events equivalent to:

```solidity
event AgentAuthorizationUpdated(address indexed agent, bool authorized);
event RiskRecordPublished(
    uint256 indexed recordId,
    address indexed wallet,
    address indexed agent,
    bytes32 actionHash,
    uint8 score,
    string riskLevel
);
event RiskRecordRevoked(uint256 indexed recordId);
```

You may add more events if useful.

---

# 8. Required Custom Errors

Prefer custom errors over long revert strings when practical.

Suggested errors:

```solidity
error ZeroAddress();
error EmptyString();
error InvalidScore();
error InvalidActionHash();
error InvalidExpiry();
error UnauthorizedPublisher();
error RecordNotFound();
error AlreadyRevoked();
error EmptyArray();
```

---

# 9. Required Tests

Add deterministic contract tests.

Use the repo’s existing test framework. If the repo already uses Hardhat, use Hardhat. If it uses another framework, match the repo.

Required tests:

## Authorization Tests

```txt
owner can authorize agent
owner can revoke agent
non-owner cannot authorize agent
zero address authorization reverts
batch authorization works
empty batch reverts
batch with zero address reverts
```

## Risk Publishing Tests

```txt
owner can publish valid risk record
authorized agent can publish valid risk record
unauthorized wallet cannot publish risk record
wallet zero address reverts
agent zero address reverts
score > 100 reverts
empty riskLevel reverts
empty recommendation reverts
empty policyVersion reverts
zero actionHash reverts
expired expiresAt reverts
expiresAt=0 is accepted if treated as no expiry
```

## Query Tests

```txt
getRiskRecord returns stored record
getLatestRiskRecordForWallet returns latest record
getRiskRecordsForWallet returns all wallet record IDs
getRiskRecordByActionHash returns expected record
nonexistent record query reverts or returns documented empty value
```

## Revocation Tests

```txt
owner can revoke record
non-owner cannot revoke record
revoked record is not valid
expired record is not valid
valid unexpired non-revoked record is valid
```

---

# 10. Deployment Script

Add or update a deployment script for RiskRegistry V2.

Suggested path:

```txt
scripts/deploy-risk-registry-v2.ts
```

or use the repo’s existing deployment convention.

Requirements:

- read deployer private key only from env
- never print private key
- validate target chainId is Pharos Atlantic Testnet `688689`
- fail if chainId is not `688689`
- print deployed contract address
- print deployer address
- print transaction hash if available
- print next-step instructions for updating constants in Phase 3
- do not auto-authorize random wallets in the deploy script unless explicitly configured

Required env names:

```env
PHAROS_RPC_URL=https://atlantic.dplabs-internal.com
RISK_REGISTRY_OWNER_PRIVATE_KEY=0xOWNER_TESTNET_KEY
```

Important:

- `.env.example` may include placeholder names only.
- Never include real private keys.

---

# 11. ABI / Artifact Requirements

Ensure contract artifacts are generated and available according to repo conventions.

If the repo keeps ABI JSON manually, update or add:

```txt
contracts/RiskRegistryV2.json
```

or the equivalent generated artifact path.

Do not break existing V1 artifact references.

---

# 12. Documentation Requirement

Create a Phase 2 report:

```txt
docs/reports/SAFEHANDS_PHASE2_RISKREGISTRY_V2_REPORT.md
```

If `docs/reports` does not exist, create it.

The report must include:

## SafeHands Phase 2 RiskRegistry V2 Report

### 1. Executive Summary
Explain that Phase 2 adds RiskRegistry V2 as:
- authorized-agent registry
- on-chain risk memory / attestation registry

### 2. Scope
Mention:
- contract-only / contract-artifact phase
- no SafeHands execution integration yet
- no mainnet enablement
- no UI

### 3. Contract Design
Explain:
- main struct
- authorization model
- risk publishing model
- revocation model
- query model
- expiry model

### 4. Files Changed

Use table format:

| File | Purpose |
|---|---|
| `contracts/RiskRegistryV2.sol` | ... |

### 5. Security Controls
List:
- owner-only authorization
- authorized publisher rules
- zero address checks
- score range checks
- required strings
- actionHash validation
- expiry validation
- record revocation
- event emission

### 6. Tests
Include exact command results.

### 7. Deployment Status

Use one of:

```txt
DEPLOYED
NOT DEPLOYED - missing key/funding/RPC
NOT DEPLOYED - intentionally deferred
```

If deployed, include:
- RiskRegistry V2 address
- deployer address
- chainId
- tx hash
- block number if available

If not deployed, explain exactly why and provide exact deploy command.

### 8. Phase 3 Handoff

List what Phase 3 must do:
- update SafeHands constants/config to use V2 address
- update ABI imports
- update `risk_report`
- update `publish_risk_score`
- add managed wallet authorization check for managed execution mode
- preserve preflight/user-signed modes without RiskRegistry authorization requirement

### 9. Remaining Known Limitations
Be honest.

### 10. Phase 2 Verdict

Use one:

```txt
PHASE 2 COMPLETE
PHASE 2 COMPLETE - DEPLOYMENT DEFERRED
PHASE 2 NOT COMPLETE
```

---

# 13. Commands to Run

Run all relevant commands for the repo.

At minimum:

```bash
npm run build
npm test
npm run test:all
```

If the repo has a specific contract compile/test command, run it too, for example:

```bash
npx hardhat compile
npx hardhat test
```

If deploying:

```bash
npx hardhat run scripts/deploy-risk-registry-v2.ts --network pharosAtlantic
```

or the repo’s equivalent deploy command.

Do not claim a command passed unless it was actually run.

---

# 14. Final Response After Work

After patching, testing, and creating the report, print:

1. Files changed.
2. Exact commands run.
3. Contract test results.
4. App build/test results.
5. Deployment status.
6. RiskRegistry V2 address if deployed.
7. Phase 2 report path.
8. Remaining known limitations.
9. Confirm no mainnet/Pacific enablement happened.
10. Confirm no private key was committed.

---

# 15. Acceptance Criteria

Phase 2 is acceptable if:

```txt
RiskRegistry V2 contract exists
authorized-agent registry exists
risk attestation storage exists
validation rules exist
events exist
tests exist and pass
deployment script exists
report exists
no real private key is committed
mainnet/Pacific remains blocked
Phase 1 security fixes are not regressed
```

Deployment is preferred but may be deferred if no testnet owner key/funding is available.

If deployment is deferred, the report must be explicit and honest.
