import { describe, expect, it } from "vite-plus/test";

import { resolveThreadDetailsTogglePlacement } from "./threadDetailsTogglePlacement";

describe("resolveThreadDetailsTogglePlacement", () => {
  it("shows the toggle once, in the composer row when the row holds the panel controls", () => {
    expect(
      resolveThreadDetailsTogglePlacement({
        enabled: true,
        inComposerRow: true,
        rightPanelOwnsTitleBar: true,
      }),
    ).toBe("composer-row");
  });

  it("keeps upstream's header placements without the row", () => {
    expect(
      resolveThreadDetailsTogglePlacement({
        enabled: true,
        inComposerRow: false,
        rightPanelOwnsTitleBar: false,
      }),
    ).toBe("header");
    expect(
      resolveThreadDetailsTogglePlacement({
        enabled: true,
        inComposerRow: false,
        rightPanelOwnsTitleBar: true,
      }),
    ).toBe("header-overlay");
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    "shows no toggle anywhere when thread details are off (row %s, right panel %s)",
    (inComposerRow, rightPanelOwnsTitleBar) => {
      expect(
        resolveThreadDetailsTogglePlacement({
          enabled: false,
          inComposerRow,
          rightPanelOwnsTitleBar,
        }),
      ).toBeNull();
    },
  );
});
