"""Public, deterministic RESEARCH fixtures. Never use these keys/nonces for assets.
Original equation/transcript implementation; no reference website code is imported.
Run without arguments to CHECK committed fixtures; --write explicitly regenerates.
"""
import hashlib
import json
import sys
from pathlib import Path

from py_ecc.optimized_bls12_381 import (
    G1, G2, Z1, Z2, FQ, FQ2, add, multiply, neg, eq, is_inf, curve_order as Q, pairing,
)
from py_ecc.bls.hash_to_curve import hash_to_G1, map_to_curve_G1, map_to_curve_G2
from py_ecc.bls.point_compression import compress_G1, compress_G2, decompress_G1, decompress_G2


def integer(n, width=32):
    return n.to_bytes(width, "big")


def frame(data, width=2):
    return integer(len(data), width) + data


def point(p):
    if isinstance(p[0], FQ):
        return integer(compress_G1(p), 48)
    a, b = compress_G2(p)
    return integer(a, 48) + integer(b, 48)


def digest(data):
    return int.from_bytes(hashlib.sha256(data).digest(), "big") % Q


def h2c(message, dst):
    return hash_to_G1(message.encode(), dst.encode(), hashlib.sha256)


GN = h2c("ps_nullifier_base", "CASHU_PS_GNULL_XMD:SHA-256_SSWU_RO_")
GA = h2c("ps_asset_tag_base", "CASHU_PS_ASSET_TAG_XMD:SHA-256_SSWU_RO_")


def dleq(bases, statements, witness, nonce, domain, context=b""):
    commitments = [multiply(b, nonce) for b in bases]
    transcript = domain.encode() + frame(context) + b"".join(
        frame(point(p)) for p in bases + statements + commitments
    )
    c = digest(transcript)
    return integer(c) + integer((nonce + c * witness) % Q), transcript


def linear(equations, witnesses, nonces, domain, context):
    transcript = domain.encode() + frame(context)
    for statement, terms in equations:
        commitment = Z1 if isinstance(statement[0], FQ) else Z2
        for base, index in terms:
            commitment = add(commitment, multiply(base, nonces[index]))
        transcript += frame(point(statement)) + frame(point(commitment))
        for base, index in terms:
            transcript += frame(point(base)) + integer(index, 2)
    c = digest(transcript)
    return integer(c) + b"".join(integer((r + c * w) % Q) for r, w in zip(nonces, witnesses)), transcript


def presentation(u, v, s, rho, nonce, context):
    U, V, T, N = multiply(u, rho), multiply(v, rho), multiply(u, rho * s % Q), multiply(GN, s)
    proof, transcript = dleq([GN, U], [N, T], s, nonce, "Cashu_PS_Present_v1", context)
    return (U, V, T, N), proof, transcript


def credential_valid(u, v, h, s, X2, Yh2, Ys2):
    return pairing(G2, v) == pairing(add(add(X2, multiply(Yh2, h)), multiply(Ys2, s)), u)


