import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX,
  resolveComposerControlsLayout,
  shouldUseCompactComposerPrimaryActions,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerPrimaryActions", () => {
  it("matches the wide footer breakpoint", () => {
    expect(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX).toBe(
      COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
    );
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });

  it("stays expanded without wide actions or a measured width", () => {
    expect(shouldUseCompactComposerPrimaryActions(320)).toBe(false);
    expect(shouldUseCompactComposerPrimaryActions(null, { hasWideActions: true })).toBe(false);
  });
});

describe("resolveComposerControlsLayout", () => {
  const measurement = {
    gap: 4,
    fixedWidth: 140,
    blockWidths: [80, 140],
    iconOnlyBlockWidths: [40, 60],
    overflowWidth: 24,
  };

  it("keeps labels while they fit and removes trailing labels before controls", () => {
    for (const [hostWidth, iconOnlyCount, hiddenCount] of [
      [368, 0, 0],
      [367, 1, 0],
      [288, 1, 0],
      [287, 2, 0],
      [248, 2, 0],
      [247, 2, 1],
      [211, 2, 2],
      [100, 2, 2],
    ] as const) {
      expect(resolveComposerControlsLayout({ ...measurement, hostWidth })).toEqual({
        hiddenCount,
        iconOnlyCount,
      });
    }
  });

  it("skips label steps for blocks without an icon-only variant", () => {
    const layout = resolveComposerControlsLayout({
      ...measurement,
      iconOnlyBlockWidths: [80, 140],
      hostWidth: 367,
    });
    expect(layout).toEqual({ hiddenCount: 1, iconOnlyCount: 2 });
  });

  it("requires slack to restore labels and controls", () => {
    for (const [hostWidth, previous, promoted] of [
      [368, { hiddenCount: 0, iconOnlyCount: 1 }, { hiddenCount: 0, iconOnlyCount: 0 }],
      [288, { hiddenCount: 0, iconOnlyCount: 2 }, { hiddenCount: 0, iconOnlyCount: 1 }],
      [248, { hiddenCount: 1, iconOnlyCount: 2 }, { hiddenCount: 0, iconOnlyCount: 2 }],
    ] as const) {
      expect(resolveComposerControlsLayout({ ...measurement, hostWidth, previous })).toEqual(
        previous,
      );
      expect(
        resolveComposerControlsLayout({ ...measurement, hostWidth: hostWidth + 1, previous }),
      ).toEqual(promoted);
    }
  });

  it("settles through fractional width changes at each threshold", () => {
    for (const hostWidth of [368, 288, 248]) {
      let previous = resolveComposerControlsLayout({ ...measurement, hostWidth });
      for (let index = 0; index < 10; index += 1) {
        const next = resolveComposerControlsLayout({
          ...measurement,
          hostWidth,
          previous,
          fixedWidth: 140 + (index % 2) * 0.5,
        });
        if (index > 1) expect(next).toEqual(previous);
        previous = next;
      }
    }
  });
});
