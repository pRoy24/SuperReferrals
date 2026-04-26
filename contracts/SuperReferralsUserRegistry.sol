// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SuperReferralsUserRegistry is Ownable, ReentrancyGuard {
    struct UserProfile {
        string customerId;
        address wallet;
        bytes32 profileRoot;
        string profileUri;
        string referrerCode;
        uint256 registeredAt;
        bool active;
    }

    mapping(bytes32 => UserProfile) private _profiles;
    mapping(address => bytes32[]) private _walletProfileIds;

    event UserRegistered(
        bytes32 indexed profileId,
        string customerId,
        address indexed wallet,
        bytes32 profileRoot,
        string profileUri,
        string referrerCode
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerUser(
        string calldata customerId,
        address wallet,
        bytes32 profileRoot,
        string calldata profileUri,
        string calldata referrerCode
    ) external nonReentrant returns (bytes32 profileId) {
        require(wallet != address(0), "invalid wallet");
        require(profileRoot != bytes32(0), "profile root required");
        require(msg.sender == wallet || msg.sender == owner(), "not authorized");

        profileId = profileIdFor(customerId, wallet);
        if (_profiles[profileId].wallet == address(0)) {
            _walletProfileIds[wallet].push(profileId);
        }

        _profiles[profileId] = UserProfile({
            customerId: customerId,
            wallet: wallet,
            profileRoot: profileRoot,
            profileUri: profileUri,
            referrerCode: referrerCode,
            registeredAt: block.timestamp,
            active: true
        });

        emit UserRegistered(profileId, customerId, wallet, profileRoot, profileUri, referrerCode);
    }

    function profileIdFor(string memory customerId, address wallet) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(customerId, wallet));
    }

    function userProfile(bytes32 profileId) external view returns (UserProfile memory) {
        return _profiles[profileId];
    }

    function walletProfileIds(address wallet) external view returns (bytes32[] memory) {
        return _walletProfileIds[wallet];
    }
}
