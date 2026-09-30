import type { ComposerControlsMeasurement } from "../composerFooterLayout";

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
function modelPickerNaturalWidth(picker: HTMLElement): number {
  const renderedWidth = elementOuterWidth(picker);
  if (renderedWidth === 0) return 0;
  const label = picker.querySelector<HTMLElement>('[data-chat-provider-model-picker-label="true"]');
  const hiddenLabelWidth = label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0;
  const maxWidth = Number.parseFloat(getComputedStyle(picker).maxWidth);
  return Math.min(
    renderedWidth + hiddenLabelWidth,
    Number.isFinite(maxWidth) ? maxWidth : Number.POSITIVE_INFINITY,
  );
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
 * Read the natural widths of the composer footer controls from the DOM.
 *
 * Hidden blocks and the unused overflow trigger stay mounted out of flow at
 * full size, so the measurement never depends on what the last layout hid.
 * Blocks are read in DOM order, which is also their priority order.
 */
export function measureComposerControls(row: HTMLElement): ComposerControlsMeasurement {
  const gap = columnGap(row);
  let fixedWidth = 0;
  let fixedCount = 0;
  let overflowWidth = 0;
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(row.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.dataset.composerBlock !== undefined) {
      blocks.push(child);
      continue;
    }
    if (child.dataset.composerControlsOverflow !== undefined) {
      overflowWidth = elementOuterWidth(child);
      continue;
    }
    const width = child.matches("[data-chat-provider-model-picker]")
      ? modelPickerNaturalWidth(child)
      : elementOuterWidth(child);
    if (width === 0) continue;
    fixedWidth += width;
    fixedCount += 1;
  }
  const widths = blocks.map(controlBlockWidths);
  return {
    gap,
    fixedWidth: fixedWidth + gap * Math.max(0, fixedCount - 1),
    blockWidths: widths.map((width) => width.natural),
    iconOnlyBlockWidths: widths.map((width) => width.iconOnly),
    overflowWidth,
  };
}
