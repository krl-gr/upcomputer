import type { BackgroundNotice } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { BellIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useServerConfigs } from "../../state/entities";
import { ErrorDetails } from "../errors/ErrorDetails";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

const DISMISSED_KEY = "upcomputer:background-notices-dismissed:v1";
const DismissedNotices = Schema.Array(Schema.String);

/** A repeat of the same problem shows again, so dismissal is per occurrence. */
function dismissalKey(notice: BackgroundNotice): string {
  return `${notice.id}@${notice.occurredAt}`;
}

export function visibleBackgroundNotices(
  noticeLists: ReadonlyArray<ReadonlyArray<BackgroundNotice> | undefined>,
  dismissed: ReadonlySet<string>,
): BackgroundNotice[] {
  return noticeLists
    .flatMap((notices) => notices ?? [])
    .filter((notice) => !dismissed.has(dismissalKey(notice)))
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/**
 * The one place for failures that belong to no thread (reminders,
 * automations, scheduled runs, worktree cleanup, remote access). Hidden while
 * there is nothing to show.
 */
export const SidebarBackgroundNotices = memo(function SidebarBackgroundNotices() {
  const configs = useServerConfigs();
  const [dismissedList, setDismissedList] = useLocalStorage(
    DISMISSED_KEY,
    [] as ReadonlyArray<string>,
    DismissedNotices,
  );
  const notices = useMemo(
    () =>
      visibleBackgroundNotices(
        [...configs.values()].map((config) => config.backgroundNotices),
        new Set(dismissedList),
      ),
    [configs, dismissedList],
  );
  if (notices.length === 0) return null;
  const dismiss = (keys: ReadonlyArray<string>) =>
    setDismissedList((current) => [...new Set([...current, ...keys])].slice(-200));
  const label = `${notices.length} notification${notices.length === 1 ? "" : "s"}`;
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              data-track="sidebar.background_notices"
              size="icon"
              className="relative"
            >
              <BellIcon />
              <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-warning px-1 text-3xs leading-3.5 font-medium text-warning-foreground">
                {notices.length}
              </span>
            </SidebarMenuButton>
          }
        />
        <PopoverPopup side="top" align="start" className="w-80">
          <div className="flex items-center justify-between gap-2 pb-2">
            <PopoverTitle>Notifications</PopoverTitle>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => dismiss(notices.map((notice) => dismissalKey(notice)))}
            >
              Dismiss all
            </Button>
          </div>
          <ol className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {notices.map((notice) => (
              <li key={dismissalKey(notice)} className="flex flex-col gap-1 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={
                      notice.severity === "error"
                        ? "font-medium text-destructive"
                        : notice.severity === "warning"
                          ? "font-medium text-warning"
                          : "font-medium"
                    }
                  >
                    {notice.title}
                  </span>
                  <time
                    dateTime={notice.occurredAt}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {new Date(notice.occurredAt).toLocaleTimeString(undefined, {
                      timeStyle: "short",
                    })}
                  </time>
                </div>
                <p className="text-muted-foreground">{notice.message}</p>
                <div className="flex items-center justify-between gap-2">
                  <ErrorDetails detail={notice.detail} />
                  <Button size="xs" variant="ghost" onClick={() => dismiss([dismissalKey(notice)])}>
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
});
