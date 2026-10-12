import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "fast-png";
import { IDBFactory } from "fake-indexeddb";
import { startAnvil } from "../../shielded-lab/evm-test.mjs";
import { deployFixture } from "../../shielded-lab/local-fixture.mjs";
import { closeProver } from "../../shielded-lab/prover.mjs";
import { createProfile, canonical } from "../../shielded-lab/core.mjs";
import { openRecovery } from "../../shielded-lab/recovery.mjs";
import { pinDeployment } from "../../shielded-lab/chain.mjs";
import { pngChunks } from "../../../packages/file-codec/index.ts";
import { shieldedGallery } from "../../../apps/api/shielded-gallery.ts";
import { publicStore } from "../public-store.mjs";
import {
  createShieldedClient,
  parseConfiguration,
  connectWallet,
  MESSAGES,
} from "../../../packages/shielded/client.mjs";
import {
  origin,
  password,
  configText,
  configuration,
  prover,
  providerFor,
} from "./support.mjs";
const picture = () =>
  encode({
    width: 2,
    height: 1,
    channels: 4,
    depth: 8,
    data: new Uint8Array([10, 40, 90, 255, 200, 40, 90, 255]),
  });
async function fixture(action) {
  const evm = await startAnvil(),
    clients = [];
  try {
    const deployed = await deployFixture(evm),
      text = configText(evm, deployed.pins);
    const create = async (options = {}) => {
      const c = await createShieldedClient({
        text,
        origin,
        indexedDB: new IDBFactory(),
        prover,
        ...options,
      });
      clients.push(c);
      return c;
    };
    await action({ evm, deployed, text, create });
  } finally {
    clients.forEach((c) => c.close());
    await evm.stop();
    await closeProver();
  }
}
async function wallet(c, evm) {
  const provider = providerFor(evm),
    w = await connectWallet(provider, c.config.pins);
  c.setWallet(w);
  return provider;
}
async function acknowledge(c) {
  const recovery = await c.exportRecovery();
  await c.acknowledge(recovery, password);
  return recovery;
}
async function mint(c, evm) {
  await wallet(c, evm);
  await c.prepareCreate(
    picture(),
    "Integration picture",
    "Disposable user-custody test",
    password,
  );
  await acknowledge(c);
  await c.prove();
  assert.equal((await c.submit(password)).phase, "committed");
  await evm.mine(2);
  await c.prove();
  assert.equal((await c.submit(password)).state, "observed");
  return c.exportBearer(password);
}
test("configuration pins exact artifacts and rejects hidden fields, foreign URLs and insecure remote RPC", () =>
  fixture(async ({ evm, deployed, text }) => {
    assert.equal(parseConfiguration(text, origin).pins.chainId, "31337");
    for (const change of [
      (c) => (c.extra = true),
      (c) => (c.artifacts["create-key"].sha256 = "0x" + "0".repeat(64)),
      (c) => (c.artifacts.library.url = "https://evil.invalid/bundle.js"),
      (c) => (c.artifacts.library.url = "/shielded-assets/a/../b"),
      (c) => (c.artifacts.library.bytes = 33554433),
      (c) => (c.rpc = "http://example.com/"),
      (c) => (c.rpc = "https://user:password@example.com/"),
      (c) => (c.rpc = "https://example.com/?key=secret"),
    ]) {
      const c = configuration(evm, deployed.pins);
      change(c);
      assert.throws(
        () => parseConfiguration(canonical(c), origin),
        "Configuration substitution must reject",
      );
    }
    assert.throws(
      () => parseConfiguration(text, "https://zft.foo"),
      "Remote origin cannot select local HTTP fixture",
    );
  }));
