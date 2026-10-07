import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const m = await import(process.env.ZFT_PS_VERIFIER || "./verify.mjs");
const f = JSON.parse(
  readFileSync(new URL("./vectors.json", import.meta.url), "utf8"),
);
const pk = m.parameters(f.parameters);
const changedScalar = (value) => m.hex(m.integer((m.scalar(value) + 1n) % m.Q));
const replaceBytes = (encoded, offset, value) =>
  encoded.slice(0, offset * 2) +
  value +
  encoded.slice(offset * 2 + value.length);
const changedPoint = (value, group = 1) =>
  m.hex(m.encode(m.point(value, group).add(group === 1 ? m.G1 : m.G2)));
const show = (
  encoded = f.showing.encoded,
  profile = f.showing.profile,
  h = f.asset.h,
) => m.showing(encoded, profile, h, pk);
const claim = (patch = {}) => m.transfer({ ...f.transfer, ...patch }, pk);

test("independent hash-to-curve, generators, asset hash and keyset bytes match", () => {
  for (const [name, p] of Object.entries({
    g1: m.G1,
    g2: m.G2,
    nullifier: m.GN,
    asset_tag: m.GA,
  }))
    assert.equal(m.hex(m.encode(p)), f.generators[name]);
  assert.equal(m.hex(m.hashAsset(m.bytes(f.asset.bytes))), f.asset.h);
  assert.equal(m.keysetId(f.parameters.public_key), f.parameters.keyset_id);
});
test("v3 committed issuance verifies and reconstructs the entire transcript", () =>
  assert.equal(m.issue(f.issue, pk), f.issue.transcript));
test("issued credential verifies; bearer token decodes with identical fields", () => {
  m.credential(f.credential, pk);
  assert.deepEqual(m.decodeToken(f.token), f.credential);
});
test("public showing pairing, owner proof and exact transcript match", () => {
  const result = show();
  assert.equal(result.transcript, f.showing.transcript);
  assert.equal(
    result.nullifier,
    m.hex(m.encode(m.multiply(m.GN, m.scalar(f.credential.s)))),
  );
});
test("blind transfer verifies both ownership proofs and mixed-group transcript", () => {
  const result = claim();
  assert.equal(result.transcript, f.transfer.transcript);
  assert.equal(result.ownerTranscript, f.transfer.owner_transcript);
  assert.equal(
    result.presentationTranscript,
    f.transfer.presentation_transcript,
  );
  assert.equal(result.nullifier, show().nullifier);
});
test("blind response unblinds into credential for the new secret and nullifier", () => {
  const v = m.unblind(
    { u: f.transfer.session_u, v: f.transfer.response_v, keyset_id: pk.id },
    f.transfer.session_u,
    pk.id,
    f.test_secrets.t,
    pk,
  );
  assert.equal(v, f.transfer.unblinded_v);
  m.credential(
    { ...f.credential, u: f.transfer.session_u, v, s: f.test_secrets.new_s },
    pk,
  );
  assert.equal(
    m.hex(m.encode(m.multiply(m.GN, m.scalar(f.test_secrets.new_s)))),
    f.transfer.new_nullifier,
  );
  assert.notEqual(f.transfer.new_nullifier, show().nullifier);
});

