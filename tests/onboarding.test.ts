import { describe, expect, it, vi } from "vitest";
import { canResumeOnboarding } from "../apps/web/src/onboarding";

describe("Contextual onboarding return", () => {
  it("returns an existing connected profile to Following even with a locked file vault", async () => {
    const read = vi.fn().mockResolvedValue({ name: "Collector" });
    expect(
      await canResumeOnboarding(
        "/activity?view=following",
        {
          profile: "0x123",
          unlocked: false,
          backedUp: false,
        },
        read,
      ),
    ).toBe(true);
    expect(read).toHaveBeenCalledWith("0x123");
  });
  it("does not send an unlocked file session back to guest Following before wallet connection", async () => {
    const read = vi.fn();
    expect(
      await canResumeOnboarding(
        "/activity?view=following",
        {
          unlocked: true,
          backedUp: true,
        },
        read,
      ),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it("waits for a new wallet profile to be saved and for failed lookups to recover", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("Not found"))
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ name: "Collector" });
    const state = { profile: "0x123", unlocked: true, backedUp: true };
    expect(
      await canResumeOnboarding("/activity?view=following", state, read),
    ).toBe(false);
    expect(
      await canResumeOnboarding("/activity?view=following", state, read),
    ).toBe(false);
    expect(
      await canResumeOnboarding("/activity?view=following", state, read),
    ).toBe(true);
  });
  it("preserves public profile and file-backup return gates", async () => {
    const read = vi.fn().mockResolvedValue({ name: "Collector" });
    const state = { profile: "0x123", unlocked: false, backedUp: false };
    expect(
      await canResumeOnboarding("/p/0x123?tab=activity", state, read),
    ).toBe(true);
    expect(await canResumeOnboarding("/collection", state, read)).toBe(false);
    expect(
      await canResumeOnboarding(
        "/collection",
        { ...state, unlocked: true },
        read,
      ),
    ).toBe(false);
    expect(
      await canResumeOnboarding(
        "/collection",
        { unlocked: true, backedUp: true },
        read,
      ),
    ).toBe(true);
  });
});
