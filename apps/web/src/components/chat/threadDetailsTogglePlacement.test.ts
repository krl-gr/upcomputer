import { describe, expect, it } from "vite-plus/test";

import { resolveThreadDetailsTogglePlacement } from "./threadDetailsTogglePlacement";

describe("resolveThreadDetailsTogglePlacement", () => {
  it("keeps upstream's header placements", () => {
    expect(
      resolveThreadDetailsTogglePlacement({ enabled: true, rightPanelOwnsTitleBar: false }),
    ).toBe("header");
    expect(
      resolveThreadDetailsTogglePlacement({ enabled: true, rightPanelOwnsTitleBar: true }),
    ).toBe("header-overlay");
  });

  it.each([true, false])(
    "shows no toggle anywhere when thread details are off (right panel %s)",
    (rightPanelOwnsTitleBar) => {
      expect(
        resolveThreadDetailsTogglePlacement({ enabled: false, rightPanelOwnsTitleBar }),
      ).toBeNull();
    },
  );
});
