import type { DesktopUpdateState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { BellIcon, ExternalLinkIcon } from "lucide-react";
import { memo, useState } from "react";

import {
  canCheckForUpdate,
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateReleaseUrl,
} from "../components/desktopUpdate.logic";
import { openDesktopUpdateReleaseNotes } from "../components/desktopUpdate.toast";
import { ErrorDetails } from "../components/errors/ErrorDetails";
import { SidebarUpdatePill } from "../components/sidebar/SidebarUpdatePill";
import { SidebarUpdateReleaseNotes } from "../components/sidebar/SidebarUpdateReleaseNotes";
import { UpdateEverythingDialog } from "../components/sidebar/UpdateEverythingDialog";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Separator } from "../components/ui/separator";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { Spinner } from "../components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { cn } from "../lib/utils";
import { useServerConfigs } from "../state/entities";
import {
  backgroundNoticeDismissalKey,
  backgroundNoticeHref,
  describeAppUpdate,
  describeSidebarNotificationsButton,
  type SidebarNotificationsDot,
  visibleBackgroundNotices,
} from "./sidebarNotifications.logic";
import { type SidebarUpdates, useSidebarUpdates } from "./useSidebarUpdates";
import { useSidebarFooterTooltipSide } from "../adaptiveSidebar/adaptiveSidebar";
import { BadgedIcon } from "../badgedIcon/BadgedIcon";

const DISMISSED_KEY = "upcomputer:background-notices-dismissed:v1";
const DismissedNotices = Schema.Array(Schema.String);

const DOT_CLASS: Record<SidebarNotificationsDot, string> = {
  error: "fill-destructive",
  warning: "fill-warning",
  neutral: "fill-sidebar-foreground",
};

const PROGRESS_RADIUS = 14;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

/** Failures that belong to no thread (reminders, automations, scheduled runs, worktree cleanup, remote access). */
function useBackgroundNotices() {
  const configs = useServerConfigs();
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
  const dismiss = (keys: ReadonlyArray<string>) =>
    setDismissedList((current) => [...new Set([...current, ...keys])].slice(-200));
  return { notices, dismiss };
}

/**
 * The sidebar footer's one "look here" button: app, server and provider
 * updates on top, background notices below. A running Update everything keeps
 * upstream's capsule beside it.
 */
export const SidebarNotifications = memo(function SidebarNotifications() {
  const updates = useSidebarUpdates();
  const { notices, dismiss } = useBackgroundNotices();
  const [open, setOpen] = useState(false);
  const { dot, label } = describeSidebarNotificationsButton({
    severities: notices.map((notice) => notice.severity),
    update: updates.signal,
  });
  const navigate = useNavigate();
  const tooltipSide = useSidebarFooterTooltipSide();

  return (
    <>
      <SidebarMenuItem className="shrink-0">
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <SidebarMenuButton
                      aria-label={label}
                      className="relative"
                      data-track="sidebar.notifications"
                      size="icon"
                    >
                      <BadgedIcon icon={BellIcon} dotClassName={dot ? DOT_CLASS[dot] : null} />
                      {updates.signal.kind === "downloading" ? (
                        <DownloadRing percent={updates.signal.percent} />
                      ) : null}
                    </SidebarMenuButton>
                  }
                />
              }
            />
            <TooltipPopup side={tooltipSide}>{label}</TooltipPopup>
          </Tooltip>
          <PopoverPopup
            side={tooltipSide}
            align={tooltipSide === "top" ? "start" : "end"}
            className="w-80"
          >
            <div className="flex flex-col gap-3 pb-1">
              <UpdatesSection updates={updates} onLeave={() => setOpen(false)} />
              <Separator />
              <section className="flex flex-col gap-2">
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <PopoverTitle>Notifications</PopoverTitle>
                  {notices.length > 0 ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => dismiss(notices.map(backgroundNoticeDismissalKey))}
                    >
                      Dismiss all
                    </Button>
                  ) : null}
                </div>
                {notices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notifications</p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {notices.map((notice) => (
                      <li
                        key={backgroundNoticeDismissalKey(notice)}
                        className="flex flex-col gap-1 text-sm"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "font-medium",
                              notice.severity === "error" && "text-destructive",
                              notice.severity === "warning" && "text-warning",
                            )}
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
                                    href: backgroundNoticeHref(
                                      notice.link.path,
                                      notice.environmentId,
                                    ),
                                  });
                                }}
                              >
                                {notice.link.label}
                              </Button>
                            ) : null}
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => dismiss([backgroundNoticeDismissalKey(notice)])}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </PopoverPopup>
        </Popover>
        <UpdateEverythingDialog
          open={updates.confirmingEverything}
          onOpenChange={updates.setConfirmingEverything}
          version={updates.everything.version}
          providerCount={updates.everything.providerCount}
          rows={updates.everything.rows}
          restarts={updates.everything.restarts}
          onConfirm={updates.runEverything}
        />
      </SidebarMenuItem>
      {/* Upstream's control shows the run as its capsule, with retry, postpone and restart. */}
      {updates.run !== null ? <SidebarUpdatePill /> : null}
    </>
  );
});

