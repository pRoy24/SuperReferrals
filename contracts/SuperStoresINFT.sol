// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SuperStoresINFT is ERC721URIStorage, Ownable, ReentrancyGuard {
    struct INFTData {
        string encryptedURI;
        bytes32 metadataHash;
        address agentWallet;
        string fileType;
        string rightsURI;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => INFTData) private _inftData;
    mapping(uint256 => mapping(address => bytes)) private _usageAuthorizations;

    event INFTMinted(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed agentWallet,
        string fileType,
        bytes32 metadataHash
    );
    event INFTMetadataUpdated(uint256 indexed tokenId, string encryptedURI, bytes32 metadataHash);
    event UsageAuthorized(uint256 indexed tokenId, address indexed executor, bytes permissions);

    constructor(address initialOwner) ERC721("SuperStores Intelligent Collectibles", "SSINFT") Ownable(initialOwner) {}

    function mintINFT(
        address to,
        string calldata encryptedURI,
        bytes32 metadataHash,
        address agentWallet,
        string calldata fileType,
        string calldata rightsURI
    ) external onlyOwner nonReentrant returns (uint256 tokenId) {
        require(to != address(0), "invalid owner");
        require(metadataHash != bytes32(0), "metadata hash required");
        require(bytes(fileType).length > 0, "file type required");

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, encryptedURI);
        _inftData[tokenId] = INFTData({
            encryptedURI: encryptedURI,
            metadataHash: metadataHash,
            agentWallet: agentWallet,
            fileType: fileType,
            rightsURI: rightsURI
        });

        emit INFTMinted(tokenId, to, agentWallet, fileType, metadataHash);
    }

    function inftData(uint256 tokenId) external view returns (INFTData memory) {
        _requireOwned(tokenId);
        return _inftData[tokenId];
    }

    function authorizeUsage(uint256 tokenId, address executor, bytes calldata permissions) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(executor != address(0), "invalid executor");
        _usageAuthorizations[tokenId][executor] = permissions;
        emit UsageAuthorized(tokenId, executor, permissions);
    }

    function usageAuthorization(uint256 tokenId, address executor) external view returns (bytes memory) {
        _requireOwned(tokenId);
        return _usageAuthorizations[tokenId][executor];
    }

    function updateINFTMetadata(
        uint256 tokenId,
        string calldata encryptedURI,
        bytes32 metadataHash,
        string calldata rightsURI
    ) external nonReentrant {
        address tokenOwner = ownerOf(tokenId);
        require(msg.sender == tokenOwner || msg.sender == owner(), "not authorized");
        require(metadataHash != bytes32(0), "metadata hash required");

        _inftData[tokenId].encryptedURI = encryptedURI;
        _inftData[tokenId].metadataHash = metadataHash;
        _inftData[tokenId].rightsURI = rightsURI;
        _setTokenURI(tokenId, encryptedURI);

        emit INFTMetadataUpdated(tokenId, encryptedURI, metadataHash);
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

        _inftData[tokenId].encryptedURI = encryptedURI;
        _inftData[tokenId].metadataHash = metadataHash;
        _setTokenURI(tokenId, encryptedURI);
        _safeTransfer(from, to, tokenId);

        emit INFTMetadataUpdated(tokenId, encryptedURI, metadataHash);
    }
}