for (const [label, value] of Object.entries({
  short: "00",
  uppercase: f.asset.h.toUpperCase(),
  order: m.hex(m.integer(m.Q)),
  tooLarge: "ff".repeat(32),
  sign: "-".repeat(64),
})) {
  test(`reject noncanonical scalar: ${label}`, () =>
    assert.throws(() => m.scalar(value)));
}
test("reject zero owner secret, allow zero general scalar", () => {
  assert.equal(m.scalar("00".repeat(32)), 0n);
  assert.throws(() => m.scalar("00".repeat(32), true));
});
for (const group of [1, 2]) {
  test(`reject G${group} infinity at nonidentity boundary`, () =>
    assert.throws(() =>
      m.point("c0" + "00".repeat(group === 1 ? 47 : 95), group),
    ));
  test(`reject G${group} on-curve point outside the prime-order subgroup`, () =>
    assert.throws(() =>
      m.point(f.invalid_points[`g${group}_not_in_subgroup`], group),
    ));
  test(`reject G${group} malformed compressed encoding`, () =>
    assert.throws(() => m.point("ff".repeat(group === 1 ? 48 : 96), group)));
}
test("reject uncompressed, truncated and trailing point bytes", () => {
  for (const p of [
    f.generators.g1.slice(2),
    f.generators.g1 + "00",
    "04" + "00".repeat(95),
  ])
    assert.throws(() => m.point(p));
});
test("reject mismatched keyset digest", () =>
  assert.throws(() =>
    m.parameters({ ...f.parameters, keyset_id: "03" + "00".repeat(32) }),
  ));
test("reject cross-group Yh inconsistency even with recomputed keyset", () => {
  const public_key =
    f.parameters.public_key.slice(0, 576) +
    changedPoint(f.parameters.public_key.slice(576));
  assert.throws(() =>
    m.parameters({ public_key, keyset_id: m.keysetId(public_key) }),
  );
});
for (const field of ["h", "s"])
  test(`reject credential with changed ${field}`, () =>
    assert.throws(() =>
      m.credential(
        { ...f.credential, [field]: changedScalar(f.credential[field]) },
        pk,
      ),
    ));
test("reject credential with changed signature", () =>
  assert.throws(() =>
    m.credential({ ...f.credential, v: changedPoint(f.credential.v) }, pk),
  ));
test("reject credential from another trusted keyset", () =>
  assert.throws(() =>
    m.credential({ ...f.credential, keyset_id: "03" + "00".repeat(32) }, pk),
  ));
test("reject old issuance version, changed session and changed keyset context", () => {
  assert.throws(() => m.issue({ ...f.issue, version: 2 }, pk));
  assert.throws(() => m.issue({ ...f.issue, session: "ff".repeat(16) }, pk));
  assert.throws(() => m.issue(f.issue, { ...pk, id: "03" + "00".repeat(32) }));
});
for (const field of ["asset_tag", "b", "owner_commitment"])
  test(`reject issuance changed ${field}`, () =>
    assert.throws(() =>
      m.issue({ ...f.issue, [field]: changedPoint(f.issue[field]) }, pk),
    ));