def build():
    # All values intentionally public. Distinct fixed nonces make this reproducible,
    # not secure. This generator is NOT a mint or a production randomness source.
    x, yh, ys, s, new_s, k, new_k = 11, 13, 17, 19, 23, 29, 31
    asset = b"ZFT PS reference-core vector 1\x00\xff"  # raw bytes, not a JPEG pipeline test
    h = digest(b"Cashu_PS_Asset_v1" + frame(asset, 4))
    X2, Yh2, Ys2, Yh1 = multiply(G2, x), multiply(G2, yh), multiply(G2, ys), multiply(G1, yh)
    pk_parts = [point(p) for p in [X2, Yh2, Ys2, Yh1]]
    keyset = b"\x03" + hashlib.sha256(b"".join(frame(p, 4) for p in pk_parts) + frame(b"psnft", 4)).digest()
    session = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    D, B, S = multiply(GA, h), multiply(Yh1, h), multiply(G1, s)
    issue_proof, issue_transcript = linear(
        [(D, [(GA, 0)]), (B, [(Yh1, 0)]), (S, [(G1, 1)])], [h, s], [37, 41],
        "Cashu_PS_CommittedIssue_v3", keyset + session,
    )
    u = multiply(G1, k)
    # Issuer response is derived algebra for the lab; server source was not observed.
    v = multiply(add(add(multiply(G1, x), B), multiply(S, ys)), k)
    assert credential_valid(u, v, h, s, X2, Yh2, Ys2)
    assert not credential_valid(u, v, (h + 1) % Q, s, X2, Yh2, Ys2)
    assert pairing(G2, Yh1) == pairing(Yh2, G1)
    token = "psnft1" + (keyset + point(u) + point(v) + integer(h) + integer(s)).hex()
    profile = "42" * 32  # reference's 32-byte profile, NOT an Ethereum address
    showing_text = f"Cashu_NFT_Portfolio_Show_v1\n{profile}\n{integer(h).hex()}\n{keyset.hex()}".encode()
    showing_context = b"Cashu_PS_Showing_v1" + frame(showing_text)
    shown, showing_proof, showing_transcript = presentation(u, v, s, 43, 47, showing_context)
    U, V, T, N = shown
    assert pairing(G2, V) == pairing(add(X2, multiply(Yh2, h)), U) * pairing(Ys2, T)
    raw_showing = keyset + integer(h) + b"".join(point(p) for p in shown) + showing_proof
    showing = "pshow1" + (frame(showing_text) + raw_showing).hex()
    new_S = multiply(G1, new_s)
    new_proof, owner_transcript = dleq([G1], [new_S], new_s, 53, "Cashu_PS_Issue_v1")
    old, old_proof, old_transcript = presentation(u, v, s, 59, 61, point(new_S))
    U, V, T, N = old
    o, t = 67, 71
    K = add(multiply(Yh2, h), multiply(G2, o))
    hidden_V = add(V, multiply(U, o))
    new_u = multiply(G1, new_k)
    new_B = add(multiply(new_u, h), multiply(G1, t))
    transfer_proof, transfer_transcript = linear(
        [(K, [(Yh2, 0), (G2, 1)]), (new_B, [(new_u, 0), (G1, 2)])],
        [h, o, t], [73, 79, 83], "Cashu_PS_CommitEq_v1", point(new_S),
    )
    assert pairing(G2, hidden_V) == pairing(add(X2, K), U) * pairing(Ys2, T)
    blinded_v = add(add(multiply(new_u, x), multiply(new_B, yh)), multiply(new_S, new_k * ys % Q))
    new_v = add(blinded_v, neg(multiply(Yh1, t)))
    assert credential_valid(new_u, new_v, h, new_s, X2, Yh2, Ys2)
    assert not credential_valid(new_u, blinded_v, h, new_s, X2, Yh2, Ys2)
    transfer_bytes = keyset + b"".join(point(p) for p in [U, hidden_V, K, T, N]) + old_proof
    # On-curve points BEFORE clearing cofactors must fail subgroup checks.
    bad_g1, bad_g2 = map_to_curve_G1(FQ(1)), map_to_curve_G2(FQ2([1, 2]))
    assert not is_inf(multiply(bad_g1, Q)) and not is_inf(multiply(bad_g2, Q))
    # Check both compressed encodings independently round-trip in py_ecc.
    for p in [GN, GA, G1, u, v, new_u, new_v]:
        assert eq(decompress_G1(int.from_bytes(point(p), "big")), p)
    for p in [G2, X2, Yh2, Ys2, K]:
        encoded = point(p)
        assert eq(decompress_G2((int.from_bytes(encoded[:48], "big"), int.from_bytes(encoded[48:], "big"))), p)
    return {
        "profile": "nfc-reference-core-2026-10-06-lab-v1",
        "warning": "PUBLIC TEST SECRETS AND NONCES. No assets, network, wallet, issuer state or production security.",
        "test_secrets": {name: integer(n).hex() for name, n in dict(x=x, yh=yh, ys=ys, s=s, new_s=new_s, k=k, new_k=new_k, o=o, t=t).items()},
        "test_nonces": {"issue": [37, 41], "showing_rho": 43, "showing_dleq": 47, "new_owner": 53, "transfer_rho": 59, "transfer_dleq": 61, "transfer_linear": [73, 79, 83]},
        "generators": {"g1": point(G1).hex(), "g2": point(G2).hex(), "nullifier": point(GN).hex(), "asset_tag": point(GA).hex()},
        "parameters": {"public_key": b"".join(pk_parts).hex(), "keyset_id": keyset.hex()},
        "asset": {"bytes": asset.hex(), "h": integer(h).hex()},
        "issue": {"version": 3, "session": session.hex(), "asset_tag": point(D).hex(), "b": point(B).hex(), "owner_commitment": point(S).hex(), "proof": issue_proof.hex(), "transcript": issue_transcript.hex()},
        "credential": {"keyset_id": keyset.hex(), "u": point(u).hex(), "v": point(v).hex(), "h": integer(h).hex(), "s": integer(s).hex()},
        "token": token,
        "showing": {"profile": profile, "encoded": showing, "transcript": showing_transcript.hex()},
        "transfer": {"session_u": point(new_u).hex(), "presentation": transfer_bytes.hex(), "b": point(new_B).hex(), "proof": transfer_proof.hex(), "new_owner_commitment": point(new_S).hex(), "new_proof": new_proof.hex(), "transcript": transfer_transcript.hex(), "owner_transcript": owner_transcript.hex(), "presentation_transcript": old_transcript.hex(), "response_v": point(blinded_v).hex(), "unblinded_v": point(new_v).hex(), "new_nullifier": point(multiply(GN, new_s)).hex()},
        "invalid_points": {"g1_not_in_subgroup": point(bad_g1).hex(), "g2_not_in_subgroup": point(bad_g2).hex()},
    }


if __name__ == "__main__":
    if sys.argv[1:] not in ([], ["--write"]):
        raise SystemExit("usage: python generate.py [--write]")
    target = Path(__file__).with_name("vectors.json")
    result = json.dumps(build(), indent=2) + "\n"
    if sys.argv[1:] == ["--write"]:
        target.write_text(result)
        print("Wrote public PS research vectors")
    elif target.read_text() != result:
        raise SystemExit("PS vector mismatch; investigate before explicitly regenerating")
    else:
        print("py_ecc: exact vector reproduction, subgroup controls and pairing checks passed")