function DownloadRing({ percent }: { readonly percent: number | null }) {
  const clamped = percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, percent);
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0.5">
      <svg className="size-full -rotate-90 text-sidebar-foreground" viewBox="0 0 32 32">
        <circle
          cx="16"
          cy="16"
          r={PROGRESS_RADIUS}
          fill="none"
          className="stroke-current/22"
          strokeWidth="1.5"
        />
        <circle
          cx="16"
          cy="16"
          r={PROGRESS_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeDasharray={PROGRESS_CIRCUMFERENCE}
          strokeDashoffset={PROGRESS_CIRCUMFERENCE * (1 - Math.max(0, clamped) / 100)}
          strokeLinecap="round"
          strokeWidth="1.5"
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        />
      </svg>
    </span>
  );
}

function hasNightlyReleaseNotes(state: DesktopUpdateState): boolean {
  return state.channel === "nightly" && state.releaseNotes.length > 0;
}

function UpdatesSection({
  updates,
  onLeave,
}: {
  readonly updates: SidebarUpdates;
  readonly onLeave: () => void;
}) {
  const { state, action, everything, run, runsEverything, pending } = updates;
  const app = state ? describeAppUpdate(state, action) : null;
  const downloading = state?.status === "downloading";
  const offersUpdate = action !== "none" || downloading;
  const releaseUrl =
    state && offersUpdate
      ? getDesktopUpdateReleaseUrl(getDesktopUpdateDownloadedVersion(state))
      : null;
  const shell = window.desktopBridge;

  // Server and provider updates lead while the app itself has nothing to say.
  const summaryLeads = runsEverything && !offersUpdate;
  let headline = (
    <UpdateHeadline
      title={summaryLeads ? everything.summary : (app?.title ?? "Up to date")}
      detail={app?.detail ?? null}
      busy={state?.status === "checking"}
    />
  );
  if (run !== null) {
    headline = <UpdateHeadline title="Updating everything" detail="Progress shows below" busy />;
  } else if (state && offersUpdate && hasNightlyReleaseNotes(state)) {
    headline = (
      <div className="-mx-1">
        <SidebarUpdateReleaseNotes shell={shell} state={state} tooltip={app?.title ?? ""} />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <PopoverTitle className="flex min-h-6 items-center">Updates</PopoverTitle>
      {headline}
      {downloading ? (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/70 transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.min(100, Math.max(0, state?.downloadPercent ?? 0))}%` }}
          />
        </div>
      ) : null}
      {run === null && runsEverything && !summaryLeads ? (
        <p className="text-sm text-muted-foreground">{everything.summary}</p>
      ) : null}
      {run === null ? (
        <div className="flex flex-wrap items-center gap-1">
          {runsEverything ? (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => {
                onLeave();
                updates.setConfirmingEverything(true);
              }}
            >
              Update everything
            </Button>
          ) : action === "install" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => {
                onLeave();
                updates.install();
              }}
            >
              Restart to update
            </Button>
          ) : action === "download" ? (
            <Button size="xs" variant="outline" disabled={pending} onClick={updates.download}>
              Download
            </Button>
          ) : null}
          {canCheckForUpdate(state) ? (
            <Button size="xs" variant="ghost" disabled={pending} onClick={updates.checkForUpdate}>
              Check for updates
            </Button>
          ) : null}
          {releaseUrl && state && !hasNightlyReleaseNotes(state) ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void openDesktopUpdateReleaseNotes(shell, releaseUrl)}
            >
              Release notes
              <ExternalLinkIcon aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function UpdateHeadline({
  title,
  detail,
  busy,
}: {
  readonly title: string;
  readonly detail: string | null;
  readonly busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <div className="flex items-center gap-2 font-medium">
        {title}
        {busy ? <Spinner size="sm" /> : null}
      </div>
      {detail ? <p className="text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
