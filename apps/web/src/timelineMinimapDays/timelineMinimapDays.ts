import { useEffect, useSyncExternalStore } from "react";

import {
  isTimelineMinimapRowVisible,
  type MessagesTimelineRow,
} from "../components/chat/MessagesTimeline.logic";
import {
  deriveTimelineMinimapItems,
  type TimelineMinimapItem,
} from "../components/chat/timelineMinimapItems";
import { parseTimestampDate } from "../timestampFormat";

/**
 * A minimap tick. A day's tick spans the rows from its first user message up
 * to the next day's, so it counts as in view while any of them is.
 */
export type TimelineMinimapTick = TimelineMinimapItem & { readonly lastRowIndex?: number };

const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dayWithYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * One tick per local calendar day instead of one per user message. A day's
 * tick jumps to its first message; its tooltip names the day and counts its
 * messages, with the first message below. Messages without a date join the
 * day before them.
 */
export function groupTimelineMinimapItemsByDay(
  items: ReadonlyArray<TimelineMinimapItem>,
  rows: ReadonlyArray<MessagesTimelineRow>,
  now: Date = new Date(),
): TimelineMinimapTick[] {
  const days: Array<{ key: string; date: Date | null; items: TimelineMinimapItem[] }> = [];
  for (const item of items) {
    const row = rows[item.rowIndex];
    const date = row?.kind === "message" ? parseTimestampDate(row.message.createdAt) : null;
    const key = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : null;
    const last = days.at(-1);
    if (last && (key === null || key === last.key)) last.items.push(item);
    else days.push({ key: key ?? "", date, items: [item] });
  }
  return days.map((day, index) => {
    const [first] = day.items as [TimelineMinimapItem, ...TimelineMinimapItem[]];
    const next = days[index + 1]?.items[0];
    const label = day.date
      ? (day.date.getFullYear() === now.getFullYear() ? dayFormatter : dayWithYearFormatter).format(
          day.date,
        )
      : "Earlier";
    const count = day.items.length;
    return {
      id: first.id,
      rowIndex: first.rowIndex,
      lastRowIndex: next ? next.rowIndex - 1 : rows.length - 1,
      userText: `${label} · ${count} message${count === 1 ? "" : "s"}`,
      assistantText: first.userText,
    };
  });
}

/** Whether a tick's rows overlap the visible row range. */
export function isTimelineMinimapTickInView(
  tick: TimelineMinimapTick,
  visibleStart: number | null | undefined,
  visibleEnd: number | null | undefined,
): boolean {
  if (tick.lastRowIndex === undefined) {
    return isTimelineMinimapRowVisible(tick.rowIndex, visibleStart, visibleEnd);
  }
  if (visibleStart == null || visibleEnd == null) return false;
  return tick.rowIndex <= visibleEnd && tick.lastRowIndex >= visibleStart;
}

/* Chats whose minimap groups by day, by scoped thread key: bot chats, marked by their header. */
const byDay = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setGroupedByDay(threadKey: string, delta: 1 | -1) {
  const count = (byDay.get(threadKey) ?? 0) + delta;
  if (count > 0) byDay.set(threadKey, count);
  else byDay.delete(threadKey);
  for (const listener of listeners) listener();
}

/** While mounted, the chat's minimap shows one tick per day; null marks nothing. */
export function useTimelineMinimapByDay(threadKey: string | null): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the chat in the module store the timeline's minimap reads
  useEffect(() => {
    if (threadKey === null) return;
    setGroupedByDay(threadKey, 1);
    return () => setGroupedByDay(threadKey, -1);
  }, [threadKey]);
}

/** The timeline's minimap ticks: per user message, or per day in a chat marked above. */
export function useTimelineMinimapTicks(
  rows: ReadonlyArray<MessagesTimelineRow>,
  threadKey: string,
): ReadonlyArray<TimelineMinimapTick> {
  const groupsByDay = useSyncExternalStore(
    subscribe,
    () => byDay.has(threadKey),
    () => false,
  );
  const items = deriveTimelineMinimapItems(rows);
  return groupsByDay ? groupTimelineMinimapItemsByDay(items, rows) : items;
}
