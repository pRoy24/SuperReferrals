// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC1155URIStorage} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract SuperStoresERC1155 is ERC1155URIStorage, ERC1155Supply, Ownable {
    struct EditionData {
        string fileType;
        bytes32 metadataHash;
        string rightsURI;
        uint256 maxSupply;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => EditionData) private _editionData;

    event EditionMinted(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 amount,
        string fileType,
        bytes32 metadataHash,
        string rightsURI
    );
    event EditionURIUpdated(uint256 indexed tokenId, string tokenURI);

    constructor(address initialOwner) ERC1155("") Ownable(initialOwner) {}

    function mintEdition(
        address to,
        uint256 amount,
        string calldata tokenURI_,
        string calldata fileType,
        bytes32 metadataHash,
        string calldata rightsURI
    ) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "invalid owner");
        require(amount > 0, "amount required");
        require(bytes(fileType).length > 0, "file type required");
        require(metadataHash != bytes32(0), "metadata hash required");

        tokenId = nextTokenId++;
        _editionData[tokenId] = EditionData({
            fileType: fileType,
            metadataHash: metadataHash,
            rightsURI: rightsURI,
            maxSupply: amount
        });
        _setURI(tokenId, tokenURI_);
        _mint(to, tokenId, amount, "");

        emit EditionMinted(tokenId, to, amount, fileType, metadataHash, rightsURI);
    }

    function mintAdditional(address to, uint256 tokenId, uint256 amount) external onlyOwner {
        require(to != address(0), "invalid owner");
        require(amount > 0, "amount required");
        require(bytes(_editionData[tokenId].fileType).length > 0, "unknown edition");
        require(totalSupply(tokenId) + amount <= _editionData[tokenId].maxSupply, "max supply exceeded");
        _mint(to, tokenId, amount, "");
    }

    function editionData(uint256 tokenId) external view returns (EditionData memory) {
        require(exists(tokenId), "unknown edition");
        return _editionData[tokenId];
    }

    function setEditionURI(uint256 tokenId, string calldata tokenURI_) external onlyOwner {
        require(exists(tokenId), "unknown edition");
        _setURI(tokenId, tokenURI_);
        emit EditionURIUpdated(tokenId, tokenURI_);
    }

    function uri(uint256 tokenId)
        public
        view
        override(ERC1155, ERC1155URIStorage)
        returns (string memory)
    {
        return super.uri(tokenId);
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }
}
