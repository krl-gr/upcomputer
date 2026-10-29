/** Below this dragged width the sidebar snaps to its compact column. Also the full sidebar's minimum. */
export const SIDEBAR_COMPACT_THRESHOLD = 170;
/** Width of the compact column. */
export const SIDEBAR_COMPACT_WIDTH = 56;
const SIDEBAR_DEFAULT_WIDTH = 16 * 16;

/** One drag of the sidebar's edge. */
export interface SidebarWidthDrag {
  readonly compact: boolean;
  /** The width the sidebar shows: the compact column's or the full sidebar's. */
  readonly width: number;
  /** The full sidebar's width before it last snapped compact. */
  readonly restoreWidth: number;
  /** Out of compact, the sidebar holds `restoreWidth` until the pointer passes it. */
  readonly holding: boolean;
}

export function startSidebarWidthDrag(input: {
  readonly compact: boolean;
  /** The full sidebar's width, also kept while it is compact. */
  readonly width: number;
}): SidebarWidthDrag {
  return {
    compact: input.compact,
    width: input.compact ? SIDEBAR_COMPACT_WIDTH : input.width,
    restoreWidth: input.width,
    holding: input.compact,
  };
}

/**
 * Where the edge goes for a pointer at `pointerWidth`. Below the threshold it
 * snaps compact; dragged back out it returns at the width it had, and follows
 * the pointer again once the pointer reaches that width.
 */
export function moveSidebarWidthDrag(
  drag: SidebarWidthDrag,
  pointerWidth: number,
): SidebarWidthDrag {
  if (pointerWidth < SIDEBAR_COMPACT_THRESHOLD) {
    return {
      compact: true,
      width: SIDEBAR_COMPACT_WIDTH,
      restoreWidth: drag.compact ? drag.restoreWidth : drag.width,
      holding: true,
    };
  }
  const holding = drag.holding && pointerWidth < drag.restoreWidth;
  return {
    compact: false,
    width: holding ? drag.restoreWidth : pointerWidth,
    restoreWidth: drag.restoreWidth,
    holding,
  };
}

/** A committed width from the rail: the compact column's, or the full sidebar's new width. */
export function isCompactSidebarWidth(width: number): boolean {
  return width < SIDEBAR_COMPACT_THRESHOLD;
}

/** The full sidebar's width to start with: the stored one, or the default for none or a compact one. */
export function resolveInitialFullSidebarWidth(storedWidth: number | null): number {
  return storedWidth === null || isCompactSidebarWidth(storedWidth)
    ? SIDEBAR_DEFAULT_WIDTH
    : storedWidth;
}
