// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @notice Review draft: protocol extension for the proposed ERC-721 implementation.
/// @dev The implementation must inherit normal ERC-721/metadata functions separately.
///      This file is not a deployable implementation or a security-reviewed contract.
interface IZFT {
    struct MintAuthorization {
        bytes32 imageHash;
        bytes32 metadataHash;
        address initialOwner;
        address creator;
        uint256 creatorNonce;
        uint256 deadline;
    }

    struct RotationAuthorization {
        uint256 tokenId;
        address newOwner;
        uint256 ownershipNonce;
        uint256 deadline;
    }

    event Minted(
        uint256 indexed tokenId,
        address indexed creator,
        address indexed initialOwner,
        bytes32 imageHash,
        bytes32 metadataHash
    );

    /// @param ownershipNonce The new epoch after the transfer, not the signed old epoch.
    event OwnershipRotated(
        uint256 indexed tokenId,
        address indexed previousOwner,
        address indexed newOwner,
        uint256 ownershipNonce
    );

    error ExpiredAuthorization(uint256 deadline);
    error InvalidCreatorNonce(uint256 supplied, uint256 expected);
    error InvalidOwnershipNonce(uint256 supplied, uint256 expected);
    error DuplicateImage(bytes32 imageHash);
    error InvalidSigner(address recovered, address expected);
    error ZeroHash();
    error ZeroAddress();
    error SameOwner();

    function mint(MintAuthorization calldata authorization, bytes calldata signature)
        external
        returns (uint256 tokenId);

    /// @notice Recipient claim and sender cancellation use this same transition.
    function rotateOwnership(
        RotationAuthorization calldata authorization,
        bytes calldata signature
    ) external;

    function ownershipNonce(uint256 tokenId) external view returns (uint256);
    function creatorNonces(address creator) external view returns (uint256);
    function creatorOf(uint256 tokenId) external view returns (address);
    function metadataHashOf(uint256 tokenId) external view returns (bytes32);
}
