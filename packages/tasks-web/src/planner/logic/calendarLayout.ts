/**
 * Places timed entries in the calendar grid; ported from wande's calendar
 * projection and layout. Overlapping entries share their group's width in
 * lanes; untimed entries are not in the grid (wande has no all-day row).
 */
import { MINUTES_IN_DAY, effectiveDuration, minutesToPixels, parseTimeToMinutes } from "./time.ts";

export interface CalendarSourceEntry {
  readonly id: string;
  readonly date: string;
  readonly startTime: string | null;
  readonly durationMinutes: number | null;
}

export interface CalendarPosition {
  readonly top: number;
  readonly height: number;
  readonly leftPct: number;
  readonly widthPct: number;
  readonly laneIndex: number;
  readonly laneCount: number;
}

export interface CalendarItem<E extends CalendarSourceEntry> {
  readonly entry: E;
  readonly startMinute: number;
  readonly duration: number;
  readonly endMinute: number;
  readonly position: CalendarPosition;
}

function compareItems<E extends CalendarSourceEntry>(
  left: CalendarItem<E>,
  right: CalendarItem<E>,
) {
  return (
    left.startMinute - right.startMinute ||
    left.endMinute - right.endMinute ||
    left.entry.id.localeCompare(right.entry.id)
  );
}

function overlapGroups<E extends CalendarSourceEntry>(items: ReadonlyArray<CalendarItem<E>>) {
  const groups: CalendarItem<E>[][] = [];
  let current: CalendarItem<E>[] = [];
  let currentEnd = -1;
  for (const item of [...items].sort(compareItems)) {
    if (current.length === 0 || item.startMinute < currentEnd) {
      current.push(item);
      currentEnd = Math.max(currentEnd, item.endMinute);
      continue;
    }
    groups.push(current);
    current = [item];
    currentEnd = item.endMinute;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function assignLanes<E extends CalendarSourceEntry>(group: ReadonlyArray<CalendarItem<E>>) {
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of [...group].sort(compareItems)) {
    let lane = laneEnds.findIndex((end) => end <= item.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMinute);
    } else laneEnds[lane] = item.endMinute;
    lanes.set(item.entry.id, lane);
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) };
}

/**
 * Timed entries of one day, positioned for a grid with `slotHeight` pixels per
 * quarter hour. An entry without a duration takes `defaultDuration` of it
 * (wande: the task or routine default).
 */
export function layoutDay<E extends CalendarSourceEntry>(
  entries: ReadonlyArray<E>,
  defaultDuration: (entry: E) => number,
  slotHeight: number,
): CalendarItem<E>[] {
  const items: CalendarItem<E>[] = [];
  for (const entry of entries) {
    const startMinute = parseTimeToMinutes(entry.startTime);
    if (startMinute === null) continue;
    const duration = effectiveDuration(entry, defaultDuration(entry));
    items.push({
      entry,
      startMinute,
      duration,
      endMinute: Math.min(MINUTES_IN_DAY, startMinute + duration),
      position: { top: 0, height: 0, leftPct: 0, widthPct: 100, laneIndex: 0, laneCount: 1 },
    });
  }
  const laidOut: CalendarItem<E>[] = [];
  for (const group of overlapGroups(items)) {
    const { lanes, laneCount } = assignLanes(group);
    const widthPct = 100 / laneCount;
    for (const item of group) {
      const laneIndex = lanes.get(item.entry.id) ?? 0;
      laidOut.push({
        ...item,
        position: {
          top: minutesToPixels(item.startMinute, slotHeight),
          height: Math.max(slotHeight * 0.5, minutesToPixels(item.duration, slotHeight)),
          leftPct: laneIndex * widthPct,
          widthPct,
          laneIndex,
          laneCount,
        },
      });
    }
  }
  return laidOut.sort(compareItems);
}
