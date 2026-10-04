// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IZFT} from "../interfaces/IZFT.sol";

/// @notice Public ERC-721 ownership with disposable, file-carried signing keys.
/// @dev Non-upgradeable. No administrator, seizure, or public burn method.
contract ZFT is ERC721, EIP712, ReentrancyGuard, IZFT {
    bytes32 public constant MINT_TYPEHASH = keccak256(
        "Mint(bytes32 imageHash,bytes32 metadataHash,address initialOwner,address creator,uint256 creatorNonce,uint256 deadline)"
    );
    bytes32 public constant ROTATION_TYPEHASH = keccak256(
        "RotateOwnership(uint256 tokenId,address newOwner,uint256 ownershipNonce,uint256 deadline)"
    );
    mapping(uint256 => uint256) public ownershipNonce;
    mapping(address => uint256) public creatorNonces;
    mapping(uint256 => address) public creatorOf;
    mapping(uint256 => bytes32) public metadataHashOf;
    string public metadataOrigin;

    constructor(string memory origin) ERC721("Zenon File Tokens", "ZFT") EIP712("ZFT", "1") {
        require(bytes(origin).length > 0, "Empty metadata origin");
        metadataOrigin = origin;
    }

    function mint(MintAuthorization calldata a, bytes calldata signature)
        external nonReentrant returns (uint256 tokenId)
    {
        if (block.timestamp > a.deadline) revert ExpiredAuthorization(a.deadline);
        if (a.imageHash == bytes32(0) || a.metadataHash == bytes32(0)) revert ZeroHash();
        if (a.creator == address(0) || a.initialOwner == address(0)) revert ZeroAddress();
        if (a.creatorNonce != creatorNonces[a.creator])
            revert InvalidCreatorNonce(a.creatorNonce, creatorNonces[a.creator]);
        tokenId = uint256(a.imageHash);
        if (_ownerOf(tokenId) != address(0)) revert DuplicateImage(a.imageHash);
        address recovered = ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(
            MINT_TYPEHASH, a.imageHash, a.metadataHash, a.initialOwner,
            a.creator, a.creatorNonce, a.deadline
        ))), signature);
        if (recovered != a.creator) revert InvalidSigner(recovered, a.creator);
        creatorNonces[a.creator]++;
        creatorOf[tokenId] = a.creator;
        metadataHashOf[tokenId] = a.metadataHash;
        // Mint provenance precedes the receiver hook, which may transfer the item.
        emit Minted(tokenId, a.creator, a.initialOwner, a.imageHash, a.metadataHash);
        _safeMint(a.initialOwner, tokenId);
    }

    function rotateOwnership(RotationAuthorization calldata a, bytes calldata signature) external nonReentrant {
        if (block.timestamp > a.deadline) revert ExpiredAuthorization(a.deadline);
        address previousOwner = ownerOf(a.tokenId);
        if (a.newOwner == address(0)) revert ZeroAddress();
        if (a.newOwner == previousOwner) revert SameOwner();
        if (a.ownershipNonce != ownershipNonce[a.tokenId])
            revert InvalidOwnershipNonce(a.ownershipNonce, ownershipNonce[a.tokenId]);
        address recovered = ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(
            ROTATION_TYPEHASH, a.tokenId, a.newOwner, a.ownershipNonce, a.deadline
        ))), signature);
        if (recovered != previousOwner) revert InvalidSigner(recovered, previousOwner);
        _safeTransfer(previousOwner, a.newOwner, a.tokenId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) {
            uint256 next = ++ownershipNonce[tokenId];
            emit OwnershipRotated(tokenId, from, to, next);
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        bytes memory hexHash = bytes(Strings.toHexString(uint256(metadataHashOf[tokenId]), 32));
        bytes memory hash = new bytes(64);
        for (uint256 i; i < 64; ++i) hash[i] = hexHash[i + 2];
        return string.concat(metadataOrigin, "/metadata/", string(hash), ".json");
    }
}
