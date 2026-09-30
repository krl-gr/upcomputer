export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
export const COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX =
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX;
}

/**
 * Natural widths of the composer footer controls, read from the DOM.
 *
 * `fixedWidth` covers the controls that always stay in the row (attachment
 * picker, separator, model picker at its natural width) including the gaps
 * between them. Blocks are ordered by priority: the last block loses its
 * label first and moves into the overflow menu first.
 */
export interface ComposerControlsMeasurement {
  gap: number;
  fixedWidth: number;
  blockWidths: readonly number[];
  iconOnlyBlockWidths: readonly number[];
  overflowWidth: number;
}

export interface ComposerControlsLayout {
  hiddenCount: number;
  iconOnlyCount: number;
}

function composerControlsWidth(
  input: ComposerControlsMeasurement,
  hiddenCount: number,
  iconOnlyCount: number,
): number {
  const { blockWidths, gap } = input;
  const visibleCount = blockWidths.length - hiddenCount;
  return (
    input.fixedWidth +
    blockWidths
      .slice(0, visibleCount)
      .reduce(
        (sum, width, index) =>
          sum +
          (index >= blockWidths.length - iconOnlyCount
            ? (input.iconOnlyBlockWidths[index] ?? width)
            : width),
        0,
      ) +
    (hiddenCount > 0 ? input.overflowWidth : 0) +
    gap * (visibleCount + (hiddenCount > 0 ? 1 : 0))
  );
}

// Promotions need a pixel of slack: the model picker's natural width is
// recovered from a truncated label whose scrollWidth is integral while the
// rendered box is fractional, so a host sitting exactly on a threshold could
// otherwise flip a block back and forth on every measurement.
const COMPOSER_CONTROLS_SLACK_PX = 1;

/**
 * Fit the footer controls using natural widths: trailing blocks first become
 * icon-only, then move one by one into the overflow menu. Once every block is
 * in the overflow menu, the model picker is the only control left to shrink,
 * which it does with an ellipsis.
 *
 * Demotions are immediate so a threshold never clips; promotions need slack.
 */
export function resolveComposerControlsLayout(
  input: ComposerControlsMeasurement & {
    hostWidth: number;
    previous?: ComposerControlsLayout;
  },
): ComposerControlsLayout {
  const { blockWidths, hostWidth, previous } = input;
  const iconSteps = blockWidths.length;
  const previousStep = previous
    ? previous.hiddenCount > 0
      ? iconSteps + Math.min(previous.hiddenCount, blockWidths.length)
      : Math.min(previous.iconOnlyCount, iconSteps)
    : 0;
  const widthAtStep = (candidate: number) =>
    composerControlsWidth(
      input,
      Math.max(0, candidate - iconSteps),
      Math.min(candidate, iconSteps),
    );
  let step = 0;
  while (
    step < iconSteps + blockWidths.length &&
    widthAtStep(step) > hostWidth - (step < previousStep ? COMPOSER_CONTROLS_SLACK_PX : 0)
  ) {
    step += 1;
  }
  return {
    hiddenCount: Math.max(0, step - iconSteps),
    iconOnlyCount: Math.min(step, iconSteps),
  };
}
