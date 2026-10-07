import { useId, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { TaskScheduleEntry, TaskScheduleEntryStatus } from "@t3tools/tasks-contracts/v1";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import { Calendar } from "../../../../../apps/web/src/components/ui/calendar.tsx";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../../../../apps/web/src/components/ui/dialog.tsx";
import { Label } from "../../../../../apps/web/src/components/ui/label.tsx";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "../../../../../apps/web/src/components/ui/popover.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../../apps/web/src/components/ui/table.tsx";
import { dateKeyOf, dateOfKey } from "../logic/dates.ts";
import { formatDuration, formatTime } from "../logic/time.ts";
import { usePlanner } from "./plannerContext.ts";
import { ConfirmDeleteDialog } from "./TaskDialogs.tsx";
import { DurationField, TimeField } from "./TimeField.tsx";

const PAGE = 10;
const STATUS_LABELS: Record<TaskScheduleEntryStatus, string> = {
  open: "Not done",
  done: "Done",
  skipped: "Skipped",
};

const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "long" });
const dateYearFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function formatEntryDate(key: string) {
  const date = dateOfKey(key);
  return (
    date.getFullYear() === new Date().getFullYear() ? dateFormatter : dateYearFormatter
  ).format(date);
}

function TimeCell(props: { readonly entry: TaskScheduleEntry }) {
  const { store } = usePlanner();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(props.entry.startTime ?? "");
  const save = () => {
    setOpen(false);
    const startTime = value || null;
    if (startTime !== props.entry.startTime)
      void store.updateEntry({ id: props.entry.id, startTime });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(props.entry.startTime ?? "");
      }}
    >
      <PopoverTrigger render={<Button size="xs" variant="ghost" />}>
        {props.entry.startTime ? formatTime(props.entry.startTime) : "Set"}
      </PopoverTrigger>
      <PopoverPopup align="start" padding="compact">
        <form
          className="flex w-44 flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <TimeField value={value} onChange={setValue} autoFocus />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit">
              Save
            </Button>
          </div>
        </form>
      </PopoverPopup>
    </Popover>
  );
}

function DurationCell(props: { readonly entry: TaskScheduleEntry }) {
  const { store } = usePlanner();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="xs" variant="ghost" />}>
        {props.entry.durationMinutes !== null ? formatDuration(props.entry.durationMinutes) : "Set"}
      </PopoverTrigger>
      <PopoverPopup align="start" padding="compact">
        <div className="w-44">
          <DurationField
            value={props.entry.durationMinutes}
            onChange={(durationMinutes) =>
              void store.updateEntry({ id: props.entry.id, durationMinutes })
            }
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function DateCell(props: { readonly entry: TaskScheduleEntry }) {
  const { store, preferences } = usePlanner();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="xs" variant="ghost" />}>
        {formatEntryDate(props.entry.date)}
      </PopoverTrigger>
      <PopoverPopup align="start">
        <Calendar
          mode="single"
          selected={dateOfKey(props.entry.date)}
          defaultMonth={dateOfKey(props.entry.date)}
          weekStartsOn={preferences.weekStartDay as 0}
          captionLayout="dropdown"
          onSelect={(date) => {
            setOpen(false);
            if (!date) return;
            const target = dateKeyOf(date);
            if (target !== props.entry.date)
              void store.moveEntries({ ids: [props.entry.id], date: target });
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

function AddEntryDialog(props: {
  readonly taskId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { store, preferences } = usePlanner();
  const id = useId();
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const close = () => {
    props.onOpenChange(false);
    setDate(undefined);
    setTime("");
    setDuration(null);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add to the schedule</DialogTitle>
          <DialogDescription>
            Pick a day, and a time and duration if the task has them.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-wrap gap-4">
            <Calendar
              mode="single"
              selected={date}
              weekStartsOn={preferences.weekStartDay as 0}
              captionLayout="dropdown"
              onSelect={setDate}
            />
            <div className="flex w-44 flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-time`}>Time (optional)</Label>
                <TimeField id={`${id}-time`} value={time} onChange={setTime} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Duration</Label>
                <DurationField value={duration} onChange={setDuration} />
              </div>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!date}
            onClick={() => {
              if (!date) return;
              void store.addEntries({
                taskIds: [props.taskId as never],
                date: dateKeyOf(date),
                ...(time ? { startTime: time } : {}),
                ...(duration !== null ? { durationMinutes: duration } : {}),
              });
              close();
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * Wande's QueueInstancesList, the detail window's schedule view: every entry
 * of the task with its date, time, duration and status, editable in place.
 */
export function ScheduleTable(props: {
  readonly taskId: string;
  readonly entries: readonly TaskScheduleEntry[] | undefined;
}) {
  const { store } = usePlanner();
  const [visible, setVisible] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const entries = props.entries ?? [];
  const shown = entries.slice(0, visible);
  const remaining = entries.length - shown.length;
  return (
    <div className="flex flex-col gap-2">
      {props.entries === undefined ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="flex justify-center py-6">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add first entry
          </Button>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Delete</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <DateCell entry={entry} />
                  </TableCell>
                  <TableCell>
                    <TimeCell entry={entry} />
                  </TableCell>
                  <TableCell>
                    <DurationCell entry={entry} />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={entry.status}
                      onValueChange={(status) => {
                        if (status && status !== entry.status)
                          void store.updateEntry({ id: entry.id, status });
                      }}
                    >
                      <SelectTrigger size="xs" variant="ghost" className="w-28 min-w-0">
                        <SelectValue>{STATUS_LABELS[entry.status]}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {(Object.keys(STATUS_LABELS) as TaskScheduleEntryStatus[]).map((status) => (
                          <SelectItem key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon-xs"
                      variant="ghost-destructive"
                      aria-label="Delete entry"
                      onClick={() => setDeleting(entry.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add entry
          </Button>
          {remaining > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setVisible((count) => count + PAGE)}>
              Load more ({remaining})
            </Button>
          ) : null}
        </>
      )}
      <AddEntryDialog taskId={props.taskId} open={adding} onOpenChange={setAdding} />
      <ConfirmDeleteDialog
        open={deleting !== null}
        title="Delete entry"
        description="This day is taken off the task's schedule. The task stays."
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) void store.deleteEntries([deleting]);
        }}
      />
    </div>
  );
}
