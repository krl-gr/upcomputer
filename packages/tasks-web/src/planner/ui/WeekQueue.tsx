import { memo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { MoreVerticalIcon, Trash2Icon, XIcon } from "lucide-react";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import { MenuItem } from "../../../../../apps/web/src/components/ui/menu.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../../apps/web/src/components/ui/table.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import type { DayEntries } from "../data/hooks.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import { addDays, dateOfKey, todayKey } from "../logic/dates.ts";
import { QueueEntryCard, type EntryCardHandlers } from "./EntryCard.tsx";
import { EntryMenuHost, type EntryMenuTarget } from "./EntryMenu.tsx";
import { FloatingWindow } from "./FloatingWindow.tsx";
import { IconAction } from "./IconAction.tsx";
import { usePlanner } from "./plannerContext.ts";
import { PointMenu, pointBelow, type MenuPoint } from "./PointMenu.tsx";
import { DurationField, TimeField } from "./TimeField.tsx";

/** Where a dragged item would land in a queue column: before an entry, or at the end. */
export interface QueueDropIndicator {
  readonly date: string;
  readonly beforeEntryId: string | null;
}

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });

export interface WeekSelection {
  readonly active: boolean;
  readonly ids: ReadonlySet<string>;
}

/**
 * The marked day and its header: wande's "target day for Add to queue". Its
 * container wraps, so a narrow column (a phone, the right panel) puts the
 * date under the weekday.
 */
export function DayHeaderLabel(props: { readonly date: string; readonly marked: boolean }) {
  const day = dateOfKey(props.date);
  return (
    <>
      <span className="text-xs font-semibold text-foreground">{weekdayFormatter.format(day)}</span>
      <span
        className={cn(
          "rounded-full px-1.5 text-xs font-semibold tabular-nums",
          props.marked ? "bg-primary text-primary-foreground" : "text-muted-foreground",
        )}
      >
        {day.getDate()}
      </span>
    </>
  );
}

const QueueDayColumn = memo(function QueueDayColumn(props: {
  readonly day: DayEntries;
  readonly tasks: ReadonlyMap<string, PlannerTask>;
  readonly grid: boolean;
  readonly today: boolean;
  readonly marked: boolean;
  readonly selection: WeekSelection;
  readonly handlers: EntryCardHandlers;
  readonly indicator: string | null | undefined;
  readonly onMark: (date: string) => void;
  readonly onDayMenu: (date: string, point: MenuPoint) => void;
}) {
  const { date, entries } = props.day;
  const { setNodeRef: setDropNode } = useDroppable({
    id: `column-${date}`,
    data: { type: "queue-column", date },
  });
  const line = <div className="mx-2 my-1 h-px bg-foreground/30" />;
  return (
    <div
      ref={setDropNode}
      data-queue-date={date}
      className={cn(
        "flex min-h-0 flex-col border-r",
        props.grid ? "min-w-0" : "min-w-56 flex-1",
        props.today ? "bg-background" : "bg-muted/30",
      )}
    >
      <div
        className="group relative flex shrink-0 cursor-pointer flex-wrap items-center justify-center gap-1 border-b px-2 py-2 hover:bg-accent/60"
        onClick={() => props.onMark(date)}
      >
        <DayHeaderLabel date={date} marked={props.marked} />
        <span className="absolute right-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <IconAction
            label="Day options"
            size="icon-micro"
            onClick={(event) => {
              event.stopPropagation();
              props.onDayMenu(date, pointBelow(event.currentTarget));
            }}
          >
            <MoreVerticalIcon />
          </IconAction>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <div className="flex min-h-24 flex-col gap-1">
          {entries.map((entry) => (
            <div key={entry.id}>
              {props.indicator === entry.id ? line : null}
              <QueueEntryCard
                entry={entry}
                task={props.tasks.get(entry.taskId)}
                selectMode={props.selection.active}
                selected={props.selection.ids.has(entry.id)}
                handlers={props.handlers}
              />
            </div>
          ))}
          {props.indicator === null ? line : null}
        </div>
      </div>
    </div>
  );
});

