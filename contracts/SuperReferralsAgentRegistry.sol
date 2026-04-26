// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SuperReferralsAgentRegistry is Ownable, ReentrancyGuard {
    struct AgentManifest {
        address owner;
        address agentWallet;
        bytes32 manifestRoot;
        string keeperhubWorkflowId;
        bool active;
    }

    struct AgentJob {
        address callerAgent;
        address targetAgent;
        bytes32 inputRoot;
        bytes32 outputRoot;
        uint256 maxSpend;
        bool completed;
        bool rolledBack;
    }

    mapping(address => AgentManifest) public manifests;
    mapping(bytes32 => AgentJob) public jobs;

    event AgentRegistered(
        address indexed agentWallet,
        address indexed owner,
        bytes32 manifestRoot,
        string keeperhubWorkflowId
    );
    event AgentJobRequested(
        bytes32 indexed jobId,
        address indexed callerAgent,
        address indexed targetAgent,
        bytes32 inputRoot,
        uint256 maxSpend
    );
    event AgentJobCompleted(bytes32 indexed jobId, bytes32 outputRoot);
    event AgentJobRolledBack(bytes32 indexed jobId, string reason);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerAgent(
        address agentWallet,
        bytes32 manifestRoot,
        string calldata keeperhubWorkflowId
    ) external nonReentrant {
        require(agentWallet != address(0), "invalid agent");
        require(manifestRoot != bytes32(0), "manifest required");

        manifests[agentWallet] = AgentManifest({
            owner: msg.sender,
            agentWallet: agentWallet,
            manifestRoot: manifestRoot,
            keeperhubWorkflowId: keeperhubWorkflowId,
            active: true
        });

        emit AgentRegistered(agentWallet, msg.sender, manifestRoot, keeperhubWorkflowId);
    }

    function requestJob(
        bytes32 jobId,
        address targetAgent,
        bytes32 inputRoot,
        uint256 maxSpend
    ) external nonReentrant {
        require(jobId != bytes32(0), "job required");
        require(targetAgent != address(0), "target required");
        require(inputRoot != bytes32(0), "input required");
        require(jobs[jobId].callerAgent == address(0), "job exists");

        jobs[jobId] = AgentJob({
            callerAgent: msg.sender,
            targetAgent: targetAgent,
            inputRoot: inputRoot,
            outputRoot: bytes32(0),
            maxSpend: maxSpend,
            completed: false,
            rolledBack: false
        });

        emit AgentJobRequested(jobId, msg.sender, targetAgent, inputRoot, maxSpend);
    }

    function completeJob(bytes32 jobId, bytes32 outputRoot) external nonReentrant {
        AgentJob storage job = jobs[jobId];
        require(job.targetAgent == msg.sender || owner() == msg.sender, "not authorized");
        require(!job.completed && !job.rolledBack, "closed");
        require(outputRoot != bytes32(0), "output required");

        job.outputRoot = outputRoot;
        job.completed = true;
        emit AgentJobCompleted(jobId, outputRoot);
    }

    function rollbackJob(bytes32 jobId, string calldata reason) external nonReentrant {
        AgentJob storage job = jobs[jobId];
        require(job.callerAgent == msg.sender || job.targetAgent == msg.sender || owner() == msg.sender, "not authorized");
        require(!job.completed && !job.rolledBack, "closed");

        job.rolledBack = true;
        emit AgentJobRolledBack(jobId, reason);
    }
}
