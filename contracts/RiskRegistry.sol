// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RiskRegistry {
    struct RiskRecord {
        uint256 score;
        string riskLevel;
        string recommendation;
        uint256 timestamp;
        address assessedBy;
    }

    mapping(address => RiskRecord) public registry;
    
    event RiskPublished(address indexed wallet, uint256 score, string riskLevel, address assessedBy);

    function publish(
        address wallet,
        uint256 score,
        string calldata riskLevel,
        string calldata recommendation
    ) external {
        registry[wallet] = RiskRecord(score, riskLevel, recommendation, block.timestamp, msg.sender);
        emit RiskPublished(wallet, score, riskLevel, msg.sender);
    }

    function query(address wallet) external view returns (RiskRecord memory) {
        return registry[wallet];
    }
}
