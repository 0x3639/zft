import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Home } from "../apps/web/src/discovery-pages";
import {
  nextAction,
  savedStatus,
  stageDescription,
  type Selection,
} from "../apps/web/src/shielded/experience";
const picture = (overrides: Partial<Selection> = {}): Selection => ({
  id: "saved",
  kind: "create",
  name: "A picture",
  assetId: "asset",
  imageHash: "image",
  state: "prepared",
  acknowledged: false,
  proofReady: false,
  needsObservation: false,
  image: new Uint8Array(),
  ...overrides,
});
describe("Finding and finishing shielded pictures", () => {
  it("never describes a draft, reservation or uncertain submission as completed", () => {
    expect(nextAction(picture())).toBe("backup");
    expect(stageDescription(picture())).toContain("not been created");
    const waiting = picture({
      state: "unobserved",
      acknowledged: true,
      creationProgress: { phase: "waiting", blocksRemaining: 2 },
    });
    expect(nextAction(waiting)).toBe("wait");
    expect(stageDescription(waiting)).toContain("creation is not finished");
    expect(
      nextAction(
        picture({ state: "uncertain", acknowledged: true, proofReady: true }),
      ),
    ).toBe("check");
    expect(
      nextAction(picture({ state: "observed", needsObservation: true })),
    ).toBe("check");
    expect(nextAction(picture({ state: "observed" }))).toBe("complete");
    expect(stageDescription(picture({ state: "observed" }))).toContain(
      "not guaranteed finality",
    );
  });
  it("keeps backup, renewal, proof and wallet submission as distinct next actions", () => {
    expect(nextAction(picture({ acknowledged: true }))).toBe("prove");
    expect(nextAction(picture({ acknowledged: true, proofReady: true }))).toBe(
      "submit",
    );
    expect(
      nextAction(
        picture({
          acknowledged: true,
          creationProgress: { phase: "expired", blocksRemaining: 0 },
        }),
      ),
    ).toBe("renew");
    for (const state of ["historical", "conflicted"])
      expect(nextAction(picture({ state }))).toBe("history");
    expect(savedStatus("prepared")).toBe("Saved draft");
    expect(savedStatus("observed")).toBe("Observed on devnet");
  });
  it("homepage creation, receipt and recovery links enter shielded app with real navigation", () => {
    const html = renderToStaticMarkup(
      React.createElement(Home, {
        nav: () => {},
        onUnlock: () => {},
        path: "/",
        sponsorEnabled: false,
        indexMessage: "",
      }),
    );
    expect(html.match(/href="\/shielded\/create"/g)).toHaveLength(2);
    for (const path of ["/shielded", "/shielded/claim", "/shielded/recovery"])
      expect(html).toContain(`href="${path}"`);
    expect(html).not.toContain("Create your collection");
    expect(html).toContain("older wallet ZFTs");
  });
});
