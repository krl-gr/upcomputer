/** A schedule placement (`TaskSchedulePlacement`) with plain string ids. */
export type PlannerPlacement =
  | { readonly at: "top" | "bottom" }
  | { readonly before: string }
  | { readonly after: string };

/**
 * Where entries land among a date's other entries, as the server places them
 * (`TaskScheduleService.insertionIndex`): the placement, else before the first
 * entry that starts later than `startTime`, else last. Untimed entries never
 * move to make room. Null when the anchor is not among `others`.
 */
export function insertionIndex(
  others: ReadonlyArray<{ readonly id: string; readonly startTime: string | null }>,
  placement: PlannerPlacement | undefined,
  startTime: string | null,
): number | null {
  if (placement === undefined) {
    if (startTime === null) return others.length;
    const later = others.findIndex(
      (entry) => entry.startTime !== null && entry.startTime > startTime,
    );
    return later < 0 ? others.length : later;
  }
  if ("at" in placement) return placement.at === "top" ? 0 : others.length;
  const anchor = "before" in placement ? placement.before : placement.after;
  const index = others.findIndex((entry) => entry.id === anchor);
  if (index < 0) return null;
  return "before" in placement ? index : index + 1;
}
