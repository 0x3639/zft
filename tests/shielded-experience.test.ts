import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ShieldedApp from "../apps/web/src/shielded/app";
import { GalleryHome } from "../apps/web/src/gallery";
import {
  draftProblem,
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
    const html = renderToStaticMarkup(React.createElement(GalleryHome));
    expect(html.match(/href="\/shielded\/create"/g)).toHaveLength(2);
    for (const path of ["/shielded", "/shielded/claim", "/shielded/recovery"])
      expect(html).toContain(`href="${path}"`);
    expect(html).not.toContain("Create your collection");
    expect(html).not.toContain("older wallet");
    expect(html).not.toContain('href="/wallet"');
    expect(html).not.toContain('href="/collection"');
    expect(html).toContain("THE PUBLIC GALLERY");
  });
});

describe("Save draft input feedback", () => {
  const valid = {
    ready: true,
    passwordLength: 12,
    create: true,
    account: "connected",
    fileSize: 100,
    name: "A picture",
    description: "",
  };
  it("explains missing prerequisites instead of silently ignoring a click", () => {
    expect(draftProblem({ ...valid, ready: false })).toMatch(
      /Open your collection/,
    );
    expect(draftProblem({ ...valid, passwordLength: 11 })).toMatch(
      /at least 12/,
    );
    expect(draftProblem({ ...valid, account: "" })).toMatch(
      /Connect your fee wallet/,
    );
    expect(draftProblem({ ...valid, fileSize: undefined })).toMatch(
      /Choose a PNG or JPG/,
    );
    expect(draftProblem({ ...valid, fileSize: 0 })).toMatch(
      /Choose a PNG or JPG/,
    );
    expect(draftProblem({ ...valid, name: "  " })).toMatch(
      /Give your picture a name/,
    );
  });
  it("accepts an empty description and validates the actual UTF-8 metadata bounds", () => {
    expect(draftProblem(valid)).toBeUndefined();
    expect(
      draftProblem({
        ...valid,
        name: "é".repeat(128),
        description: "é".repeat(2048),
      }),
    ).toBeUndefined();
    expect(draftProblem({ ...valid, name: "é".repeat(129) })).toMatch(
      /name.*256/,
    );
    expect(draftProblem({ ...valid, description: "é".repeat(2049) })).toMatch(
      /description.*4096/,
    );
    expect(
      draftProblem({ ...valid, fileSize: 10 * 1024 * 1024 }),
    ).toBeUndefined();
    expect(draftProblem({ ...valid, fileSize: 10 * 1024 * 1024 + 1 })).toMatch(
      /10 MiB/,
    );
  });
  it("keeps receipt independent of a connected fee wallet and creation metadata", () => {
    const claim = {
      ...valid,
      create: false,
      account: "",
      name: "",
      fileSize: 11 * 1024 * 1024,
    };
    expect(draftProblem(claim)).toBeUndefined();
    expect(draftProblem({ ...claim, fileSize: undefined })).toMatch(
      /bearer PNG/,
    );
    expect(draftProblem({ ...claim, fileSize: claim.fileSize + 1 })).toMatch(
      /11 MiB/,
    );
  });
});

it("lets an incomplete Create form explain the next required step on Save draft", () => {
  vi.stubGlobal("location", { pathname: "/shielded/create" });
  try {
    const html = renderToStaticMarkup(React.createElement(ShieldedApp));
    const button = html.match(
      /<button[^>]*>Save draft and prepare recovery<\/button>/,
    )?.[0];
    expect(
      button,
      "Save draft must be reachable even before setup is complete",
    ).toBeDefined();
    expect(button).not.toContain("disabled");
  } finally {
    vi.unstubAllGlobals();
  }
});