test("real create/claim recovery preserves destination, isolates two journals and sends no spending secrets to wallets", () =>
  fixture(async ({ evm, create }) => {
    const a = await create(),
      requests = await wallet(a, evm);
    await a.prepareCreate(
      picture(),
      "A picture",
      "Saved before broadcast",
      password,
    );
    await assert.rejects(a.prove(), (e) => e.message === MESSAGES.unavailable);
    await assert.rejects(
      a.submit(password),
      (e) => e.message === MESSAGES.unavailable,
    );
    const recovery = await acknowledge(a),
      p = await createProfile(),
      opened = await openRecovery(
        recovery,
        password,
        p,
        pinDeployment(a.config.pins),
      );
    await a.restore(recovery, password);
    await assert.rejects(
      a.prove(),
      "Restored acknowledged operation must observe before proving",
    );
    assert.equal(await a.observe(password), "unobserved");
    await a.prove();
    assert.equal((await a.submit(password)).phase, "committed");
    assert.equal((await a.snapshot()).selected.state, "unobserved");
    await evm.mine(2);
    await a.prove();
    assert.equal((await a.submit(password)).state, "observed");
    const bearer = await a.exportBearer(password),
      publicImage = await a.exportPublic();
    assert.deepEqual(
      pngChunks(publicImage).map((c) => c.type),
      ["IHDR", "IDAT", "IEND"],
    );
    const b = await create();
    assert.equal((await b.snapshot()).operations.length, 0);
    await wallet(b, evm);
    await b.prepareClaim(bearer, password);
    const saved = await acknowledge(b),
      before = (await b.snapshot()).selected;
    await b.prove();
    assert.equal((await b.submit(password)).state, "observed");
    assert.equal(await a.observe(password), "historical");
    await assert.rejects(a.exportBearer(password));
    const old = await create();
    await assert.rejects(
      old.prepareClaim(bearer, password),
      "Old bearer cannot claim",
    );
    const fresh = await create();
    await fresh.restore(saved, password);
    assert.equal((await fresh.snapshot()).selected.id, before.id);
    await assert.rejects(fresh.prove());
    assert.equal(await fresh.observe(password), "observed");
    const recovered = await fresh.exportBearer(password);
    assert.deepEqual(
      recovered,
      await b.exportBearer(password),
      "Fresh-client recovery retains exact saved successor",
    );
    const wire = JSON.stringify(requests.calls);
    assert.ok(
      !wire.includes(opened.record.destination.secret),
      "Wallet never receives spending secret",
    );
    assert.ok(
      !wire.includes(opened.record.destination.randomness),
      "Wallet never receives note randomness",
    );
    assert.ok(
      !wire.includes(password),
      "Wallet never receives recovery password",
    );
    assert.ok(
      !wire.includes("zft-shielded-operation-v1"),
      "Wallet never receives recovery object",
    );
  }));
test("lost wallet response leaves durable uncertainty and explicit observation resolves the same operation", () =>
  fixture(async ({ evm, create }) => {
    const a = await create();
    const bearer = await mint(a, evm);
    const b = await create(),
      provider = await wallet(b, evm);
    await b.prepareClaim(bearer, password);
    const saved = await acknowledge(b),
      id = (await b.snapshot()).selected.id;
    await b.prove();
    provider.afterSend(() => {
      throw Error("provider secret diagnostic");
    });
    await assert.rejects(
      b.submit(password),
      (e) =>
        e.message === MESSAGES.unavailable && !e.message.includes("diagnostic"),
    );
    assert.equal(
      (await b.snapshot()).selected.state,
      "uncertain",
      "Lost response must retain uncertainty",
    );
    await assert.rejects(b.prove(), "Uncertain must observe before retry");
    assert.equal(await b.observe(password), "observed");
    assert.equal((await b.snapshot()).selected.id, id);
    const fresh = await create();
    await fresh.restore(saved, password);
    assert.equal(await fresh.observe(password), "observed");
  }));
test("changed wallet account or chain blocks signing and transaction dispatch", () =>
  fixture(async ({ evm, create }) => {
    const c = await create(),
      provider = await wallet(c, evm);
    provider.setChain("0x1");
    await assert.rejects(
      c.prepareCreate(picture(), "Wrong chain", "", password),
    );
    assert.equal(
      provider.calls.filter((c) => c.method === "eth_signTypedData_v4").length,
      0,
    );
    provider.setChain("0x7a69");
    await c.prepareCreate(picture(), "Expected chain", "", password);
    await acknowledge(c);
    await c.prove();
    provider.setAccount("0x" + "1".repeat(40));
    await assert.rejects(c.submit(password));
    assert.equal(
      provider.calls.filter((c) => c.method === "eth_sendTransaction").length,
      0,
      "Account change must block transaction",
    );
    assert.equal((await c.snapshot()).selected.state, "prepared");
  }));
test("acknowledgement rejects wrong exports, and altered proof statements cannot become submittable", () =>
  fixture(async ({ evm, create }) => {
    const c = await create({
      prover: {
        prove: async (...args) => {
          const r = await prover.prove(...args);
          r.publicSignals[3] = String(BigInt(r.publicSignals[3]) + 1n);
          return r;
        },
        cancel() {},
      },
    });
    await wallet(c, evm);
    await c.prepareCreate(picture(), "Proof binding", "", password);
    const saved = await c.exportRecovery();
    await assert.rejects(c.acknowledge(saved + " ", password));
    await acknowledge(c);
    await assert.rejects(c.prove(), "Changed output must reject");
    assert.equal((await c.snapshot()).selected.proofReady, false);
    await assert.rejects(c.submit(password));
  }));
