import { useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  MoreHorizontalIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { Calendar } from "../../../../../apps/web/src/components/ui/calendar.tsx";
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
import { Switch } from "../../../../../apps/web/src/components/ui/switch.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { PlannerPreferences } from "../data/preferences.ts";
import { DAY_COUNT_OPTIONS, dateKeyOf, dateOfKey, type DayCount } from "../logic/dates.ts";
import { formatDuration } from "../logic/time.ts";
import { IconAction } from "./IconAction.tsx";
import { usePlanner } from "./plannerContext.ts";
import { ReminderSettings } from "./ReminderSettings.tsx";
import { ConfirmDeleteDialog } from "./TaskDialogs.tsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_DURATIONS = [15, 20, 30, 45, 60, 90, 120];

/**
 * The planner settings (wande's Settings tab, the planner part): view
 * preferences per device, then the server's reminder settings.
 */
function PlannerSettings(props: {
  readonly onChange: (patch: Partial<PlannerPreferences>) => void;
}) {
  const { preferences } = usePlanner();
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="icon-sm" variant="outline" aria-label="Planner settings" />}
      >
        <Settings2Icon />
      </PopoverTrigger>
      <PopoverPopup align="end" width="sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Week starts on</Label>
            <Select
              value={String(preferences.weekStartDay)}
              onValueChange={(value) => {
                if (value !== null) props.onChange({ weekStartDay: Number(value) });
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue>{WEEKDAYS[preferences.weekStartDay]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {WEEKDAYS.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Default task duration</Label>
            <Select
              value={String(preferences.defaultTaskDuration)}
              onValueChange={(value) => {
                if (value !== null) props.onChange({ defaultTaskDuration: Number(value) });
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue>{formatDuration(preferences.defaultTaskDuration)}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {[...new Set([...DEFAULT_DURATIONS, preferences.defaultTaskDuration])]
                  .sort((a, b) => a - b)
                  .map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {formatDuration(minutes)}
                    </SelectItem>
                  ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Default routine duration</Label>
            <Select
              value={String(preferences.defaultRoutineDuration)}
              onValueChange={(value) => {
                if (value !== null) props.onChange({ defaultRoutineDuration: Number(value) });
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue>{formatDuration(preferences.defaultRoutineDuration)}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {[...new Set([...DEFAULT_DURATIONS, preferences.defaultRoutineDuration])]
                  .sort((a, b) => a - b)
                  .map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {formatDuration(minutes)}
                    </SelectItem>
                  ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Card style</Label>
            <ToggleGroup
              value={[preferences.cardStyle]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "classic" || next === "modern") props.onChange({ cardStyle: next });
              }}
            >
              <ToggleGroupItem value="classic">Classic</ToggleGroupItem>
              <ToggleGroupItem value="modern">Modern</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Calendar slot height</Label>
            <ToggleGroup
              value={[String(preferences.slotHeight)]}
              onValueChange={(value) => {
                const next = Number(value[0]);
                if (next) props.onChange({ slotHeight: next });
              }}
            >
              {[10, 15, 20, 30].map((height) => (
                <ToggleGroupItem key={height} value={String(height)}>
                  {height}px
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <Label className="flex items-center justify-between gap-3">
            Show schedule counters
            <Switch
              checked={preferences.showProgress}
              onCheckedChange={(checked) => props.onChange({ showProgress: checked })}
            />
          </Label>
          <div className="border-t pt-4">
            <ReminderSettings />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long" });

/**
 * Wande's week header: month and year, `<< < Today > >>`, the three-dots
 * popover (go to date, select items, days shown, view) and, in selection
 * mode, Move, Copy and Delete for the selected entries.
 */
export function WeekHeader(props: {
  readonly startDate: string;
  readonly dayCount: DayCount;
  readonly onNavigate: (
    to: "previous-week" | "previous-day" | "today" | "next-day" | "next-week",
  ) => void;
  readonly onGoToDate: (date: string) => void;
  readonly onDayCountChange: (dayCount: DayCount) => void;
  readonly onPreferencesChange: (patch: Partial<PlannerPreferences>) => void;
  readonly selectionMode: boolean;
  readonly selectedCount: number;
  readonly onSelectionModeChange: (active: boolean) => void;
  readonly onMoveSelected: (date: string) => void;
  readonly onCopySelected: (dates: readonly string[], at: "top" | "bottom") => void;
  readonly onDeleteSelected: () => void;
  /** The stacked layout: the week spans the page, so both sides meet its edges. */
  readonly fullWidth: boolean;
}) {
  const { preferences } = usePlanner();
  // The outer sides follow the page header's gutter, so the header's edges line
  // up with the toolbar's; the side towards the list keeps px-3.
  const headerClass = cn(
    "flex h-12 shrink-0 items-center justify-between gap-2 border-b pr-(--workspace-gutter-end)",
    props.fullWidth ? "pl-(--workspace-gutter-start)" : "pl-3",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [goToOpen, setGoToOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDates, setCopyDates] = useState<Date[]>([]);
  const [copyAt, setCopyAt] = useState<"top" | "bottom">("bottom");
  const [deleting, setDeleting] = useState(false);
  const first = dateOfKey(props.startDate);
  const weekStartsOn = preferences.weekStartDay as 0;
  const none = props.selectedCount === 0;

  if (props.selectionMode)
    return (
      <div className={headerClass}>
        <h2 className="text-sm font-semibold text-foreground">
          Selected{" "}
          <span className="font-medium text-muted-foreground tabular-nums">
            {props.selectedCount} {props.selectedCount === 1 ? "item" : "items"}
          </span>
        </h2>
        <div className="flex items-center gap-1">
          <Popover open={moveOpen} onOpenChange={setMoveOpen}>
            <PopoverTrigger render={<Button size="sm" variant="ghost" disabled={none} />}>
              Move
            </PopoverTrigger>
            <PopoverPopup align="end">
              <Calendar
                mode="single"
                weekStartsOn={weekStartsOn}
                captionLayout="dropdown"
                onSelect={(date) => {
                  if (!date) return;
                  setMoveOpen(false);
                  props.onMoveSelected(dateKeyOf(date));
                }}
              />
            </PopoverPopup>
          </Popover>
          <Popover
            open={copyOpen}
            onOpenChange={(open) => {
              setCopyOpen(open);
              if (!open) {
                setCopyDates([]);
                setCopyAt("bottom");
              }
            }}
          >
            <PopoverTrigger render={<Button size="sm" variant="ghost" disabled={none} />}>
              Copy
            </PopoverTrigger>
            <PopoverPopup align="end">
              <div className="flex flex-col gap-3">
                <Calendar
                  mode="multiple"
                  selected={copyDates}
                  weekStartsOn={weekStartsOn}
                  captionLayout="dropdown"
                  onSelect={(dates) => setCopyDates(dates ?? [])}
                />
                <Select
                  value={copyAt}
                  onValueChange={(value) => {
                    if (value === "top" || value === "bottom") setCopyAt(value);
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Position">
                    <SelectValue>Position: {copyAt === "top" ? "At top" : "At bottom"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="bottom">At bottom</SelectItem>
                    <SelectItem value="top">At top</SelectItem>
                  </SelectPopup>
                </Select>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    size="sm"
                    variant="outline"
                    disabled={copyDates.length === 0}
                    onClick={() => setCopyDates([])}
                  >
                    Clear
                  </Button>
                  <Button
                    className="flex-1"
                    size="sm"
                    disabled={copyDates.length === 0}
                    onClick={() => {
                      props.onCopySelected(copyDates.map(dateKeyOf), copyAt);
                      setCopyOpen(false);
                      setCopyDates([]);
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </PopoverPopup>
          </Popover>
          <Button size="sm" variant="destructive" disabled={none} onClick={() => setDeleting(true)}>
            Delete
          </Button>
          <IconAction
            label="Cancel"
            size="icon-sm"
            onClick={() => props.onSelectionModeChange(false)}
          >
            <XIcon />
          </IconAction>
        </div>
        <ConfirmDeleteDialog
          open={deleting}
          title="Delete selected entries"
          description={`${props.selectedCount} ${props.selectedCount === 1 ? "entry is" : "entries are"} taken off the schedule. The tasks stay.`}
          onOpenChange={setDeleting}
          onConfirm={props.onDeleteSelected}
        />
      </div>
    );

  return (
    <div className={headerClass}>
      <h2 className="truncate text-sm font-semibold text-foreground">
        {monthFormatter.format(first)}{" "}
        <span className="text-muted-foreground">{first.getFullYear()}</span>
      </h2>
      <div className="flex items-center gap-1">
        <IconAction
          label="Previous week"
          variant="outline"
          size="icon-sm"
          onClick={() => props.onNavigate("previous-week")}
        >
          <ChevronsLeftIcon />
        </IconAction>
        <IconAction
          label="Previous day"
          variant="outline"
          size="icon-sm"
          onClick={() => props.onNavigate("previous-day")}
        >
          <ChevronLeftIcon />
        </IconAction>
        <Button size="sm" variant="outline" onClick={() => props.onNavigate("today")}>
          Today
        </Button>
        <IconAction
          label="Next day"
          variant="outline"
          size="icon-sm"
          onClick={() => props.onNavigate("next-day")}
        >
          <ChevronRightIcon />
        </IconAction>
        <IconAction
          label="Next week"
          variant="outline"
          size="icon-sm"
          onClick={() => props.onNavigate("next-week")}
        >
          <ChevronsRightIcon />
        </IconAction>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            render={<Button size="icon-sm" variant="outline" aria-label="View options" />}
          >
            <MoreHorizontalIcon />
          </PopoverTrigger>
          <PopoverPopup align="end" padding="compact">
            <div className="flex w-44 flex-col gap-1">
              <Popover open={goToOpen} onOpenChange={setGoToOpen}>
                <PopoverTrigger
                  render={<Button size="sm" variant="ghost" className="justify-start" />}
                >
                  Go to date
                </PopoverTrigger>
                <PopoverPopup align="end" side="left">
                  <Calendar
                    mode="single"
                    weekStartsOn={weekStartsOn}
                    captionLayout="dropdown"
                    defaultMonth={first}
                    onSelect={(date) => {
                      if (!date) return;
                      setGoToOpen(false);
                      setMenuOpen(false);
                      props.onGoToDate(dateKeyOf(date));
                    }}
                  />
                </PopoverPopup>
              </Popover>
              <Button
                size="sm"
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  setMenuOpen(false);
                  props.onSelectionModeChange(true);
                }}
              >
                Select items
              </Button>
              <span className="px-2 pt-2 text-xs font-semibold text-muted-foreground">
                Days shown
              </span>
              <ToggleGroup
                value={[String(props.dayCount)]}
                onValueChange={(value) => {
                  const next = Number(value[0]);
                  if (DAY_COUNT_OPTIONS.includes(next as DayCount))
                    props.onDayCountChange(next as DayCount);
                }}
              >
                {DAY_COUNT_OPTIONS.map((count) => (
                  <ToggleGroupItem key={count} value={String(count)}>
                    {count}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="px-2 pt-2 text-xs font-semibold text-muted-foreground">View</span>
              <ToggleGroup
                value={[preferences.weekViewMode]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "queue" || next === "calendar")
                    props.onPreferencesChange({ weekViewMode: next });
                }}
              >
                <ToggleGroupItem value="queue">Queue</ToggleGroupItem>
                <ToggleGroupItem value="calendar">Calendar</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </PopoverPopup>
        </Popover>
        <PlannerSettings onChange={props.onPreferencesChange} />
      </div>
    </div>
  );
}
