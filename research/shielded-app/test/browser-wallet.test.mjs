import test from "node:test";
import assert from "node:assert/strict";

for (const accepted of [true, false])
  test(`paused test signatures preserve the first request and settle on ${accepted ? "approval" : "rejection"}`, async () => {
    const saved = new Map(
      ["window", "document", "location", "fetch"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    const controls = Object.fromEntries(
      [
        "test-pause-signature",
        "test-approve-signature",
        "test-reject-signature",
        "test-mine",
        "test-state",
      ].map((id) => [id, { checked: true, disabled: true, onclick: null }]),
    );
    const globals = {
      window: {},
      document: { getElementById: (id) => controls[id] },
      location: { hostname: "127.0.0.1" },
      fetch: async (url) => {
        assert.equal(
          url,
          "/test/config.json",
          "Signing must not send a network request",
        );
        return Response.json({
          pins: { chainId: "31337" },
          rpc: "http://127.0.0.1:12345/",
        });
      },
    };
    try {
      for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
          configurable: true,
          writable: true,
          value,
        });
      await import(`../browser-wallet.mjs?signature-test=${accepted}`);
      const provider = globals.window.ethereum,
        approve = controls["test-approve-signature"],
        reject = controls["test-reject-signature"],
        request = {
          method: "eth_signTypedData_v4",
          params: [
            "unused",
            JSON.stringify({
              domain: { name: "Disposable test", chainId: 31337 },
              types: { Test: [{ name: "value", type: "uint256" }] },
              primaryType: "Test",
              message: { value: "1" },
            }),
          ],
        };
      const first = provider.request(request).then(
          (value) => ({ value }),
          (error) => ({ error }),
        ),
        firstApprove = approve.onclick,
        firstReject = reject.onclick,
        second = provider.request(request).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      assert.equal(
        approve.onclick,
        firstApprove,
        "A second request must not replace the first approval handler",
      );
      assert.equal(
        reject.onclick,
        firstReject,
        "A second request must not replace the first rejection handler",
      );
      assert.match((await second).error?.message ?? "", /already pending/);
      (accepted ? approve : reject).onclick();
      const result = await first;
      if (accepted) assert.match(result.value, /^0x[0-9a-f]{130}$/);
      else assert.match(result.error.message, /declined/);
      assert.equal(approve.disabled, true);
      assert.equal(reject.disabled, true);
      assert.equal(approve.onclick, null);
      assert.equal(reject.onclick, null);
      const next = provider.request(request).then(
        () => assert.fail("Expected rejection"),
        (error) => error,
      );
      reject.onclick();
      assert.match((await next).message, /declined/);
    } finally {
      for (const [key, descriptor] of saved)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
  });
