// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IShieldedVerifier} from "./VerifierAdapter.sol";
interface IPoseidon2 { function poseidon(uint256[2] calldata values) external view returns (uint256); }

/// @notice Isolated experimental registry. No upgrade, administrator, issuer key or recovery override.
/// @dev Public content, private spend membership. Deployment/setup are not production qualified.
contract ShieldedRegistry is EIP712 {
    uint256 public constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant DEPTH = 16;
    uint256 public constant CAPACITY = 1 << DEPTH;
    uint256 public constant ROOT_HISTORY = 64;
    bytes32 public constant ASSET_TAG = keccak256("ZFT_SHIELDED_ASSET_V1");
    bytes32 public constant DOMAIN_TAG = keccak256("ZFT_SHIELDED_LOCAL_V1");
    bytes32 public constant COMMIT_TAG = keccak256("ZFT_SHIELDED_CREATE_COMMIT_V1");
    bytes32 public constant CREATE_TYPEHASH = keccak256("Create(bytes32 imageHash,bytes32 metadataHash,uint256 commitment,address creator,uint256 nonce,uint256 deadline)");
    struct Creation { bytes32 imageHash; bytes32 metadataHash; uint256 commitment; address creator; uint256 nonce; uint256 deadline; }
    IPoseidon2 public immutable hasher;
    IShieldedVerifier public immutable creationVerifier;
    IShieldedVerifier public immutable spendVerifier;
    uint256 public immutable domain;
    uint256 public nextIndex;
    uint256 public root;
    uint256 public rootCursor;
    uint256[16] public zeros;
    uint256[16] private filled;
    uint256[64] private roots;
    mapping(uint256 => uint256) public retainedRoots;
    mapping(uint256 => bool) public closedRoots;
    mapping(uint256 => bool) public commitments;
    mapping(uint256 => bool) public nullifiers;
    mapping(uint256 => uint256) public successor;
    mapping(bytes32 => bytes32) public imageAssets;
    mapping(address => uint256) public creatorNonces;
    mapping(bytes32 => uint256) public creationCommits;
    event CreationCommitted(bytes32 indexed commitment, uint256 blockNumber);
    event Created(bytes32 indexed assetId, bytes32 indexed imageHash, bytes32 metadataHash, address indexed creator, uint256 commitment);
    event Appended(uint256 indexed index, uint256 indexed treeId, uint256 commitment, uint256 root);
    event TreeClosed(uint256 indexed treeId, uint256 root);
    event Spent(uint256 indexed nullifier, uint256 outputCommitment);

    constructor(address hasher_, address creationVerifier_, address spendVerifier_) EIP712("ZFT Shielded Registry", "1") {
        require(hasher_.code.length > 0 && creationVerifier_.code.length > 0 && spendVerifier_.code.length > 0, "Missing code");
        hasher = IPoseidon2(hasher_); creationVerifier = IShieldedVerifier(creationVerifier_); spendVerifier = IShieldedVerifier(spendVerifier_);
        domain = uint256(keccak256(abi.encode(DOMAIN_TAG, block.chainid, address(this)))) % FIELD;
        uint256 zero;
        for (uint256 level; level < DEPTH; level++) { zeros[level] = zero; filled[level] = zero; zero = hasher.poseidon([zero, zero]); }
        root = zero; roots[0] = zero; retainedRoots[zero] = 1;
    }
    function authorizationDigest(Creation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CREATE_TYPEHASH, a.imageHash, a.metadataHash, a.commitment, a.creator, a.nonce, a.deadline)));
    }
    function commitmentDigest(Creation calldata a, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(COMMIT_TAG, authorizationDigest(a), salt));
    }
    function commitCreate(bytes32 commitment) external {
        require(commitment != bytes32(0), "Empty commitment");
        if (creationCommits[commitment] == 0) { creationCommits[commitment] = block.number; emit CreationCommitted(commitment, block.number); }
    }
    function create(Creation calldata a, bytes32 salt, bytes calldata signature, bytes calldata proof) external returns (bytes32 assetId) {
        uint256 committed = creationCommits[commitmentDigest(a, salt)];
        require(committed != 0 && block.number >= committed + 2 && block.number <= committed + 256, "Commit window");
        require(a.creator != address(0) && a.imageHash != bytes32(0) && a.metadataHash != bytes32(0), "Empty identity");
        require(block.timestamp <= a.deadline && a.nonce == creatorNonces[a.creator], "Authorization stale");
        require(ECDSA.recover(authorizationDigest(a), signature) == a.creator, "Creator signature");
        require(imageAssets[a.imageHash] == bytes32(0), "Duplicate image");
        assetId = keccak256(abi.encode(ASSET_TAG, block.chainid, address(this), a.imageHash, a.metadataHash));
        require(assetId != bytes32(0), "Empty asset");
        uint256[4] memory signals = [domain, uint256(assetId) >> 128, uint256(assetId) & type(uint128).max, a.commitment];
        require(creationVerifier.verify(proof, signals), "Creation proof");
        creatorNonces[a.creator]++;
        imageAssets[a.imageHash] = assetId;
        _append(a.commitment);
        emit Created(assetId, a.imageHash, a.metadataHash, a.creator, a.commitment);
    }
    function spend(uint256 anchor, uint256 nullifier, uint256 outputCommitment, bytes calldata proof) external {
        require(retainedRoots[anchor] > 0 || closedRoots[anchor], "Unknown root");
        require(nullifier < FIELD && !nullifiers[nullifier], "Spent nullifier");
        uint256[4] memory signals = [domain, anchor, nullifier, outputCommitment];
        require(spendVerifier.verify(proof, signals), "Spend proof");
        nullifiers[nullifier] = true;
        successor[nullifier] = outputCommitment;
        _append(outputCommitment);
        emit Spent(nullifier, outputCommitment);
    }
    function _append(uint256 commitment) private {
        require(commitment > 0 && commitment < FIELD && !commitments[commitment], "Invalid commitment");
        commitments[commitment] = true;
        uint256 index = nextIndex++; uint256 at = index % CAPACITY; uint256 current = commitment;
        // New trees open only as part of an already-authorized atomic append.
        if (at == 0 && index > 0) { for (uint256 level; level < DEPTH; level++) filled[level] = zeros[level]; }
        for (uint256 level; level < DEPTH; level++) {
            if (at % 2 == 0) { filled[level] = current; current = hasher.poseidon([current, zeros[level]]); }
            else current = hasher.poseidon([filled[level], current]);
            at /= 2;
        }
        rootCursor = (rootCursor + 1) % ROOT_HISTORY;
        uint256 expired = roots[rootCursor];
        if (retainedRoots[expired] > 0) retainedRoots[expired]--;
        roots[rootCursor] = current; retainedRoots[current]++; root = current;
        uint256 treeId = index / CAPACITY;
        emit Appended(index, treeId, commitment, current);
        if (index % CAPACITY == CAPACITY - 1) { closedRoots[current] = true; emit TreeClosed(treeId, current); }
    }
}
