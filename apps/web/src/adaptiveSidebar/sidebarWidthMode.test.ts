import { describe, expect, it } from "vite-plus/test";

import {
  SIDEBAR_COMPACT_THRESHOLD,
  SIDEBAR_COMPACT_WIDTH,
  moveSidebarWidthDrag,
  resolveInitialFullSidebarWidth,
  startSidebarWidthDrag,
  type SidebarWidthDrag,
} from "./sidebarWidthMode";

const drag = (start: Parameters<typeof startSidebarWidthDrag>[0], pointerWidths: number[]) =>
  pointerWidths.reduce<SidebarWidthDrag>(moveSidebarWidthDrag, startSidebarWidthDrag(start));

const shown = (state: SidebarWidthDrag) => ({ compact: state.compact, width: state.width });

describe("sidebar width drag", () => {
  it("follows the pointer down to the threshold, then snaps to the column", () => {
    expect(shown(drag({ compact: false, width: 260 }, [220]))).toEqual({
      compact: false,
      width: 220,
    });
    expect(shown(drag({ compact: false, width: 260 }, [SIDEBAR_COMPACT_THRESHOLD]))).toEqual({
      compact: false,
      width: SIDEBAR_COMPACT_THRESHOLD,
    });
    expect(shown(drag({ compact: false, width: 260 }, [SIDEBAR_COMPACT_THRESHOLD - 1]))).toEqual({
      compact: true,
      width: SIDEBAR_COMPACT_WIDTH,
    });
  });

  it("dragged back out of compact, returns at the width it had before", () => {
    expect(shown(drag({ compact: false, width: 260 }, [200, 100, 180]))).toEqual({
      compact: false,
      width: 200,
    });
    expect(shown(drag({ compact: true, width: 300 }, [120, 175]))).toEqual({
      compact: false,
      width: 300,
    });
  });

  it("follows the pointer again once it passes the restored width", () => {
    expect(shown(drag({ compact: true, width: 300 }, [175, 320, 240]))).toEqual({
      compact: false,
      width: 240,
    });
  });

  it("keeps the restored width through several snaps in one drag", () => {
    expect(shown(drag({ compact: false, width: 260 }, [100, 200, 90, 180]))).toEqual({
      compact: false,
      width: 260,
    });
  });
});

describe("resolveInitialFullSidebarWidth", () => {
  it("starts from the stored full width, or the default for none or a column width", () => {
    expect(resolveInitialFullSidebarWidth(300)).toBe(300);
    expect(resolveInitialFullSidebarWidth(null)).toBe(256);
    expect(resolveInitialFullSidebarWidth(SIDEBAR_COMPACT_WIDTH)).toBe(256);
  });
});
