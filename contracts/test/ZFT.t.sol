// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;
import {ZFT} from "../src/ZFT.sol";
import {IZFT} from "../interfaces/IZFT.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function expectRevert() external;
    function expectPartialRevert(bytes4) external;
    function warp(uint256) external;
    function chainId(uint256) external;
}

contract Receiver is IERC721Receiver {
    ZFT public token;
    address public destination;
    bool public reentryBlocked;

    constructor(ZFT t, address d) {
        token = t;
        destination = d;
    }

    function onERC721Received(address, address, uint256 id, bytes calldata) external returns (bytes4) {
        require(token.creatorOf(id) != address(0), "missing creator in hook");
        IZFT.RotationAuthorization memory a =
            IZFT.RotationAuthorization(id, destination, token.ownershipNonce(id), block.timestamp + 1);
        try token.rotateOwnership(a, "") {
            revert("reentry allowed");
        }
            catch {
            reentryBlocked = true;
        }
        token.transferFrom(address(this), destination, id);
        return this.onERC721Received.selector;
    }
}

contract ZFTTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ZFT token;
    address creator;
    address owner;
    address next;
    uint256 constant CREATOR_KEY = 0x1234;
    uint256 constant OWNER_KEY = 0x5678;
    bytes32 constant IMAGE = keccak256("image");
    bytes32 constant META = keccak256("metadata");

    function setUp() public {
        vm.chainId(7340469);
        vm.warp(100);
        token = new ZFT("https://zft.foo");
        creator = vm.addr(CREATOR_KEY);
        owner = vm.addr(OWNER_KEY);
        next = vm.addr(0x9999);
    }

    function domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ZFT"),
                keccak256("1"),
                block.chainid,
                address(token)
            )
        );
    }

    function sign(uint256 key, bytes32 hash) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain(), hash)));
        return abi.encodePacked(r, s, v);
    }

    function mintAuth() internal view returns (IZFT.MintAuthorization memory) {
        return IZFT.MintAuthorization(IMAGE, META, owner, creator, 0, 1000);
    }

    function mintSig(IZFT.MintAuthorization memory a) internal returns (bytes memory) {
        return sign(CREATOR_KEY, keccak256(abi.encode(token.MINT_TYPEHASH(), a)));
    }

    function minted() internal {
        IZFT.MintAuthorization memory a = mintAuth();
        token.mint(a, mintSig(a));
    }

    function rotateAuth(address to, uint256 nonce) internal pure returns (IZFT.RotationAuthorization memory) {
        return IZFT.RotationAuthorization(uint256(IMAGE), to, nonce, 1000);
    }

    function rotateSig(IZFT.RotationAuthorization memory a) internal returns (bytes memory) {
        return sign(OWNER_KEY, keccak256(abi.encode(token.ROTATION_TYPEHASH(), a)));
    }

    function testMintImmutableProvenanceAndURI() public {
        minted();
        require(token.ownerOf(uint256(IMAGE)) == owner);
        require(token.creatorOf(uint256(IMAGE)) == creator);
        require(token.metadataHashOf(uint256(IMAGE)) == META);
        require(token.creatorNonces(creator) == 1);
        require(token.ownershipNonce(uint256(IMAGE)) == 0);
        require(bytes(token.tokenURI(uint256(IMAGE))).length == 94);
    }

    function testDuplicateImage() public {
        minted();
        IZFT.MintAuthorization memory a = mintAuth();
        a.creatorNonce = 1;
        bytes memory s = mintSig(a);
        vm.expectPartialRevert(IZFT.DuplicateImage.selector);
        token.mint(a, s);
    }

    function testWrongCreatorNonce() public {
        IZFT.MintAuthorization memory a = mintAuth();
        a.creatorNonce = 2;
        bytes memory s = mintSig(a);
        vm.expectPartialRevert(IZFT.InvalidCreatorNonce.selector);
        token.mint(a, s);
    }

    function testExpiredMint() public {
        IZFT.MintAuthorization memory a = mintAuth();
        a.deadline = 99;
        bytes memory s = mintSig(a);
        vm.expectPartialRevert(IZFT.ExpiredAuthorization.selector);
        token.mint(a, s);
    }

    function testWrongDomainAndRecipient() public {
        IZFT.MintAuthorization memory a = mintAuth();
        bytes memory s = mintSig(a);
        vm.chainId(1);
        vm.expectPartialRevert(IZFT.InvalidSigner.selector);
        token.mint(a, s);
        vm.chainId(7340469);
        a.initialOwner = next;
        vm.expectPartialRevert(IZFT.InvalidSigner.selector);
        token.mint(a, s);
    }

    function testClaimAndCancelRace() public {
        minted();
        IZFT.RotationAuthorization memory a = rotateAuth(next, 0);
        bytes memory first = rotateSig(a);
        IZFT.RotationAuthorization memory b = rotateAuth(vm.addr(0x1111), 0);
        bytes memory second = rotateSig(b);
        token.rotateOwnership(a, first);
        vm.expectPartialRevert(IZFT.InvalidOwnershipNonce.selector);
        token.rotateOwnership(b, second);
        require(token.ownerOf(uint256(IMAGE)) == next);
    }

    function testABAInvalidatesOldSignature() public {
        minted();
        IZFT.RotationAuthorization memory a = rotateAuth(next, 0);
        bytes memory s = rotateSig(a);
        vm.prank(owner);
        token.transferFrom(owner, next, uint256(IMAGE));
        vm.prank(next);
        token.transferFrom(next, owner, uint256(IMAGE));
        require(token.ownershipNonce(uint256(IMAGE)) == 2);
        vm.expectPartialRevert(IZFT.InvalidOwnershipNonce.selector);
        token.rotateOwnership(a, s);
    }

    function testApprovalAndSelfTransferAdvanceEpoch() public {
        minted();
        vm.prank(owner);
        token.approve(next, uint256(IMAGE));
        vm.prank(next);
        token.transferFrom(owner, owner, uint256(IMAGE));
        require(token.ownershipNonce(uint256(IMAGE)) == 1);
        require(token.getApproved(uint256(IMAGE)) == address(0));
        vm.prank(owner);
        token.setApprovalForAll(next, true);
        vm.prank(next);
        token.transferFrom(owner, next, uint256(IMAGE));
        require(token.ownershipNonce(uint256(IMAGE)) == 2);
    }

    function testReceiverHookPreservesEpochAndBlocksSignedReentry() public {
        Receiver r = new Receiver(token, next);
        IZFT.MintAuthorization memory a = mintAuth();
        a.initialOwner = address(r);
        token.mint(a, mintSig(a));
        require(r.reentryBlocked());
        require(token.ownerOf(uint256(IMAGE)) == next);
        require(token.ownershipNonce(uint256(IMAGE)) == 1);
    }

    function testUnsafeReceiverRollsBackMint() public {
        IZFT.MintAuthorization memory a = mintAuth();
        a.initialOwner = address(this);
        bytes memory s = mintSig(a);
        vm.expectRevert();
        token.mint(a, s);
        require(token.creatorNonces(creator) == 0);
    }

    function testRotationBindsEveryField() public {
        minted();
        IZFT.RotationAuthorization memory a = rotateAuth(next, 0);
        bytes memory s = rotateSig(a);
        a.newOwner = creator;
        vm.expectPartialRevert(IZFT.InvalidSigner.selector);
        token.rotateOwnership(a, s);
        a.newOwner = next;
        a.deadline = 999;
        vm.expectPartialRevert(IZFT.InvalidSigner.selector);
        token.rotateOwnership(a, s);
    }

    function testRejectsHighS() public {
        minted();
        IZFT.RotationAuthorization memory a = rotateAuth(next, 0);
        bytes32 hash =
            keccak256(abi.encodePacked("\x19\x01", domain(), keccak256(abi.encode(token.ROTATION_TYPEHASH(), a))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, hash);
        s = bytes32(0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141 - uint256(s));
        bytes memory sig = abi.encodePacked(r, s, v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert();
        token.rotateOwnership(a, sig);
    }

    function testFuzzAllTransfersAdvanceNonce(uint8 count) public {
        minted();
        uint256 n = uint256(count) + 1;
        address current = owner;
        for (uint256 i; i < n; i++) {
            address to = i % 2 == 0 ? next : owner;
            vm.prank(current);
            token.transferFrom(current, to, uint256(IMAGE));
            current = to;
            require(token.ownershipNonce(uint256(IMAGE)) == i + 1);
        }
    }

    function testSharedTypeScriptSigningVector() public view {
        bytes32 d = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ZFT"),
                keccak256("1"),
                uint256(7340469),
                address(0x1234)
            )
        );
        bytes32 message = keccak256(
            abi.encode(
                token.MINT_TYPEHASH(),
                bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111)),
                bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222)),
                address(2),
                address(0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf),
                uint256(0),
                uint256(1791150000)
            )
        );
        require(
            keccak256(abi.encodePacked("\x19\x01", d, message))
                == 0x9a0711ff1b501708a73e1c10f34b04b6083e0d98097387101822c338aac2860e
        );
    }
}
