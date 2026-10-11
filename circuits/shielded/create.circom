pragma circom 2.2.3;
include "note.circom";
template Create() {
    signal input domain;
    signal input assetHi;
    signal input assetLo;
    signal input commitment;
    signal input secret;
    signal input randomness;
    component note = Note();
    note.domain <== domain;
    note.assetHi <== assetHi;
    note.assetLo <== assetLo;
    note.secret <== secret;
    note.randomness <== randomness;
    commitment === note.commitment;
}
component main {public [domain, assetHi, assetLo, commitment]} = Create();
