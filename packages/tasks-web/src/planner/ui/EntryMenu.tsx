import { useMemo, useState } from "react";
import {
  CircleCheckIcon,
  CircleIcon,
  CircleSlashIcon,
  ClockIcon,
  CopyIcon,
  MoveRightIcon,
} from "lucide-react";
import type { TaskScheduleEntry, TaskScheduleEntryStatus } from "@t3tools/tasks-contracts/v1";

import {
  MenuItem,
  MenuSeparator,
  MenuShortcut,
} from "../../../../../apps/web/src/components/ui/menu.tsx";
import { Popover, PopoverPopup } from "../../../../../apps/web/src/components/ui/popover.tsx";
import { addDays } from "../logic/dates.ts";
import { entryTimingLabel } from "../logic/time.ts";
import { usePlanner } from "./plannerContext.ts";
import { PointMenu, type MenuPoint } from "./PointMenu.tsx";
import { TimingForm } from "./TimeField.tsx";

const STATUS_ITEMS: ReadonlyArray<{
  readonly status: TaskScheduleEntryStatus;
  readonly label: string;
  readonly icon: React.ReactNode;
}> = [
  { status: "open", label: "Not done", icon: <CircleIcon /> },
  { status: "done", label: "Done", icon: <CircleCheckIcon /> },
  // Wande's "Archive" for an instance: planned, not done, not carried over.
  { status: "skipped", label: "Skipped", icon: <CircleSlashIcon /> },
];

export interface EntryMenuTarget {
  readonly entry: TaskScheduleEntry;
  readonly point: MenuPoint;
}

/**
 * Wande's queue instance menu, shared by the queue and the calendar: status,
 * move or copy to the next day, set time and duration, delete.
 */
export function EntryMenuHost(props: {
  readonly target: EntryMenuTarget | null;
  readonly onClose: () => void;
}) {
  const { store } = usePlanner();
  const [timing, setTiming] = useState<EntryMenuTarget | null>(null);
  const entry = props.target?.entry ?? null;
  const anchor = useMemo(
    () =>
      timing
        ? {
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x: timing.point.x, y: timing.point.y, width: 0, height: 0 }),
          }
        : null,
    [timing],
  );
  const label = entry ? entryTimingLabel(entry) : "";
  return (
    <>
      <PointMenu point={props.target?.point ?? null} onClose={props.onClose}>
        {entry ? (
          <>
            {STATUS_ITEMS.map((item) => (
              <MenuItem
                key={item.status}
                onClick={() => void store.updateEntry({ id: entry.id, status: item.status })}
              >
                {item.icon}
                {item.label}
                {entry.status === item.status ? <MenuShortcut>Current</MenuShortcut> : null}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              onClick={() =>
                void store.moveEntries({
                  ids: [entry.id],
                  date: addDays(entry.date, 1),
                  placement: { at: "bottom" },
                })
              }
            >
              <MoveRightIcon />
              Move to next day
            </MenuItem>
            <MenuItem
              onClick={() =>
                void store.copyEntries({
                  ids: [entry.id],
                  dates: [addDays(entry.date, 1)],
                  placement: { at: "bottom" },
                })
              }
            >
              <CopyIcon />
              Copy to next day
            </MenuItem>
            <MenuItem onClick={() => setTiming(props.target)}>
              <ClockIcon />
              Set time & duration
              {label ? <MenuShortcut>{label}</MenuShortcut> : null}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => void store.deleteEntries([entry.id])}>
              Delete
            </MenuItem>
          </>
        ) : null}
      </PointMenu>
      <Popover
        open={timing !== null}
        onOpenChange={(open) => {
          if (!open) setTiming(null);
        }}
      >
        <PopoverPopup anchor={anchor} align="start" padding="compact">
          {timing ? (
            <TimingForm
              startTime={timing.entry.startTime}
              durationMinutes={timing.entry.durationMinutes}
              onCancel={() => setTiming(null)}
              onSave={(next) => {
                setTiming(null);
                void store.updateEntry({ id: timing.entry.id, ...next });
              }}
            />
          ) : null}
        </PopoverPopup>
      </Popover>
    </>
  );
}