test("reject noncanonical, truncated and trailing proof scalar bytes", () => {
  for (const proof of [
    m.hex(m.integer(m.Q)) + f.issue.proof.slice(64),
    f.issue.proof.slice(2),
    f.issue.proof + "00",
  ])
    assert.throws(() => m.issue({ ...f.issue, proof }, pk));
});
test("reject a different transcript domain, equation order or witness index", () => {
  const equations = [
    [m.point(f.issue.asset_tag), [[m.GA, 0]]],
    [m.point(f.issue.b), [[pk.Yh1, 0]]],
    [m.point(f.issue.owner_commitment), [[m.G1, 1]]],
  ];
  const context = m.concat(m.bytes(pk.id), m.bytes(f.issue.session));
  assert.throws(() =>
    m.linear(equations, f.issue.proof, 2, "Cashu_PS_BlindIssue_v2", context),
  );
  assert.throws(() =>
    m.linear(
      [...equations].reverse(),
      f.issue.proof,
      2,
      "Cashu_PS_CommittedIssue_v3",
      context,
    ),
  );
  equations[0][1][0][1] = 1;
  assert.throws(() =>
    m.linear(
      equations,
      f.issue.proof,
      2,
      "Cashu_PS_CommittedIssue_v3",
      context,
    ),
  );
});
test("reject changed showing profile, asset and trailing bytes", () => {
  assert.throws(() => show(f.showing.encoded, "43".repeat(32)));
  assert.throws(() =>
    show(f.showing.encoded, f.showing.profile, changedScalar(f.asset.h)),
  );
  assert.throws(() => show(f.showing.encoded + "00"));
});
test("reject rewrapped showing under a new profile with the old owner proof", () => {
  const raw = m.bytes(f.showing.encoded.slice(6)),
    length = raw[0] * 256 + raw[1];
  const text = new TextDecoder()
    .decode(raw.slice(2, length + 2))
    .replace(f.showing.profile, "43".repeat(32));
  const replay =
    "pshow1" +
    m.hex(
      m.concat(m.frame(new TextEncoder().encode(text)), raw.slice(length + 2)),
    );
  assert.throws(() => show(replay, "43".repeat(32)));
});
test("reject showing with changed V while the owner DLEQ still holds", () => {
  const raw = m.bytes(f.showing.encoded.slice(6)),
    length = raw[0] * 256 + raw[1],
    offset = length + 2 + 113;
  const encoded = replaceBytes(
    m.hex(raw),
    offset,
    changedPoint(m.hex(raw.slice(offset, offset + 48))),
  );
  assert.throws(() => show("pshow1" + encoded));
});
for (const field of ["session_u", "b", "new_owner_commitment"])
  test(`reject blind transfer changed ${field}`, () =>
    assert.throws(() => claim({ [field]: changedPoint(f.transfer[field]) })));
test("reject blind transfer changed hidden signature, commitment, T and nullifier", () => {
  for (const [offset, size, group] of [
    [81, 48, 1],
    [129, 96, 2],
    [225, 48, 1],
    [273, 48, 1],
  ]) {
    const old = f.transfer.presentation.slice(offset * 2, (offset + size) * 2);
    assert.throws(() =>
      claim({
        presentation: replaceBytes(
          f.transfer.presentation,
          offset,
          changedPoint(old, group),
        ),
      }),
    );
  }
});
test("reject changed new-owner proof and transfer keyset", () => {
  assert.throws(() =>
    claim({
      new_proof:
        changedScalar(f.transfer.new_proof.slice(0, 64)) +
        f.transfer.new_proof.slice(64),
    }),
  );
  assert.throws(() =>
    claim({
      presentation: replaceBytes(
        f.transfer.presentation,
        0,
        "03" + "00".repeat(32),
      ),
    }),
  );
});
test("reject changed response base or keyset before unblinding", () => {
  const response = {
    u: f.transfer.session_u,
    v: f.transfer.response_v,
    keyset_id: pk.id,
  };
  assert.throws(() =>
    m.unblind(
      { ...response, u: changedPoint(response.u) },
      response.u,
      pk.id,
      f.test_secrets.t,
      pk,
    ),
  );
  assert.throws(() =>
    m.unblind(
      { ...response, keyset_id: "03" + "00".repeat(32) },
      response.u,
      pk.id,
      f.test_secrets.t,
      pk,
    ),
  );
});
test("wrong unblinding secret or old owner cannot verify the new credential", () => {
  const v = m.unblind(
    { u: f.transfer.session_u, v: f.transfer.response_v, keyset_id: pk.id },
    f.transfer.session_u,
    pk.id,
    changedScalar(f.test_secrets.t),
    pk,
  );
  assert.throws(() =>
    m.credential(
      { ...f.credential, u: f.transfer.session_u, v, s: f.test_secrets.new_s },
      pk,
    ),
  );
  assert.throws(() =>
    m.credential(
      { ...f.credential, u: f.transfer.session_u, v: f.transfer.unblinded_v },
      pk,
    ),
  );
});
test("reject malformed token prefix, length and trailing bytes", () => {
  for (const token of [
    "psnft2" + f.token.slice(6),
    f.token.slice(0, -2),
    f.token + "00",
  ])
    assert.throws(() => m.decodeToken(token));
});