/** Wande's day "Set time & duration": every entry of one day with its time and duration. */
function DayTimingWindow(props: {
  readonly date: string;
  readonly entries: readonly TaskScheduleEntry[];
  readonly tasks: ReadonlyMap<string, PlannerTask>;
  readonly onClose: () => void;
}) {
  const { store } = usePlanner();
  const [position, setPosition] = useState<{ x: number; y: number } | undefined>();
  return (
    <FloatingWindow
      width={580}
      zIndex={45}
      position={position}
      onFocus={() => undefined}
      onMove={setPosition}
      onDismiss={props.onClose}
      header={
        <>
          <h2 className="min-w-0 flex-1 truncate pt-1 text-base font-semibold text-foreground">
            Set time & duration
          </h2>
          <IconAction label="Close" variant="outline" size="icon-sm" onClick={props.onClose}>
            <XIcon />
          </IconAction>
        </>
      }
    >
      {props.entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No entries on this day.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entry</TableHead>
              <TableHead>Start time</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>
                <span className="sr-only">Delete</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="max-w-40">
                  <span className="block truncate">
                    {props.tasks.get(entry.taskId)?.title ?? "Loading…"}
                  </span>
                </TableCell>
                <TableCell className="w-32">
                  <TimeField
                    key={entry.startTime ?? ""}
                    value={entry.startTime ?? ""}
                    onChange={(value) => {
                      const startTime = value || null;
                      if (startTime !== entry.startTime)
                        void store.updateEntry({ id: entry.id, startTime });
                    }}
                  />
                </TableCell>
                <TableCell className="w-36">
                  <DurationField
                    value={entry.durationMinutes}
                    onChange={(durationMinutes) =>
                      void store.updateEntry({ id: entry.id, durationMinutes })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="icon-xs"
                    variant="ghost-destructive"
                    aria-label="Delete entry"
                    onClick={() => void store.deleteEntries([entry.id])}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FloatingWindow>
  );
}

/** Wande's WeekQueue: one column per shown day, entries in their order. */
export function WeekQueue(props: {
  readonly days: readonly DayEntries[];
  readonly tasks: ReadonlyMap<string, PlannerTask>;
  readonly markedDate: string | null;
  readonly onMark: (date: string) => void;
  readonly selection: WeekSelection;
  readonly handlers: EntryCardHandlers;
  readonly indicator: QueueDropIndicator | null;
  readonly entryMenu: EntryMenuTarget | null;
  readonly onEntryMenuClose: () => void;
}) {
  const { store } = usePlanner();
  const [dayMenu, setDayMenu] = useState<{ date: string; point: MenuPoint } | null>(null);
  const [timingDate, setTimingDate] = useState<string | null>(null);
  const today = todayKey();
  const grid = props.days.length === 7;
  const menuDay = dayMenu ? props.days.find((day) => day.date === dayMenu.date) : undefined;
  const timingDay = timingDate ? props.days.find((day) => day.date === timingDate) : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("min-h-0 flex-1", grid ? "grid grid-cols-7" : "flex overflow-x-auto")}>
        {props.days.map((day) => (
          <QueueDayColumn
            key={day.date}
            day={day}
            tasks={props.tasks}
            grid={grid}
            today={day.date === today}
            marked={day.date === props.markedDate}
            selection={props.selection}
            handlers={props.handlers}
            indicator={
              props.indicator?.date === day.date ? props.indicator.beforeEntryId : undefined
            }
            onMark={props.onMark}
            onDayMenu={(date, point) => setDayMenu({ date, point })}
          />
        ))}
      </div>
      <PointMenu point={dayMenu?.point ?? null} onClose={() => setDayMenu(null)}>
        {dayMenu ? (
          <>
            <MenuItem
              disabled={!menuDay?.entries.some((entry) => entry.status === "open")}
              // Wande moves to tomorrow (relative to today), not to the column's next day.
              onClick={() => void store.moveOpen(dayMenu.date, addDays(today, 1))}
            >
              Reschedule incomplete
            </MenuItem>
            <MenuItem
              disabled={(menuDay?.entries.length ?? 0) === 0}
              onClick={() => setTimingDate(dayMenu.date)}
            >
              Set time & duration
            </MenuItem>
          </>
        ) : null}
      </PointMenu>
      <EntryMenuHost target={props.entryMenu} onClose={props.onEntryMenuClose} />
      {timingDate ? (
        <DayTimingWindow
          date={timingDate}
          entries={timingDay?.entries ?? []}
          tasks={props.tasks}
          onClose={() => setTimingDate(null)}
        />
      ) : null}
    </div>
  );
}
