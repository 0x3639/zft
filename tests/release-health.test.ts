import { describe, expect, it } from "vitest";
import { releaseConfig, releaseHealth } from "../scripts/release-health";
import manifest from "../packages/protocol/deployment.json";

const healthy = {
  ready: true,
  network: "ZVM devnet",
  sponsorEnabled: true,
  index: {
    block: 100,
    head: 106,
    syncedAt: 1791276200358,
    error: null,
    lag: 6,
    confirmations: 6,
  },
};

describe("hosted release health gate", () => {
  it("accepts a ready deployment indexed through the confirmation window", () => {
    expect(releaseHealth.parse(healthy)).toEqual(healthy);
  });

  it.each([
    ["not ready", { ...healthy, ready: false }],
    ["missing index", { ...healthy, index: undefined }],
    [
      "index error",
      { ...healthy, index: { ...healthy.index, error: "RPC unavailable" } },
    ],
    [
      "uninitialized index",
      { ...healthy, index: { ...healthy.index, block: null } },
    ],
    [
      "lagging index",
      { ...healthy, index: { ...healthy.index, block: 99, lag: 7 } },
    ],
    [
      "inconsistent index",
      { ...healthy, index: { ...healthy.index, head: 107 } },
    ],
    ["wrong network", { ...healthy, network: "another network" }],
    ["disabled sponsor", { ...healthy, sponsorEnabled: false }],
  ])("rejects HTTP-200 health data with %s", (_label, body) => {
    expect(() => releaseHealth.parse(body)).toThrow();
  });
});

describe("hosted frontend configuration gate", () => {
  it("accepts the pinned deployment with sponsorship enabled", () => {
    const config = { deployment: manifest, sponsorEnabled: true };
    expect(releaseConfig.parse(config)).toEqual(config);
  });
  it.each([
    ["missing deployment", { sponsorEnabled: true }],
    [
      "different contract",
      {
        deployment: {
          ...manifest,
          contract: "0x1111111111111111111111111111111111111111",
        },
        sponsorEnabled: true,
      },
    ],
    [
      "changed genesis",
      {
        deployment: { ...manifest, genesisHash: "0x" + "0".repeat(64) },
        sponsorEnabled: true,
      },
    ],
    ["disabled sponsorship", { deployment: manifest, sponsorEnabled: false }],
  ])("rejects HTTP-200 configuration with %s", (_label, config) => {
    expect(() => releaseConfig.parse(config)).toThrow();
  });
});
