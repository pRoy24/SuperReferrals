// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract SuperStoresERC721 is ERC721URIStorage, Ownable {
    struct CollectibleData {
        string fileType;
        bytes32 metadataHash;
        string rightsURI;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => CollectibleData) private _collectibleData;

    event CollectibleMinted(
        uint256 indexed tokenId,
        address indexed owner,
        string fileType,
        bytes32 metadataHash,
        string rightsURI
    );
    event CollectibleDataUpdated(uint256 indexed tokenId, string fileType, bytes32 metadataHash, string rightsURI);

    constructor(address initialOwner) ERC721("SuperStores Unique Collectibles", "SS721") Ownable(initialOwner) {}

    function mintCollectible(
        address to,
        string calldata tokenURI_,
        string calldata fileType,
        bytes32 metadataHash,
        string calldata rightsURI
    ) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "invalid owner");
        require(bytes(fileType).length > 0, "file type required");
        require(metadataHash != bytes32(0), "metadata hash required");

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        _collectibleData[tokenId] = CollectibleData({
            fileType: fileType,
            metadataHash: metadataHash,
            rightsURI: rightsURI
        });

        emit CollectibleMinted(tokenId, to, fileType, metadataHash, rightsURI);
    }

    function collectibleData(uint256 tokenId) external view returns (CollectibleData memory) {
        _requireOwned(tokenId);
        return _collectibleData[tokenId];
    }

    function updateCollectibleData(
        uint256 tokenId,
        string calldata tokenURI_,
        string calldata fileType,
        bytes32 metadataHash,
        string calldata rightsURI
    ) external {
        address tokenOwner = ownerOf(tokenId);
        require(msg.sender == tokenOwner || msg.sender == owner(), "not authorized");
        require(bytes(fileType).length > 0, "file type required");
        require(metadataHash != bytes32(0), "metadata hash required");

        _setTokenURI(tokenId, tokenURI_);
        _collectibleData[tokenId] = CollectibleData({
            fileType: fileType,
            metadataHash: metadataHash,
            rightsURI: rightsURI
        });

        emit CollectibleDataUpdated(tokenId, fileType, metadataHash, rightsURI);
    }
}
