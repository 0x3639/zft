pragma circom 2.2.3;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

// Experimental profile. Tags and encodings are specified in SHIELDED-ZVM-PROTOCOL.
template Note() {
    signal input domain;
    signal input assetHi;
    signal input assetLo;
    signal input secret;
    signal input randomness;
    signal output commitment;
    component hi = Num2Bits(128); hi.in <== assetHi;
    component lo = Num2Bits(128); lo.in <== assetLo;
    component sk = Num2Bits(248); sk.in <== secret;
    component rho = Num2Bits(248); rho.in <== randomness;
    component zs = IsZero(); zs.in <== secret; zs.out === 0;
    component zr = IsZero(); zr.in <== randomness; zr.out === 0;
    component h = Poseidon(6);
    h.inputs[0] <== 1;
    h.inputs[1] <== domain;
    h.inputs[2] <== assetHi;
    h.inputs[3] <== assetLo;
    h.inputs[4] <== secret;
    h.inputs[5] <== randomness;
    commitment <== h.out;
}
