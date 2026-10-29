import type { BackgroundNotice, EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { BellIcon } from "lucide-react";
import { memo, useState } from "react";

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

export function visibleBackgroundNotices<Notice extends BackgroundNotice>(
  noticeLists: ReadonlyArray<ReadonlyArray<Notice> | undefined>,
  dismissed: ReadonlySet<string>,
): Notice[] {
  return noticeLists
    .flatMap((notices) => notices ?? [])
    .filter((notice) => !dismissed.has(dismissalKey(notice)))
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/** A notice's in-app link, on the computer the notice came from. */
export function backgroundNoticeHref(path: string, environmentId: EnvironmentId): string {
  const url = new URL(path, "http://notice.invalid");
  url.searchParams.set("environment", environmentId);
  return `${url.pathname}${url.search}`;
}

/**
 * The one place for failures that belong to no thread (reminders,
 * automations, scheduled runs, worktree cleanup, remote access). Hidden while
 * there is nothing to show.
 */
export const SidebarBackgroundNotices = memo(function SidebarBackgroundNotices() {
  const configs = useServerConfigs();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dismissedList, setDismissedList] = useLocalStorage(
    DISMISSED_KEY,
    [] as ReadonlyArray<string>,
    DismissedNotices,
  );
  const notices = visibleBackgroundNotices(
    [...configs].map(([environmentId, config]) =>
      config.backgroundNotices?.map((notice) => ({ ...notice, environmentId })),
    ),
    new Set(dismissedList),
  );
  if (notices.length === 0) return null;
  const dismiss = (keys: ReadonlyArray<string>) =>
    setDismissedList((current) => [...new Set([...current, ...keys])].slice(-200));
  const label = `${notices.length} notification${notices.length === 1 ? "" : "s"}`;
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
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
                  <div className="flex shrink-0 items-center gap-1">
                    {notice.link ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          if (!notice.link) return;
                          setOpen(false);
                          void navigate({
                            href: backgroundNoticeHref(notice.link.path, notice.environmentId),
                          });
                        }}
                      >
                        {notice.link.label}
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => dismiss([dismissalKey(notice)])}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
});
