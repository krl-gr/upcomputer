import { describe, expect, it, vi } from "vite-plus/test";

import { openScratchHomeDraft } from "./scratchHomeDraft";

describe("openScratchHomeDraft", () => {
  it("opens the scratch draft while home is still shown", async () => {
    const openDraft = vi.fn(() => Promise.resolve({ draftId: "d" }));
    await expect(
      openScratchHomeDraft({
        openScratchProject: () => Promise.resolve({ id: "scratch" }),
        isStillHome: () => true,
        openDraft,
      }),
    ).resolves.toBe("opened");
    expect(openDraft).toHaveBeenCalledWith({ id: "scratch" });
  });

  it("does nothing when the user left home while the scratch project was opening", async () => {
    let resolveScratch: (project: { id: string }) => void = () => {};
    let onHome = true;
    const openDraft = vi.fn(() => Promise.resolve({ draftId: "d" }));
    const outcome = openScratchHomeDraft({
      openScratchProject: () =>
        new Promise<{ id: string }>((resolve) => {
          resolveScratch = resolve;
        }),
      isStillHome: () => onHome,
      openDraft,
    });
    onHome = false;
    resolveScratch({ id: "scratch" });
    await expect(outcome).resolves.toBe("left");
    expect(openDraft).not.toHaveBeenCalled();
  });

  it("reports a failure when either step gives nothing", async () => {
    await expect(
      openScratchHomeDraft({
        openScratchProject: () => Promise.resolve(null),
        isStillHome: () => true,
        openDraft: () => Promise.resolve({}),
      }),
    ).resolves.toBe("failed");
    await expect(
      openScratchHomeDraft({
        openScratchProject: () => Promise.resolve({}),
        isStillHome: () => true,
        openDraft: () => Promise.resolve(null),
      }),
    ).resolves.toBe("failed");
  });
});