test("close during proving discards late valid result and leaves only encrypted recovery", () =>
  fixture(async ({ evm, create }) => {
    let release, started;
    const entered = new Promise((r) => (started = r));
    const c = await create({
      prover: {
        async prove(...args) {
          const r = await prover.prove(...args);
          started();
          await new Promise((r) => (release = r));
          return r;
        },
        cancel() {},
      },
    });
    await wallet(c, evm);
    await c.prepareCreate(picture(), "Lock during proof", "", password);
    const saved = await acknowledge(c);
    const pending = c.prove();
    await entered;
    c.close();
    release();
    await assert.rejects(pending, (e) => e.message === MESSAGES.closed);
    await assert.rejects(c.snapshot());
    const fresh = await create();
    await fresh.restore(saved, password);
    assert.equal(await fresh.observe(password), "unobserved");
  }));
test("renewed creation authorization keeps the saved destination and requires a new saved-file acknowledgement", () =>
  fixture(async ({ evm, create }) => {
    const c = await create();
    await wallet(c, evm);
    await c.prepareCreate(picture(), "Renewed creation", "", password);
    const original = await acknowledge(c);
    await c.renewCreation(password);
    const next = await c.exportRecovery(),
      p = await createProfile(),
      d = pinDeployment(c.config.pins);
    const a = await openRecovery(original, password, p, d),
      b = await openRecovery(next, password, p, d);
    assert.notEqual(a.record.id, b.record.id);
    assert.deepEqual(
      a.record.destination,
      b.record.destination,
      "Renewal must preserve destination authority",
    );
    await assert.rejects(c.acknowledge(original, password));
    assert.equal((await c.snapshot()).selected.acknowledged, false);
  }));

test("wallet RPC must match pinned genesis and code before authorization", () =>
  fixture(async ({ evm, deployed }) => {
    const p = providerFor(evm),
      original = p.request;
    p.request = async (r) => {
      const result = await original(r);
      return r.method === "eth_getBlockByNumber" && r.params[0] === "0x0"
        ? { ...result, hash: "0x" + "9".repeat(64) }
        : result;
    };
    await assert.rejects(
      connectWallet(p, deployed.pins),
      /Wrong chain\/genesis/,
      "Wallet's own RPC must match selected genesis",
    );
    assert.equal(p.listeners.size, 0, "Failed connection removes listeners");
    assert.equal(
      p.calls.filter(
        (r) =>
          r.method === "eth_signTypedData_v4" ||
          r.method === "eth_sendTransaction",
      ).length,
      0,
    );
  }));
test("saved pictures remain discoverable after reopen without selecting or sending anything", () =>
  fixture(async ({ evm, create }) => {
    const indexedDB = new IDBFactory(),
      a = await create({ indexedDB });
    await wallet(a, evm);
    await a.prepareCreate(
      picture(),
      "Find me after reload",
      "Saved draft",
      password,
    );
    const before = await a.snapshot(),
      id = before.selected.id;
    a.close();
    const reopened = await create({ indexedDB });
    assert.equal(
      typeof reopened.inspect,
      "function",
      "gallery must inspect encrypted saved pictures without selecting them",
    );
    const listing = await reopened.snapshot();
    assert.equal(listing.selected, null);
    assert.equal(listing.operations[0].id, id);
    const preview = await reopened.inspect(id, password);
    assert.equal(preview.name, "Find me after reload");
    assert.deepEqual(preview.image, before.selected.image);
    assert.deepEqual(
      Object.keys(preview).sort(),
      ["id", "image", "name"],
      "gallery exposes no spending secret or recovery material",
    );
    assert.deepEqual(
      await reopened.snapshot(),
      listing,
      "gallery inspection must not change selection or journal state",
    );
    await assert.rejects(
      reopened.inspect(id, "wrong but sufficiently long password"),
    );
    assert.deepEqual(await reopened.snapshot(), listing);
  }));
