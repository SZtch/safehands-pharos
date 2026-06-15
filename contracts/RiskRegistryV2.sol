// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RiskRegistryV2 {
    address public owner;
    uint256 private _nextRecordId;

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

    mapping(address => bool) public authorizedAgents;
    mapping(uint256 => RiskRecord) public riskRecords;
    mapping(address => uint256[]) public walletRecords;
    mapping(bytes32 => uint256) public actionRecord;

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

    error ZeroAddress();
    error EmptyString();
    error InvalidScore();
    error InvalidActionHash();
    error InvalidExpiry();
    error UnauthorizedPublisher();
    error RecordNotFound();
    error AlreadyRevoked();
    error EmptyArray();

    modifier onlyOwner() {
        require(msg.sender == owner, "RiskRegistryV2: caller is not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        _nextRecordId = 1;
    }

    function setAuthorizedAgent(address agent, bool authorized) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        authorizedAgents[agent] = authorized;
        emit AgentAuthorizationUpdated(agent, authorized);
    }

    function batchSetAuthorizedAgents(address[] calldata agents, bool authorized) external onlyOwner {
        if (agents.length == 0) revert EmptyArray();
        for (uint256 i = 0; i < agents.length; i++) {
            if (agents[i] == address(0)) revert ZeroAddress();
            authorizedAgents[agents[i]] = authorized;
            emit AgentAuthorizationUpdated(agents[i], authorized);
        }
    }

    function isAuthorizedAgent(address agent) external view returns (bool) {
        return authorizedAgents[agent];
    }

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
    ) external returns (uint256 recordId) {
        if (msg.sender != owner && !authorizedAgents[msg.sender]) revert UnauthorizedPublisher();
        if (wallet == address(0)) revert ZeroAddress();
        if (agent == address(0)) revert ZeroAddress();
        if (actionHash == bytes32(0)) revert InvalidActionHash();
        if (score > 100) revert InvalidScore();
        if (bytes(riskLevel).length == 0) revert EmptyString();
        if (bytes(recommendation).length == 0) revert EmptyString();
        if (bytes(policyVersion).length == 0) revert EmptyString();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();

        recordId = _nextRecordId++;
        riskRecords[recordId] = RiskRecord({
            recordId: recordId,
            wallet: wallet,
            agent: agent,
            actionHash: actionHash,
            score: score,
            riskLevel: riskLevel,
            recommendation: recommendation,
            policyVersion: policyVersion,
            evidenceURI: evidenceURI,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false
        });

        walletRecords[wallet].push(recordId);
        actionRecord[actionHash] = recordId;

        emit RiskRecordPublished(recordId, wallet, agent, actionHash, score, riskLevel);
    }

    function getRiskRecord(uint256 recordId) external view returns (RiskRecord memory) {
        if (riskRecords[recordId].createdAt == 0) revert RecordNotFound();
        return riskRecords[recordId];
    }

    function getLatestRiskRecordForWallet(address wallet) external view returns (RiskRecord memory) {
        uint256[] storage ids = walletRecords[wallet];
        if (ids.length == 0) revert RecordNotFound();
        return riskRecords[ids[ids.length - 1]];
    }

    function getRiskRecordsForWallet(address wallet) external view returns (uint256[] memory) {
        return walletRecords[wallet];
    }

    function getRiskRecordByActionHash(bytes32 actionHash) external view returns (RiskRecord memory) {
        uint256 recordId = actionRecord[actionHash];
        if (recordId == 0) revert RecordNotFound();
        return riskRecords[recordId];
    }

    function revokeRiskRecord(uint256 recordId) external onlyOwner {
        if (riskRecords[recordId].createdAt == 0) revert RecordNotFound();
        if (riskRecords[recordId].revoked) revert AlreadyRevoked();
        riskRecords[recordId].revoked = true;
        emit RiskRecordRevoked(recordId);
    }

    function isRiskRecordValid(uint256 recordId) external view returns (bool) {
        RiskRecord storage record = riskRecords[recordId];
        if (record.createdAt == 0) return false;
        if (record.revoked) return false;
        if (record.expiresAt != 0 && record.expiresAt <= block.timestamp) return false;
        return true;
    }
}
