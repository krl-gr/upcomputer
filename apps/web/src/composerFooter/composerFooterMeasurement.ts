import type { RestingComposerControlsMeasurement } from "../components/composerFooterLayout";

/*
 * Reads the UpComputer footer row's natural widths from the DOM, as V1's
 * `composerControlsMeasurement` did. Upstream's measurement assumes the model
 * picker leads the row; here fixed controls (attach, separators, the picker)
 * sit anywhere between the blocks, so every direct child that is neither a
 * block nor the overflow trigger counts as fixed.
 */

function elementOuterWidth(element: HTMLElement): number {
  const width = element.getBoundingClientRect().width;
  if (width === 0) return 0;
  const style = getComputedStyle(element);
  return (
    width +
    (Number.parseFloat(style.marginInlineStart) || 0) +
    (Number.parseFloat(style.marginInlineEnd) || 0)
  );
}

function columnGap(element: HTMLElement | null): number {
  return element ? Number.parseFloat(getComputedStyle(element).columnGap) || 0 : 0;
}

/**
 * The model picker is the one flexible control: once it shrinks, its natural
 * width is recovered from the truncated label, capped by its max width.
 */
function modelPickerWidths(picker: HTMLElement): { natural: number; minimum: number } {
  const renderedWidth = elementOuterWidth(picker);
  if (renderedWidth === 0) return { natural: 0, minimum: 0 };
  const style = getComputedStyle(picker);
  const label = picker.querySelector<HTMLElement>('[data-chat-provider-model-picker-label="true"]');
  const hiddenLabelWidth = label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0;
  const maxWidth = Number.parseFloat(style.maxWidth);
  const natural = Math.min(
    renderedWidth + hiddenLabelWidth,
    Number.isFinite(maxWidth) ? maxWidth : Number.POSITIVE_INFINITY,
  );
  const minimum = Math.min(natural, Number.parseFloat(style.minWidth) || 0);
  return { natural, minimum };
}

function controlBlockWidths(block: HTMLElement): { natural: number; iconOnly: number } {
  const compact = block.dataset.composerBlockIconOnly === "true";
  let natural = elementOuterWidth(block);
  let iconOnly = natural;
  for (const label of block.querySelectorAll<HTMLElement>("[data-composer-control-label]")) {
    // Labels stay mounted at their natural width while icons replace them, so
    // both variants can be read from one tree without probe renders.
    const inFlow = getComputedStyle(label).position !== "absolute";
    if (!inFlow && !compact) continue;
    const labelWidth = label.scrollWidth;
    const renderedWidth = inFlow ? label.getBoundingClientRect().width : 0;
    const gap = columnGap(label.parentElement);
    natural += labelWidth - renderedWidth + (inFlow ? 0 : gap);
    iconOnly -= renderedWidth + (inFlow ? gap : 0);
  }
  for (const icon of block.querySelectorAll<HTMLElement>("[data-composer-control-compact-icon]")) {
    const width = elementOuterWidth(icon);
    const gap = columnGap(icon.parentElement);
    natural -= compact ? width + gap : 0;
    iconOnly += compact ? 0 : width + gap;
  }
  return { natural, iconOnly: Math.min(natural, iconOnly) };
}

/**
 * Hidden blocks and the unused overflow trigger stay mounted out of flow at
 * full size, so the measurement never depends on what the last layout hid.
 * Blocks are read in DOM order, which is also their priority order.
 */
export function measureComposerFooterControls(
  row: HTMLElement,
): RestingComposerControlsMeasurement {
  const gap = columnGap(row);
  let naturalFixedWidth = 0;
  let minimumFixedWidth = 0;
  let fixedCount = 0;
  let overflowWidth = 0;
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(row.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.dataset.composerFooterBlock !== undefined) {
      blocks.push(child);
      continue;
    }
    if (child.dataset.composerFooterOverflow !== undefined) {
      overflowWidth = elementOuterWidth(child);
      continue;
    }
    const widths = child.matches("[data-chat-provider-model-picker]")
      ? modelPickerWidths(child)
      : { natural: elementOuterWidth(child), minimum: elementOuterWidth(child) };
    if (widths.natural === 0) continue;
    naturalFixedWidth += widths.natural;
    minimumFixedWidth += widths.minimum;
    fixedCount += 1;
  }
  const gaps = gap * Math.max(0, fixedCount - 1);
  const widths = blocks.map(controlBlockWidths);
  return {
    gap,
    naturalFixedWidth: naturalFixedWidth + gaps,
    minimumFixedWidth: minimumFixedWidth + gaps,
    blockWidths: widths.map((width) => width.natural),
    iconOnlyBlockWidths: widths.map((width) => width.iconOnly),
    overflowWidth,
  };
}
