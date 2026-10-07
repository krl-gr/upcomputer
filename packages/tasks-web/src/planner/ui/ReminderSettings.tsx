import { useCallback, useEffect, useState } from "react";
import type {
  TaskScheduleSettings,
  TaskScheduleSettingsUpdateInput,
} from "@t3tools/tasks-contracts/v1";

import { Label } from "../../../../../apps/web/src/components/ui/label.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import { Switch } from "../../../../../apps/web/src/components/ui/switch.tsx";
import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { readTasksWebClient } from "../../environmentApi.ts";
import { errorMessage } from "../data/plannerStore.ts";
import { formatDuration } from "../logic/time.ts";
import { usePlanner } from "./plannerContext.ts";

const LEAD_MINUTES = [0, 5, 10, 15, 30, 60];
const SERVER_ZONE = "server";

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/** The environment's schedule settings, read when the settings open. */
function useScheduleSettings(environmentId: string) {
  const [settings, setSettings] = useState<TaskScheduleSettings | null>(null);
  useEffect(() => {
    let live = true;
    readTasksWebClient(environmentId as never)
      .tasks.getScheduleSettings({})
      .then(
        (result) => {
          if (live) setSettings(result);
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [environmentId]);
  const update = useCallback(
    (patch: TaskScheduleSettingsUpdateInput) => {
      readTasksWebClient(environmentId as never)
        .tasks.updateScheduleSettings(patch)
        .then(setSettings, (error: unknown) =>
          toastManager.add({
            type: "error",
            title: "Could not change the reminder settings",
            description: errorMessage(error),
          }),
        );
    },
    [environmentId],
  );
  return [settings, update] as const;
}

/**
 * Reminders and the schedule's time zone, kept by the server (they apply to
 * every device): reminders on or off, how long before a timed entry, and the
 * zone its dates and times are in.
 */
export function ReminderSettings() {
  const { environmentId } = usePlanner();
  const [settings, update] = useScheduleSettings(environmentId);
  if (!settings)
    return <p className="text-xs text-muted-foreground">Loading the reminder settings…</p>;
  const zone = settings.scheduleTimeZone ?? settings.serverTimeZone;
  const browser = browserTimeZone();
  return (
    <div className="flex flex-col gap-4">
      <Label className="flex items-center justify-between gap-3">
        Reminders
        <Switch
          checked={settings.remindersEnabled}
          onCheckedChange={(checked) => update({ remindersEnabled: checked })}
        />
      </Label>
      <div className="flex flex-col gap-1.5">
        <Label>Remind before</Label>
        <Select
          disabled={!settings.remindersEnabled}
          value={String(settings.reminderLeadMinutes)}
          onValueChange={(value) => {
            if (value !== null) update({ reminderLeadMinutes: Number(value) });
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue>{leadLabel(settings.reminderLeadMinutes)}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {[...new Set([...LEAD_MINUTES, settings.reminderLeadMinutes])]
              .sort((a, b) => a - b)
              .map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {leadLabel(minutes)}
                </SelectItem>
              ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Time zone of the schedule</Label>
        <Select
          value={settings.scheduleTimeZone ?? SERVER_ZONE}
          onValueChange={(value) => {
            if (value !== null) update({ scheduleTimeZone: value === SERVER_ZONE ? null : value });
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {settings.scheduleTimeZone ?? `Server's (${settings.serverTimeZone})`}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={SERVER_ZONE}>Server's ({settings.serverTimeZone})</SelectItem>
            {timeZones().map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {zone !== browser ? (
          <p className="text-xs text-muted-foreground">
            Times are reminded as {zone} time; this device is on {browser}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function leadLabel(minutes: number): string {
  return minutes === 0 ? "At the start" : formatDuration(minutes);
}
