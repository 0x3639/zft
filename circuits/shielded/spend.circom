pragma circom 2.2.3;
include "note.circom";
template Spend(depth) {
    signal input domain;
    signal input root;
    signal input nullifier;
    signal input outputCommitment;
    signal input assetHi;
    signal input assetLo;
    signal input secret;
    signal input randomness;
    signal input nextSecret;
    signal input nextRandomness;
    signal input siblings[depth];
    signal input bits[depth];
    component old = Note();
    old.domain <== domain; old.assetHi <== assetHi; old.assetLo <== assetLo;
    old.secret <== secret; old.randomness <== randomness;
    component next = Note();
    next.domain <== domain; next.assetHi <== assetHi; next.assetLo <== assetLo;
    next.secret <== nextSecret; next.randomness <== nextRandomness;
    outputCommitment === next.commitment;
    component unchanged = IsEqual();
    unchanged.in[0] <== old.commitment; unchanged.in[1] <== outputCommitment;
    unchanged.out === 0;
    component n = Poseidon(4);
    n.inputs[0] <== 2; n.inputs[1] <== domain;
    n.inputs[2] <== secret; n.inputs[3] <== old.commitment;
    nullifier === n.out;
    signal nodes[depth+1]; nodes[0] <== old.commitment;
    component hashes[depth];
    for (var i=0;i<depth;i++) {
        bits[i] * (bits[i]-1) === 0;
        hashes[i] = Poseidon(2);
        hashes[i].inputs[0] <== nodes[i] + bits[i]*(siblings[i]-nodes[i]);
        hashes[i].inputs[1] <== siblings[i] + bits[i]*(nodes[i]-siblings[i]);
        nodes[i+1] <== hashes[i].out;
    }
    root === nodes[depth];
}
component main {public [domain, root, nullifier, outputCommitment]} = Spend(16);
