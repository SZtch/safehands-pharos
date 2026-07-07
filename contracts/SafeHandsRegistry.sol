// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title SafeHandsRegistry
 * @notice L2 Merkle Batching architecture for SafeHands Risk Records.
 *         To prevent state bloat, risk records are no longer stored individually.
 *         Instead, operators commit a single Merkle Root representing thousands
 *         of risk assessments.
 * @dev Ownership uses OpenZeppelin {Ownable2Step}: a transfer only completes when
 *      the incoming owner calls {acceptOwnership}, so a mistyped address can never
 *      orphan governance. {renounceOwnership} is disabled — this registry is the
 *      trust root for operators/agents and must always retain an owner.
 */
contract SafeHandsRegistry is Ownable2Step {
    enum RiskLevel {
        LOW,
        MEDIUM,
        HIGH,
        CRITICAL
    }

    enum Recommendation {
        PROCEED,
        CAUTION,
        BLOCK
    }

    /// @notice Operators may publish risk roots.
    mapping(address => bool) public isAuthorizedOperator;

    /// @notice Agents (managed wallets) cleared for guarded execution.
    mapping(address => bool) public isAuthorizedAgent;

    /// @notice The latest committed Merkle Root of all active risk records.
    bytes32 public currentMerkleRoot;

    /// @notice Off-chain availability pointer (e.g. IPFS CID or Arweave Tx)
    string public currentDataURI;

    event OperatorSet(address indexed operator, bool authorized);
    event AgentSet(address indexed agent, bool authorized);

    event RiskRootCommitted(
        bytes32 indexed root,
        string dataURI,
        address indexed operator
    );

    error NotOperator();
    error ZeroAddress();
    error Expired();
    error InvalidRoot();
    error EmptyDataURI();
    error RenounceDisabled();

    modifier onlyOperator() {
        if (msg.sender != owner() && !isAuthorizedOperator[msg.sender]) revert NotOperator();
        _;
    }

    constructor() Ownable(msg.sender) {}

    // ─── Governance ────────────────────────────────────────────────────────

    /// @notice Disabled. Hand ownership off via the two-step
    ///         {transferOwnership} + {acceptOwnership} instead — the registry
    ///         must never be left ownerless.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function setOperator(address operator, bool authorized) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        isAuthorizedOperator[operator] = authorized;
        emit OperatorSet(operator, authorized);
    }

    function setAuthorizedAgent(address agent, bool authorized) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        isAuthorizedAgent[agent] = authorized;
        emit AgentSet(agent, authorized);
    }

    function setAuthorizedAgents(address[] calldata agents, bool authorized) external onlyOwner {
        for (uint256 i; i < agents.length; ++i) {
            address agent = agents[i];
            if (agent == address(0)) revert ZeroAddress();
            isAuthorizedAgent[agent] = authorized;
            emit AgentSet(agent, authorized);
        }
    }

    // ─── L2 Merkle Batching ────────────────────────────────────────────────

    /**
     * @notice Commits a new Merkle root representing a batch of risk records.
     * @param root The keccak256 Merkle root.
     * @param dataURI Pointer to the off-chain JSON containing the leaves (IPFS).
     */
    function commitRiskRoot(bytes32 root, string calldata dataURI) external onlyOperator {
        if (root == bytes32(0)) revert InvalidRoot();
        if (bytes(dataURI).length == 0) revert EmptyDataURI();
        currentMerkleRoot = root;
        currentDataURI = dataURI;
        emit RiskRootCommitted(root, dataURI, msg.sender);
    }

    /**
     * @notice Verifies if a specific risk record exists in the current Merkle tree.
     *         Contracts requiring composability must pass the proof.
     */
    function verifyRiskRecord(
        address target,
        bytes32 actionHash,
        uint8 score,
        RiskLevel level,
        Recommendation recommendation,
        bytes32 policyVersionHash,
        bytes32 evidenceHash,
        uint64 expiresAt,
        bytes32[] calldata proof
    ) public view returns (bool) {
        // expiresAt == 0 means never expires. Non-zero values must be in the future.
        if (expiresAt != 0 && expiresAt < block.timestamp) revert Expired();

        // Double hashing to prevent leaf-node preimage attacks (standard practice)
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        target,
                        actionHash,
                        score,
                        level,
                        recommendation,
                        policyVersionHash,
                        evidenceHash,
                        expiresAt
                    )
                )
            )
        );
        return MerkleProof.verify(proof, currentMerkleRoot, leaf);
    }
}
