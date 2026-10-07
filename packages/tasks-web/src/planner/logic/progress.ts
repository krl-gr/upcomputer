/**
 * Schedule progress of a task: handled entries (done or skipped) over all of
 * its entries; for a routine, over the current week only. Ported from wande's
 * queue progress. List rows read the server's counts; the detail window counts
 * the entries it already loaded.
 */
import { addDays, weekStartOf, type DateKey } from "./dates.ts";

export interface ScheduleProgressCount {
  readonly total: number;
  readonly handled: number;
}

export function weekRangeOf(today: DateKey, weekStartDay: number) {
  const from = weekStartOf(today, weekStartDay);
  return { from, to: addDays(from, 6) };
}

export function countProgress(
  entries: ReadonlyArray<{ readonly date: string; readonly status: string }>,
  range?: { readonly from: DateKey; readonly to: DateKey },
): ScheduleProgressCount {
  let total = 0;
  let handled = 0;
  for (const entry of entries) {
    if (range && (entry.date < range.from || entry.date > range.to)) continue;
    total += 1;
    if (entry.status === "done" || entry.status === "skipped") handled += 1;
  }
  return { total, handled };
}

/** The chip text, `handled/total`; null when the task has no entries. */
export function progressLabel(progress: ScheduleProgressCount | undefined): string | null {
  return progress && progress.total > 0 ? `${progress.handled}/${progress.total}` : null;
}
