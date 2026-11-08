import type { BackgroundNotice, DesktopUpdateState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellIcon,
  CheckIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ServerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Fragment, memo, type ReactNode, useState } from "react";

import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateReleaseUrl,
} from "../components/desktopUpdate.logic";
import { openDesktopUpdateReleaseNotes } from "../components/desktopUpdate.toast";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { SidebarUpdatePill } from "../components/sidebar/SidebarUpdatePill";
import { SidebarUpdateReleaseNotes } from "../components/sidebar/SidebarUpdateReleaseNotes";
import { UpdateEverythingDialog } from "../components/sidebar/UpdateEverythingDialog";
import { dismissSettledUpdateRunMachines } from "../components/sidebar/updateEverythingRun";
import { InlineButton } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { Spinner } from "../components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useServerConfigs } from "../state/entities";
import {
  NotificationButton,
  NotificationCard,
  NotificationProgress,
  type NotificationTileTone,
} from "./NotificationCard";
import {
  type AppUpdateCard,
  backgroundNoticeDismissalKey,
  backgroundNoticeHref,
  describeAppUpdateCard,
  describeSidebarNotificationsButton,
  describeUpdateRun,
  hasFailedUpdate,
  type NotificationRank,
  orderNotificationCards,
  type SidebarNotificationsDot,
  updateRunFailed,
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
 * The sidebar footer's one "look here" button. Its popover lists app, server
 * and provider updates and background notices as one list of cards. A running
 * Update everything shows a ring on the button and upstream's capsule in a card.
 */
export const SidebarNotifications = memo(function SidebarNotifications() {
  const updates = useSidebarUpdates();
  const { notices, dismiss } = useBackgroundNotices();
  const [open, setOpen] = useState(false);
  const { dot, label } = describeSidebarNotificationsButton({
    severities: notices.map((notice) => notice.severity),
    update: updates.signal,
    updateFailed: hasFailedUpdate({
      app: updates.state ? describeAppUpdateCard(updates.state, updates.action) : null,
      providerStatuses: updates.providers.map((card) => card.provider.updateState?.status),
      run: updates.run,
    }),
  });
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
                      ) : updates.run !== null && !updateRunFailed(updates.run) ? (
                        <DownloadRing percent={null} />
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
            padding="compact"
            className="w-85"
          >
            <NotificationsPanel
              updates={updates}
              notices={notices}
              dismiss={dismiss}
              onClose={() => setOpen(false)}
            />
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

interface ListedCard {
  readonly key: string;
  readonly rank: NotificationRank;
  readonly occurredAt: string | null;
  readonly node: ReactNode;
}

const NOTICE_TILE: Record<
  BackgroundNotice["severity"],
  { readonly tone: NotificationTileTone; readonly icon: ReactNode }
> = {
  error: { tone: "error", icon: <CircleAlertIcon /> },
  warning: { tone: "warning", icon: <TriangleAlertIcon /> },
  info: { tone: "neutral", icon: <InfoIcon /> },
};

const APP_UPDATE_ICON: Record<AppUpdateCard["kind"], ReactNode> = {
  available: <ArrowUpIcon />,
  downloading: <ArrowDownIcon />,
  ready: <RotateCcwIcon />,
  failed: <CircleAlertIcon />,
};

function NotificationsPanel({
  updates,
  notices,
  dismiss,
  onClose,
}: {
  readonly updates: SidebarUpdates;
  readonly notices: ReturnType<typeof useBackgroundNotices>["notices"];
  readonly dismiss: (keys: ReadonlyArray<string>) => void;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const { state, action, run, pending } = updates;
  const confirmEverything = () => {
    onClose();
    updates.setConfirmingEverything(true);
  };
  const cards: ListedCard[] = notices.map((notice) => ({
    key: backgroundNoticeDismissalKey(notice),
    rank: notice.severity,
    occurredAt: notice.occurredAt,
    node: (
      <NotificationCard
        {...NOTICE_TILE[notice.severity]}
        title={notice.title}
        time={{
          label: new Date(notice.occurredAt).toLocaleTimeString(undefined, { timeStyle: "short" }),
          dateTime: notice.occurredAt,
        }}
        detail={notice.message}
        details={notice.detail}
        links={
          notice.link ? (
            <NotificationButton
              tone="secondary"
              onClick={() => {
                if (!notice.link) return;
                onClose();
                void navigate({
                  href: backgroundNoticeHref(notice.link.path, notice.environmentId),
                });
              }}
            >
              {notice.link.label}
            </NotificationButton>
          ) : null
        }
        onDismiss={() => dismiss([backgroundNoticeDismissalKey(notice)])}
      />
    ),
  }));

  let pendingUpdates = 0;
  if (run !== null) {
    cards.push({
      key: "update-run",
      rank: "update",
      occurredAt: null,
      node: (
        <NotificationCard
          tone="info"
          icon={<RefreshCwIcon />}
          {...describeUpdateRun(run)}
          onDismiss={updateRunFailed(run) ? dismissSettledUpdateRunMachines : undefined}
          below={
            // Upstream's capsule keeps the run's own actions: retry, Later and Restart.
            <ul className="flex">
              <SidebarUpdatePill />
            </ul>
          }
        />
      ),
    });
  } else {
    const app = state ? describeAppUpdateCard(state, action) : null;
    if (state && app) {
      if (action !== "none") pendingUpdates += 1;
      const runAction =
        app.action === "download"
          ? updates.download
          : app.action === "install"
            ? () => {
                onClose();
                updates.install();
              }
            : app.action === "check"
              ? updates.checkForUpdate
              : null;
      cards.push({
        key: "app-update",
        rank: app.kind === "failed" ? "error" : "update",
        occurredAt: null,
        node: (
          <NotificationCard
            tone={app.kind === "failed" ? "error" : "info"}
            icon={APP_UPDATE_ICON[app.kind]}
            title={app.title}
            detail={app.detail}
            action={
              runAction ? (
                <NotificationButton
                  tone={app.kind === "failed" ? "secondary" : "primary"}
                  disabled={pending}
                  onClick={runAction}
                >
                  {app.kind === "failed"
                    ? "Retry"
                    : app.action === "install"
                      ? "Restart"
                      : "Download"}
                </NotificationButton>
              ) : null
            }
            links={
              app.action === "check" ? null : <ReleaseNotesLink state={state} title={app.title} />
            }
            below={
              app.kind === "downloading" ? (
                <NotificationProgress percent={state.downloadPercent} />
              ) : null
            }
          />
        ),
      });
    }
    for (const card of updates.providers) {
      const { provider } = card;
      const status = provider.updateState?.status;
      const failed = status === "failed";
      if (status !== "queued" && status !== "running" && status !== "succeeded") {
        pendingUpdates += 1;
      }
      const current = provider.versionAdvisory.currentVersion ?? provider.version;
      cards.push({
        key: `provider:${card.key}`,
        rank: failed ? "error" : "update",
        occurredAt: null,
        node: (
          <NotificationCard
            tone={failed ? "error" : "neutral"}
            icon={
              failed ? (
                <CircleAlertIcon />
              ) : (
                <ProviderInstanceIcon driverKind={provider.driver} displayName={card.name} />
              )
            }
            title={
              failed
                ? `${card.name} update failed`
                : `${card.name} ${provider.versionAdvisory.latestVersion}`
            }
            detail={
              failed
                ? (provider.updateState?.message ?? "The update did not finish.")
                : `${current ? `You have ${current}` : "Update available"}${card.machineLabel ? ` on ${card.machineLabel}` : ""}`
            }
            details={failed ? provider.updateState?.output : null}
            action={
              status === "queued" ? (
                <UpdateStatus label="Waiting" />
              ) : status === "running" ? (
                <UpdateStatus label="Updating" icon={<Spinner size="xs" />} />
              ) : status === "succeeded" ? (
                <UpdateStatus
                  label="Updated"
                  icon={<CheckIcon className="size-3.5 text-success-foreground" />}
                />
              ) : (
                <NotificationButton tone="secondary" disabled={pending} onClick={card.update}>
                  {failed ? "Retry" : "Update"}
                </NotificationButton>
              )
            }
          />
        ),
      });
    }
    for (const server of updates.servers) {
      pendingUpdates += 1;
      cards.push({
        key: `server:${server.environmentId}`,
        rank: "update",
        occurredAt: null,
        node: (
          <NotificationCard
            tone="neutral"
            icon={<ServerIcon />}
            title={server.label}
            detail={
              server.version
                ? `Server ${server.version} is behind this app.`
                : "Its server is behind this app."
            }
            action={
              // Update everything is the one way to update a server from here.
              updates.runsEverything ? (
                <NotificationButton tone="secondary" disabled={pending} onClick={confirmEverything}>
                  Update
                </NotificationButton>
              ) : null
            }
          />
        ),
      });
    }
  }

  const showsUpdateAll = run === null && updates.runsEverything && pendingUpdates >= 2;
  // The compact popup pads 8px vertically and 12px at the sides; pb-1 evens the bottom.
  return (
    <div className="flex flex-col pb-1">
      <div className="flex min-h-7 items-center gap-2 px-1 pb-2">
        <PopoverTitle className="flex-1">Notifications</PopoverTitle>
        {notices.length > 0 ? (
          <span className="text-xs">
            <InlineButton
              tone="muted"
              onClick={() => dismiss(notices.map(backgroundNoticeDismissalKey))}
            >
              Clear all
            </InlineButton>
          </span>
        ) : null}
        {showsUpdateAll ? (
          <NotificationButton tone="secondary" disabled={pending} onClick={confirmEverything}>
            Update all
          </NotificationButton>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <div className="px-2 pt-5 pb-4 text-center">
          <p className="text-sm font-medium">You're all caught up</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Updates and alerts show here.</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {orderNotificationCards(cards).map((card) => (
            <Fragment key={card.key}>{card.node}</Fragment>
          ))}
        </ol>
      )}
    </div>
  );
}

function UpdateStatus({ label, icon }: { readonly label: string; readonly icon?: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

function ReleaseNotesLink({
  state,
  title,
}: {
  readonly state: DesktopUpdateState;
  readonly title: string;
}) {
  const shell = window.desktopBridge;
  if (hasNightlyReleaseNotes(state)) {
    return (
      <Popover>
        <PopoverTrigger render={<InlineButton tone="muted">Release notes</InlineButton>} />
        <PopoverPopup
          side="top"
          align="start"
          tooltipStyle
          aria-label="Nightly update release notes"
        >
          <SidebarUpdateReleaseNotes shell={shell} state={state} tooltip={title} />
        </PopoverPopup>
      </Popover>
    );
  }
  const releaseUrl = getDesktopUpdateReleaseUrl(getDesktopUpdateDownloadedVersion(state));
  if (!releaseUrl) return null;
  return (
    <InlineButton
      tone="muted"
      onClick={() => void openDesktopUpdateReleaseNotes(shell, releaseUrl)}
    >
      Release notes
      <ExternalLinkIcon aria-hidden className="size-3" />
    </InlineButton>
  );
}
