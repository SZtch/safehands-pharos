// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RiskRegistry {
    address public owner;
    
    // Mapping of authorized AI Agent addresses allowed to publish scores
    mapping(address => bool) public authorizedAgents;

    struct RiskRecord {
        uint256 score;
        string riskLevel;
        string recommendation;
        uint256 timestamp;
        address assessedBy;
    }

    mapping(address => RiskRecord) public registry;
    
    event RiskPublished(address indexed wallet, uint256 score, string riskLevel, address assessedBy);
    event AgentAuthorized(address indexed agent, bool status);

    modifier onlyOwner() {
        require(msg.sender == owner, "RiskRegistry: caller is not the owner");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedAgents[msg.sender] || msg.sender == owner, "RiskRegistry: caller is not an authorized agent");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedAgents[msg.sender] = true; // Deployer is automatically authorized
    }

    // Owner can authorize other AI Agents to publish to the registry
    function setAuthorizedAgent(address agent, bool status) external onlyOwner {
        authorizedAgents[agent] = status;
        emit AgentAuthorized(agent, status);
    }

    // SECURITY UPDATE: Only authorized agents can publish risk scores now
    function publish(
        address wallet,
        uint256 score,
        string calldata riskLevel,
        string calldata recommendation
    ) external onlyAuthorized {
        registry[wallet] = RiskRecord(score, riskLevel, recommendation, block.timestamp, msg.sender);
        emit RiskPublished(wallet, score, riskLevel, msg.sender);
    }

    function query(address wallet) external view returns (RiskRecord memory) {
        return registry[wallet];
    }
}
