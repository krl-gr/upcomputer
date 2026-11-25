import { gtFallback, useGT, useLocale } from "gt-react";
import { useEffect, useEffectEvent, useMemo } from "react";
import { BellIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TaskReminder } from "@t3tools/tasks-contracts/v1";

import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { getClientSettings } from "../../../../../apps/web/src/hooks/useSettings.ts";
import { useServerConfigs } from "../../../../../apps/web/src/state/entities.ts";
import { useEnvironments } from "../../../../../apps/web/src/state/environments.ts";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../../../../../apps/web/src/threadNotifications.ts";
import {
  readTasksWebAccess,
  readTasksWebClient,
  useTasksWebAccessRevision,
} from "../../environmentApi.ts";
import type { TasksWebRpcClient } from "@t3tools/tasks-client/rpc";
import { useStoredPlannerEnvironment } from "../data/preferences.ts";
import { dateOfKey, todayKey } from "../logic/dates.ts";
import { formatTime } from "../logic/time.ts";
import { windowStoreFor } from "../windows/windowStore.ts";

/** The reminder's text in `locale`; the component passes its `useGT()`. */
function reminderBody(
  reminder: TaskReminder,
  gt: ReturnType<typeof useGT> = gtFallback,
  locale?: string,
): string {
  const time = formatTime(reminder.startTime, locale);
  if (reminder.date === todayKey()) return gt("Starts at {time}", { time });
  const day = dateOfKey(reminder.date).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return gt("Starts {day} at {time}", { day, time });
}

/**
 * One environment's reminders, from the task change stream the sidebar's run
 * counts already keep open. Each shows as a toast that stays until handled;
 * while the app is in the background it is also a system notification
 * (desktop, or a browser that allowed them), under the same notification
 * settings as threads. Opening it shows the task's window in the planner.
 */
function EnvironmentReminders(props: {
  readonly environmentId: EnvironmentId;
  readonly client: TasksWebRpcClient;
}) {
  const { environmentId, client } = props;
  const gt = useGT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [, setPlannerEnvironment] = useStoredPlannerEnvironment();
  const open = useEffectEvent((reminder: TaskReminder) => {
    setPlannerEnvironment(environmentId);
    windowStoreFor(environmentId).openDetail(reminder.taskId);
    void navigate({ to: "/tasks", search: { view: "planner" } } as never);
  });
  // An effect event, so the translations are current without re-subscribing.
  const reminderText = useEffectEvent((reminder: TaskReminder) => ({
    body: reminderBody(reminder, gt, locale),
    open: gt("Open", { $context: "button that opens the reminded task" }),
  }));

  useEffect(() => {
    const present = (reminder: TaskReminder) => {
      const { body, open: openLabel } = reminderText(reminder);
      const mode = getClientSettings().notificationMode;
      if (hasNotificationSound(mode))
        void playNotificationSound("input", () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      const toastId = toastManager.add({
        type: "info",
        title: reminder.title,
        description: body,
        timeout: 0,
        data: {
          hideCopyButton: true,
          leadingIcon: <BellIcon aria-hidden className="size-4 text-info-foreground" />,
        },
        actionProps: {
          children: openLabel,
          onClick: () => {
            toastManager.close(toastId);
            open(reminder);
          },
        },
      });
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus()) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        return;
      try {
        const notification = new Notification(reminder.title, {
          body,
          tag: `task-reminder:${environmentId}:${reminder.entryId}`,
        });
        notification.addEventListener("click", () => {
          notification.close();
          toastManager.close(toastId);
          window.focus();
          open(reminder);
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    };
    return client.tasks.subscribe((change) => {
      for (const reminder of change.reminders ?? []) present(reminder);
    });
  }, [client, environmentId]);

  return null;
}

/** Task reminders from every connected environment that serves Tasks. */
export function TaskReminderNotifications() {
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const accessRevision = useTasksWebAccessRevision();
  const clients = useMemo(() => {
    const result: Array<{ environmentId: EnvironmentId; client: TasksWebRpcClient }> = [];
    for (const { environmentId } of environments) {
      if (!serverConfigs.has(environmentId)) continue;
      if (readTasksWebAccess(environmentId).canReadTasks)
        result.push({ environmentId, client: readTasksWebClient(environmentId) });
    }
    return result;
    // Environments are checked once connected; access changes re-run this.
    // oxlint-disable-next-line react/memo-dependencies -- the revision re-reads access.
  }, [environments, serverConfigs, accessRevision]);
  return clients.map(({ environmentId, client }) => (
    <EnvironmentReminders key={environmentId} environmentId={environmentId} client={client} />
  ));
}
