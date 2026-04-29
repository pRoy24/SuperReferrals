// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SuperReferralsINFT is ERC721URIStorage, Ownable, ReentrancyGuard {
    struct AgentData {
        string encryptedURI;
        bytes32 metadataHash;
        address agentWallet;
        string referrerCode;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => AgentData) private _agentData;
    mapping(uint256 => mapping(address => bytes)) private _usageAuthorizations;

    event AgentMinted(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed agentWallet,
        bytes32 metadataHash,
        string referrerCode
    );
    event AgentMetadataUpdated(uint256 indexed tokenId, bytes32 metadataHash, string encryptedURI);
    event AgentBurned(uint256 indexed tokenId);
    event UsageAuthorized(uint256 indexed tokenId, address indexed executor, bytes permissions);

    constructor(address initialOwner) ERC721("SuperReferrals Video INFT", "SRINFT") Ownable(initialOwner) {}

    function mintAgent(
        address to,
        string calldata encryptedURI,
        bytes32 metadataHash,
        address agentWallet,
        string calldata referrerCode
    ) external onlyOwner nonReentrant returns (uint256 tokenId) {
        require(to != address(0), "invalid owner");
        require(metadataHash != bytes32(0), "metadata hash required");

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, encryptedURI);
        _agentData[tokenId] = AgentData({
            encryptedURI: encryptedURI,
            metadataHash: metadataHash,
            agentWallet: agentWallet,
            referrerCode: referrerCode
        });

        emit AgentMinted(tokenId, to, agentWallet, metadataHash, referrerCode);
    }

    function agentData(uint256 tokenId) external view returns (AgentData memory) {
        _requireOwned(tokenId);
        return _agentData[tokenId];
    }

    function authorizeUsage(
        uint256 tokenId,
        address executor,
        bytes calldata permissions
    ) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(executor != address(0), "invalid executor");
        _usageAuthorizations[tokenId][executor] = permissions;
        emit UsageAuthorized(tokenId, executor, permissions);
    }

    function usageAuthorization(uint256 tokenId, address executor) external view returns (bytes memory) {
        _requireOwned(tokenId);
        return _usageAuthorizations[tokenId][executor];
    }

    function updateAgentMetadata(
        uint256 tokenId,
        string calldata encryptedURI,
        bytes32 metadataHash
    ) external nonReentrant {
        require(ownerOf(tokenId) == msg.sender || owner() == msg.sender, "not authorized");
        require(metadataHash != bytes32(0), "metadata hash required");
        _agentData[tokenId].encryptedURI = encryptedURI;
        _agentData[tokenId].metadataHash = metadataHash;
        _setTokenURI(tokenId, encryptedURI);
        emit AgentMetadataUpdated(tokenId, metadataHash, encryptedURI);
    }

    function burnAgent(uint256 tokenId) external nonReentrant {
        address currentOwner = ownerOf(tokenId);
        require(currentOwner == msg.sender || owner() == msg.sender || _isAuthorized(currentOwner, msg.sender, tokenId), "not authorized");
        delete _agentData[tokenId];
        _burn(tokenId);
        emit AgentBurned(tokenId);
    }

    function transferWithMetadata(
        address from,
        address to,
        uint256 tokenId,
        string calldata encryptedURI,
        bytes32 metadataHash,
        bytes calldata proof
    ) external nonReentrant {
        address currentOwner = ownerOf(tokenId);
        require(currentOwner == from, "invalid owner");
        require(_isAuthorized(currentOwner, msg.sender, tokenId), "not approved");
        require(to != address(0), "invalid recipient");
        require(metadataHash != bytes32(0), "metadata hash required");
        require(proof.length > 0, "proof required");

        _agentData[tokenId].encryptedURI = encryptedURI;
        _agentData[tokenId].metadataHash = metadataHash;
        _setTokenURI(tokenId, encryptedURI);
        _safeTransfer(from, to, tokenId);

        emit AgentMetadataUpdated(tokenId, metadataHash, encryptedURI);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
