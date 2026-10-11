// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

interface IGroth16Verifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[4] calldata signals) external view returns (bool);
}
interface IPlonkVerifier {
    function verifyProof(uint256[24] calldata proof, uint256[4] calldata signals) external view returns (bool);
}
interface IShieldedVerifier {
    function verify(bytes calldata proof, uint256[4] calldata signals) external view returns (bool);
}

/// @notice Test-profile adapter for an immutable, separately pinned generated verifier.
contract VerifierAdapter is IShieldedVerifier {
    address public immutable verifier;
    bool public immutable plonk;
    constructor(address verifier_, bool plonk_) {
        require(verifier_.code.length > 0, "Missing verifier");
        verifier = verifier_; plonk = plonk_;
    }
    function verify(bytes calldata proof, uint256[4] calldata signals) external view returns (bool) {
        if (plonk) {
            if (proof.length != 768) return false;
            uint256[24] memory decoded = abi.decode(proof, (uint256[24]));
            return IPlonkVerifier(verifier).verifyProof(decoded, signals);
        }
        if (proof.length != 256) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        return IGroth16Verifier(verifier).verifyProof(a, b, c, signals);
    }
}