test("creation progress distinguishes lost reservation response, waiting, reveal and completed picture", () =>
  fixture(async ({ evm, create }) => {
    const indexedDB = new IDBFactory(),
      a = await create({ indexedDB }),
      provider = await wallet(a, evm);
    await a.prepareCreate(
      picture(),
      "Two explicit transactions",
      "Never call a reservation created",
      password,
    );
    await acknowledge(a);
    await a.prove();
    assert.equal(
      (await a.snapshot()).selected.creationProgress?.phase,
      "commit",
      "creation progress must identify the first transaction before submission",
    );
    provider.afterSend(() => {
      throw Error("Disposable response loss");
    });
    await assert.rejects(a.submit(password));
    const uncertain = await a.snapshot(),
      id = uncertain.selected.id;
    assert.equal(uncertain.selected.state, "uncertain");
    a.close();
    const b = await create({ indexedDB });
    await b.unlock(id, password);
    assert.equal((await b.snapshot()).selected.needsObservation, true);
    assert.equal(await b.observe(password), "unobserved");
    assert.deepEqual((await b.snapshot()).selected.creationProgress, {
      phase: "waiting",
      blocksRemaining: 2,
    });
    await assert.rejects(
      b.prove(),
      "must not generate a reveal proof while the reservation is still waiting",
    );
    await evm.mine(2);
    await b.observe(password);
    assert.equal(
      (await b.snapshot()).selected.creationProgress.phase,
      "reveal",
    );
    await wallet(b, evm);
    await b.prove();
    assert.equal((await b.submit(password)).state, "observed");
    const c = await create({ indexedDB });
    assert.equal(
      (await c.inspect(id, password)).name,
      "Two explicit transactions",
    );
    await c.unlock(id, password);
    await c.observe(password);
    assert.equal((await c.snapshot()).selected.state, "observed");
  }));

test("public gallery finds a completed creation after lost response without exporting custody material", () =>
  fixture(async ({ evm, deployed, create }) => {
    const indexedDB = new IDBFactory(),
      a = await create({ indexedDB }),
      provider = await wallet(a, evm);
    await a.prepareCreate(
      picture(),
      "Visible shielded picture",
      "Public by default",
      password,
    );
    await assert.rejects(
      a.exportPublication(),
      "A local draft must stay out of the public gallery",
    );
    await acknowledge(a);
    await a.prove();
    await a.submit(password);
    await assert.rejects(
      a.exportPublication(),
      "A reservation is not a creation",
    );
    await evm.mine(2);
    await a.observe(password);
    await a.prove();
    provider.afterSend(() => {
      throw Error("Disposable lost creation response");
    });
    await assert.rejects(a.submit(password));
    const id = (await a.snapshot()).selected.id;
    await assert.rejects(
      a.exportPublication(),
      "An uncertain submission must be observed first",
    );
    a.close();
    const b = await create({ indexedDB });
    await b.unlock(id, password);
    await assert.rejects(
      b.exportPublication(),
      "Reopening does not assert creation",
    );
    assert.equal(await b.observe(password), "observed");
    const before = await b.snapshot();
    let body;
    await assert.doesNotReject(async () => {
      body = await b.exportPublication();
    }, "A completed public export must succeed without a journal write");
    assert.deepEqual(
      await b.snapshot(),
      before,
      "Publication export must not change the encrypted record",
    );
    assert.deepEqual(Object.keys(body).sort(), [
      "assetId",
      "format",
      "image",
      "metadata",
      "transactionHash",
    ]);
    assert.deepEqual(Object.keys(body.metadata).sort(), [
      "canonicalizer",
      "createdAt",
      "creator",
      "description",
      "format",
      "height",
      "imageHash",
      "mediaType",
      "name",
      "width",
    ]);
    assert.deepEqual(
      new Uint8Array(Buffer.from(body.image, "base64")),
      before.selected.image,
    );
    const recovery = await b.exportRecovery(),
      opened = await openRecovery(
        recovery,
        password,
        await createProfile(),
        pinDeployment(deployed.pins),
      );
    for (const field of ["secret", "randomness"])
      assert.ok(
        !JSON.stringify(body).includes(opened.record.destination[field]),
      );
    const gallery = shieldedGallery(
      publicStore(),
      evm.client,
      configuration(evm, deployed.pins),
    );
    const published = await gallery.publish(body);
    assert.equal(published.assetId, before.selected.assetId);
    assert.deepEqual((await gallery.list(null)).items, [published]);
    assert.deepEqual(await gallery.image(body.assetId), before.selected.image);
    await gallery.publish(body);
    assert.equal(
      (await gallery.list(null)).items.length,
      1,
      "Retry must not add another ZFT",
    );
    assert.deepEqual(await b.snapshot(), before);
  }));
