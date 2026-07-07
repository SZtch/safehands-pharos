// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISafeHandsRegistry {
    function owner() external view returns (address);

    function isAuthorizedOperator(address operator) external view returns (bool);
}

/**
 * @title SafeHandsAttestation
 * @notice Immutable, append-only, privacy-preserving attestation ledger for
 *         SafeHands verified broadcasts — the proof half of the SafeHands
 *         on-chain layer (pair with the governed {SafeHandsRegistry}).
 *
 * "If SafeHands broadcasts it, SafeHands attests it."
 *
 * Attestations are write-once and never mutated or deleted: the integrity of the
 * ledger IS its value. Only hashed context is published (preparedTransactionHash,
 * txHash, policyHash, metadataHash) — never raw calldata, keys, recipients,
 * amounts, or private intents.
 *
 * Attester authorization is delegated to {SafeHandsRegistry} so there is a single
 * source of truth for "who is a SafeHands operator". Any contract or agent can
 * compose on `isAttested(txHash)` as a trust gate.
 */
contract SafeHandsAttestation {
    /// @notice The registry that governs operator authorization.
    ISafeHandsRegistry public immutable registry;

    // Action types as bytes32 (future-proof, privacy-preserving labels).
    bytes32 public constant ACTION_PAYMENT = keccak256("PAYMENT");
    bytes32 public constant ACTION_SWAP = keccak256("SWAP");
    bytes32 public constant ACTION_BRIDGE = keccak256("BRIDGE");
    bytes32 public constant ACTION_APPROVAL = keccak256("APPROVAL");
    bytes32 public constant ACTION_CONTRACT_CALL = keccak256("CONTRACT_CALL");
    bytes32 public constant ACTION_NFT = keccak256("NFT");
    bytes32 public constant ACTION_DEFI = keccak256("DEFI");
    bytes32 public constant ACTION_TREASURY = keccak256("TREASURY");
    bytes32 public constant ACTION_AGENT_ACTION = keccak256("AGENT_ACTION");
    bytes32 public constant ACTION_X402_PAYMENT = keccak256("X402_PAYMENT");
    bytes32 public constant ACTION_UNKNOWN = keccak256("UNKNOWN");

    struct Attestation {
        bytes32 preparedTransactionHash;
        bytes32 txHash;
        uint256 chainId;
        bytes32 actionType;
        bytes32 policyHash;
        bytes32 metadataHash;
        address agent;
        address attester;
        uint64 timestamp;
    }

    uint256 public attestationCount;
    mapping(bytes32 => Attestation) private _byTxHash;
    mapping(bytes32 => bool) public hasAttestedTx;
    mapping(bytes32 => bool) public hasAttestedPreparedTx;

    /// @notice Per-agent reputation: count of SafeHands-verified safe broadcasts
    ///         attributed to an address, plus recency. This is the composable
    ///         trust signal other agents can read via {reputationOf}.
    mapping(address => uint256) public attestationCountByAgent;
    mapping(address => uint64) public lastAttestationAt;

    event SafeHandsAttested(
        bytes32 indexed preparedTransactionHash,
        bytes32 indexed txHash,
        address indexed agent,
        uint256 chainId,
        bytes32 actionType,
        bytes32 policyHash,
        bytes32 metadataHash,
        address attester
    );

    error ZeroRegistry();
    error ZeroHash();
    error InvalidChainId();
    error UnauthorizedAttester();
    error AlreadyAttested();

    modifier onlyOperator() {
        if (msg.sender != registry.owner() && !registry.isAuthorizedOperator(msg.sender)) {
            revert UnauthorizedAttester();
        }
        _;
    }

    constructor(address registry_) {
        if (registry_ == address(0)) revert ZeroRegistry();
        registry = ISafeHandsRegistry(registry_);
    }

    /**
     * @notice Record an immutable attestation that SafeHands verified and broadcast
     *         an action. Reverts if either the txHash or preparedTransactionHash has
     *         already been attested (no overwrites, ever).
     */
    function attest(
        bytes32 preparedTransactionHash,
        bytes32 txHash,
        uint256 chainId,
        bytes32 actionType,
        bytes32 policyHash,
        bytes32 metadataHash,
        address agent
    ) external onlyOperator {
        if (preparedTransactionHash == bytes32(0) || txHash == bytes32(0)) revert ZeroHash();
        if (chainId == 0) revert InvalidChainId();
        if (hasAttestedTx[txHash]) revert AlreadyAttested();
        if (hasAttestedPreparedTx[preparedTransactionHash]) revert AlreadyAttested();

        hasAttestedTx[txHash] = true;
        hasAttestedPreparedTx[preparedTransactionHash] = true;
        uint64 ts = uint64(block.timestamp);
        _byTxHash[txHash] = Attestation({
            preparedTransactionHash: preparedTransactionHash,
            txHash: txHash,
            chainId: chainId,
            actionType: actionType,
            policyHash: policyHash,
            metadataHash: metadataHash,
            agent: agent,
            attester: msg.sender,
            timestamp: ts
        });
        unchecked {
            ++attestationCount;
        }

        // Per-agent reputation: only attribute when an agent address is provided,
        // so the zero address is never polluted with a reputation.
        if (agent != address(0)) {
            unchecked {
                ++attestationCountByAgent[agent];
            }
            lastAttestationAt[agent] = ts;
        }

        emit SafeHandsAttested(
            preparedTransactionHash,
            txHash,
            agent,
            chainId,
            actionType,
            policyHash,
            metadataHash,
            msg.sender
        );
    }

    // ─── Views (composable) ────────────────────────────────────────────────

    function isAttested(bytes32 txHash) external view returns (bool) {
        return hasAttestedTx[txHash];
    }

    function isPreparedAttested(bytes32 preparedTransactionHash) external view returns (bool) {
        return hasAttestedPreparedTx[preparedTransactionHash];
    }

    function getAttestation(bytes32 txHash) external view returns (Attestation memory) {
        return _byTxHash[txHash];
    }

    /**
     * @notice Composable, privacy-preserving reputation for an agent/address:
     *         the count of SafeHands-verified safe broadcasts attributed to it and
     *         the most recent attestation time. Any contract or agent can read this
     *         as a trust signal. Zero count = no track record yet (treat as neutral,
     *         never as a negative — this ledger only records verified-safe actions).
     */
    function reputationOf(address agent)
        external
        view
        returns (uint256 verifiedCount, uint64 lastAt)
    {
        return (attestationCountByAgent[agent], lastAttestationAt[agent]);
    }
}
