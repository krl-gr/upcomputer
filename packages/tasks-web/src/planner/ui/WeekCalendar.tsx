import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import type { DayEntries } from "../data/hooks.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import { scrollMemory } from "../data/preferences.ts";
import { layoutDay } from "../logic/calendarLayout.ts";
import { todayKey } from "../logic/dates.ts";
import {
  SLOTS_IN_DAY,
  formatHourLabel,
  minutesToPixels,
  parseTimeToMinutes,
} from "../logic/time.ts";
import { CalendarEntryCard, type EntryCardHandlers } from "./EntryCard.tsx";
import { EntryMenuHost, type EntryMenuTarget } from "./EntryMenu.tsx";
import { usePlanner } from "./plannerContext.ts";
import { DayHeaderLabel, type WeekSelection } from "./WeekQueue.tsx";

export interface CalendarDropIndicator {
  readonly date: string;
  readonly startTime: string;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const TIME_COLUMN = 72;

function minuteOfDay() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Minutes since midnight, refreshed once a minute for the current-time line (no animation). */
function useMinuteOfDay() {
  const [minute, setMinute] = useState(minuteOfDay);
  useEffect(() => {
    const timer = setInterval(() => setMinute(minuteOfDay()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return minute;
}

const CalendarDayColumn = memo(function CalendarDayColumn(props: {
  readonly day: DayEntries;
  readonly tasks: ReadonlyMap<string, PlannerTask>;
  readonly today: boolean;
  readonly nowMinute: number;
  readonly preview: string | null;
  readonly selection: WeekSelection;
  readonly handlers: EntryCardHandlers;
  readonly onResize: (entry: TaskScheduleEntry, durationMinutes: number) => void;
}) {
  const { preferences } = usePlanner();
  const slotHeight = preferences.slotHeight;
  const { setNodeRef: setDropNode } = useDroppable({
    id: `calendar-day-${props.day.date}`,
    data: { type: "calendar-day", date: props.day.date },
  });
  const { defaultTaskDuration, defaultRoutineDuration } = preferences;
  const items = useMemo(
    () =>
      layoutDay(
        props.day.entries,
        (entry) =>
          props.tasks.get(entry.taskId)?.kind === "routine"
            ? defaultRoutineDuration
            : defaultTaskDuration,
        slotHeight,
      ),
    [props.day.entries, props.tasks, defaultTaskDuration, defaultRoutineDuration, slotHeight],
  );
  const previewMinute = parseTimeToMinutes(props.preview);
  return (
    <div
      ref={setDropNode}
      data-calendar-day={props.day.date}
      className={cn("relative border-r", props.today ? "bg-background" : "bg-muted/30")}
    >
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-border/70"
          style={{ top: hour * 4 * slotHeight }}
        />
      ))}
      {props.today ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive/75"
          style={{ top: minutesToPixels(props.nowMinute, slotHeight) }}
        />
      ) : null}
      {previewMinute !== null ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 border-t border-primary bg-primary/15"
          style={{ top: minutesToPixels(previewMinute, slotHeight), height: slotHeight }}
        />
      ) : null}
      {items.map((item) => (
        <CalendarEntryCard
          key={item.entry.id}
          entry={item.entry}
          task={props.tasks.get(item.entry.taskId)}
          position={item.position}
          duration={item.duration}
          selectMode={props.selection.active}
          selected={props.selection.ids.has(item.entry.id)}
          handlers={props.handlers}
          onResize={props.onResize}
        />
      ))}
    </div>
  );
});

/**
 * Wande's WeekCalendar: 24 hours in quarter-hour slots, timed entries by
 * their time with overlapping ones side by side. Untimed entries stay in the
 * queue view only, as in wande.
 */
export function WeekCalendar(props: {
  readonly days: readonly DayEntries[];
  readonly tasks: ReadonlyMap<string, PlannerTask>;
  readonly markedDate: string | null;
  readonly onMark: (date: string) => void;
  readonly selection: WeekSelection;
  readonly handlers: EntryCardHandlers;
  readonly indicator: CalendarDropIndicator | null;
  readonly entryMenu: EntryMenuTarget | null;
  readonly onEntryMenuClose: () => void;
}) {
  const { store, preferences } = usePlanner();
  const onResize = useCallback(
    (entry: TaskScheduleEntry, durationMinutes: number) =>
      void store.updateEntry({ id: entry.id, durationMinutes }),
    [store],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowMinute = useMinuteOfDay();
  const today = todayKey();
  const slotHeight = preferences.slotHeight;
  const columns = `${TIME_COLUMN}px repeat(${props.days.length}, minmax(0, 1fr))`;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const memory = scrollMemory("calendar");
    element.scrollTop = memory.read() ?? minutesToPixels(8 * 60, slotHeight);
    return memory.follow(element);
  }, [slotHeight]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: columns }}>
        <div className="border-r" />
        {props.days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={cn(
              "flex flex-wrap items-center justify-center gap-1 border-r px-2 py-2 hover:bg-accent/60",
              day.date === today && "bg-background",
            )}
            onClick={() => props.onMark(day.date)}
          >
            <DayHeaderLabel date={day.date} marked={day.date === props.markedDate} />
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: columns, height: SLOTS_IN_DAY * slotHeight }}
        >
          <div className="relative border-r">
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-xs text-muted-foreground tabular-nums first:translate-y-0"
                style={{ top: hour * 4 * slotHeight }}
              >
                {formatHourLabel(hour)}
              </span>
            ))}
          </div>
          {props.days.map((day) => (
            <CalendarDayColumn
              key={day.date}
              day={day}
              tasks={props.tasks}
              today={day.date === today}
              nowMinute={nowMinute}
              preview={props.indicator?.date === day.date ? props.indicator.startTime : null}
              selection={props.selection}
              handlers={props.handlers}
              onResize={onResize}
            />
          ))}
        </div>
      </div>
      <EntryMenuHost target={props.entryMenu} onClose={props.onEntryMenuClose} />
    </div>
  );
}
