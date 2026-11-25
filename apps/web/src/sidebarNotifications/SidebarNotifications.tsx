import type { BackgroundNotice, DesktopUpdateState, EnvironmentId } from "@t3tools/contracts";
import { connectionErrorText } from "@t3tools/client-runtime/connection";
import {
  InstructionUpdatesNotification,
  useInstructionUpdatesNoticeCount,
} from "@t3tools/tasks-web/workflowUpdates";
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
  MessageSquareTextIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ServerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Fragment, memo, type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { T, useGT, useMessages } from "gt-react";

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
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../components/ui/sidebar";
import { Spinner } from "../components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { APP_BASE_NAME } from "../branding";
import { environmentCatalog } from "../connection/catalog";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { computerName } from "../sidebarComputers/useSidebarComputers";
import { useServerConfigs } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { type ListedClientNotice, useClientNotices } from "./clientNotices";
import { useComputerOutages } from "./computerOutages";
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
  withoutUnreachableComputers,
} from "./sidebarNotifications.logic";
import { type SidebarUpdates, useSidebarUpdates } from "./useSidebarUpdates";
import { useSidebarFooterTooltipSide } from "../adaptiveSidebar/adaptiveSidebar";
import { BadgedIcon } from "../badgedIcon/BadgedIcon";
import { WithConnectAccountEmail } from "../sendFeedback/ConnectAccountEmail";
import { SendFeedbackForm } from "../sendFeedback/SendFeedbackForm";
import { onSendFeedbackRequest } from "../sendFeedback/sendFeedbackStore";
import { useSendFeedback, useSendFeedbackForm } from "../sendFeedback/useSendFeedback";
import { SurveyAction, SurveyAutoHeight, useSurveyForm } from "../userSurvey/surveyParts";
import { UserSurveyCard } from "../userSurvey/UserSurveyCard";
import { UserSurveyDialog } from "../userSurvey/UserSurveyDialog";
import { useUserSurvey } from "../userSurvey/useUserSurvey";

const DISMISSED_KEY = "upcomputer:background-notices-dismissed:v1";
const DismissedNotices = Schema.Array(Schema.String);

const DOT_CLASS: Record<SidebarNotificationsDot, string> = {
  error: "fill-destructive",
  warning: "fill-warning",
  neutral: "fill-sidebar-foreground",
};

const PROGRESS_RADIUS = 14;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

/**
 * Failures that belong to no thread: the servers' (reminders, automations, scheduled runs,
 * worktree cleanup, remote access) and this client's (an unreachable computer, a list that
 * didn't load).
 */
function useBackgroundNotices() {
  const gt = useGT();
  const m = useMessages();
  const configs = useServerConfigs();
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const outages = useComputerOutages();
  const clientNotices = useClientNotices();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const [dismissedList, setDismissedList] = useLocalStorage(
    DISMISSED_KEY,
    [] as ReadonlyArray<string>,
    DismissedNotices,
  );
  const presentationOf = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId);
  const nameOf = (environmentId: EnvironmentId) => {
    const presentation = presentationOf(environmentId);
    return presentation ? computerName(presentation, primaryId, gt) : null;
  };
  const local: ListedClientNotice[] = [
    ...outages.shown.flatMap(({ environmentId, since }): ListedClientNotice[] => {
      const computer = nameOf(environmentId);
      if (computer === null) return [];
      const connection = presentationOf(environmentId)?.connection;
      // A connection stopped on an error (a revoked pairing) waits for Retry or a fix.
      const stopped = connection?.phase === "error";
      const detail = stopped ? connectionErrorText(connection, m) : null;
      return [
        {
          id: `client:${environmentId}:computer:${stopped ? "blocked" : "unreachable"}`,
          area: "app",
          severity: stopped ? "error" : "warning",
          title: stopped
            ? gt("Can't connect to {computer}", { computer })
            : gt("Can't reach {computer}", { computer }),
          message: stopped
            ? gt("{appName} stopped trying. Retry, or open Connections to see why.", {
                appName: APP_BASE_NAME,
              })
            : gt("{appName} keeps trying. Its chats, bots and tasks show what they had.", {
                appName: APP_BASE_NAME,
              }),
          ...(detail ? { detail } : {}),
          link: { label: gt("Connections"), path: "/settings/connections" },
          occurredAt: new Date(since).toISOString(),
          environmentId,
          retry: () => void retryEnvironment(environmentId),
        },
      ];
    }),
    ...withoutUnreachableComputers(clientNotices, outages.unreachable).flatMap(
      (notice): ListedClientNotice[] => {
        const computer = nameOf(notice.environmentId);
        if (computer === null) return [];
        return [
          {
            id: `client:${notice.environmentId}:${notice.id}`,
            area: "app",
            severity: notice.severity,
            title: m(notice.title, { computer }),
            message: m(notice.message, { computer }),
            ...(notice.detail ? { detail: notice.detail } : {}),
            occurredAt: notice.occurredAt,
            environmentId: notice.environmentId,
            ...(notice.retry ? { retry: notice.retry } : {}),
          },
        ];
      },
    ),
  ];
  const notices = visibleBackgroundNotices<ListedClientNotice>(
    [
      ...[...configs].map(([environmentId, config]) =>
        config.backgroundNotices?.map((notice) => ({ ...notice, environmentId })),
      ),
      local,
    ],
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
  const gt = useGT();
  const updates = useSidebarUpdates();
  const { notices, dismiss } = useBackgroundNotices();
  const userSurvey = useUserSurvey();
  const instructionUpdates = useInstructionUpdatesNoticeCount();
  const [open, setOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const surveyForm = useSurveyForm(
    userSurvey?.survey ?? null,
    userSurvey?.submit ?? null,
    userSurvey?.partial ?? null,
  );
  const feedbackSource = useSendFeedback();
  const feedback = useSendFeedbackForm(feedbackSource);
  const [view, setView] = useState<"list" | "feedback">("list");
  const sidebar = useSidebar();
  const openFeedbackForm = useEffectEvent(() => {
    if (!feedbackSource.available) return;
    if (sidebar.isMobile) sidebar.setOpenMobile(true);
    else if (!sidebar.open) sidebar.setOpen(true);
    setView("feedback");
    setOpen(true);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the command palette asks for the form from outside this tree
  useEffect(() => onSendFeedbackRequest(openFeedbackForm), []);
  const showList = () => {
    setView("list");
    if (feedback.status.kind === "sent") feedback.reset();
  };
  const { dot, label } = describeSidebarNotificationsButton(
    {
      severities: notices.map((notice) => notice.severity),
      survey: userSurvey !== null,
      instructionUpdates,
      update: updates.signal,
      updateFailed: hasFailedUpdate({
        app: updates.state ? describeAppUpdateCard(updates.state, updates.action, gt) : null,
        providerStatuses: updates.providers.map((card) => card.provider.updateState?.status),
        run: updates.run,
      }),
    },
    gt,
  );
  const tooltipSide = useSidebarFooterTooltipSide();

  return (
    <>
      <SidebarMenuItem className="shrink-0">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) userSurvey?.shown();
          }}
          // Closing keeps the draft, and the bell opens on the notifications again.
          onOpenChangeComplete={(next) => {
            if (!next) showList();
          }}
        >
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
            className="w-85 max-w-[calc(100vw-1rem)]"
          >
            <SurveyAutoHeight>
              {view === "feedback" ? (
                <WithConnectAccountEmail>
                  {(accountEmail) => (
                    <SendFeedbackForm
                      draft={feedback.draft}
                      status={feedback.status}
                      accountEmail={accountEmail}
                      systemInfo={feedbackSource.systemInfo}
                      onDraftChange={feedback.setDraft}
                      onSubmit={() => feedback.submit(accountEmail)}
                      onBack={showList}
                      onDone={showList}
                    />
                  )}
                </WithConnectAccountEmail>
              ) : (
                <NotificationsPanel
                  updates={updates}
                  notices={notices}
                  dismiss={dismiss}
                  instructionUpdates={instructionUpdates > 0}
                  surveyCard={
                    userSurvey ? (
                      <UserSurveyCard
                        key={userSurvey.survey.id}
                        survey={userSurvey.survey}
                        draft={surveyForm.draft}
                        onStart={(draft) => {
                          surveyForm.start(draft);
                          setOpen(false);
                          setSurveyOpen(true);
                        }}
                        onDismiss={() => {
                          if (surveyForm.leftOn) userSurvey.dismiss(surveyForm.leftOn);
                        }}
                      />
                    ) : null
                  }
                  onClose={() => setOpen(false)}
                  onSendFeedback={feedbackSource.available ? () => setView("feedback") : null}
                />
              )}
            </SurveyAutoHeight>
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
        {userSurvey ? (
          <UserSurveyDialog
            key={userSurvey.survey.id}
            survey={userSurvey.survey}
            draft={surveyForm.draft}
            status={surveyForm.status}
            step={surveyForm.step}
            back={surveyForm.back}
            onDraftChange={surveyForm.setDraft}
            onStepChange={surveyForm.goTo}
            onSubmit={surveyForm.submit}
            open={surveyOpen}
            onOpenChange={setSurveyOpen}
            onBackToCard={() => {
              setSurveyOpen(false);
              setOpen(true);
            }}
            onSent={userSurvey.finish}
          />
        ) : null}
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
  instructionUpdates,
  surveyCard,
  onClose,
  onSendFeedback,
}: {
  readonly updates: SidebarUpdates;
  readonly notices: ReturnType<typeof useBackgroundNotices>["notices"];
  readonly dismiss: (keys: ReadonlyArray<string>) => void;
  /** A release's instruction updates wait for a decision; they rank with the updates. */
  readonly instructionUpdates: boolean;
  /** The survey the server offers, as its card; it ranks with the notices. */
  readonly surveyCard: ReactNode;
  readonly onClose: () => void;
  /** Turns the popover to the feedback form; null when this client may not send feedback. */
  readonly onSendFeedback: (() => void) | null;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { state, action, run, pending } = updates;
  const updateEverything = () => {
    onClose();
    updates.updateEverything();
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
        action={
          notice.retry ? (
            <NotificationButton tone="secondary" onClick={notice.retry}>
              {gt("Retry")}
            </NotificationButton>
          ) : null
        }
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
          {...describeUpdateRun(run, gt)}
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
    const app = state ? describeAppUpdateCard(state, action, gt) : null;
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
                    ? gt("Retry")
                    : app.action === "install"
                      ? gt("Restart")
                      : gt("Download")}
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
                ? gt("{provider} update failed", { provider: card.name })
                : `${card.name} ${provider.versionAdvisory.latestVersion}`
            }
            detail={
              failed
                ? (provider.updateState?.message ?? gt("The update did not finish."))
                : current
                  ? card.machineLabel
                    ? gt("You have {version} on {machine}", {
                        version: current,
                        machine: card.machineLabel,
                      })
                    : gt("You have {version}", { version: current })
                  : card.machineLabel
                    ? gt("Update available on {machine}", { machine: card.machineLabel })
                    : gt("Update available")
            }
            details={failed ? provider.updateState?.output : null}
            action={
              status === "queued" ? (
                <UpdateStatus label={gt("Waiting")} />
              ) : status === "running" ? (
                <UpdateStatus label={gt("Updating")} icon={<Spinner size="xs" />} />
              ) : status === "succeeded" ? (
                <UpdateStatus
                  label={gt("Updated")}
                  icon={<CheckIcon className="size-3.5 text-success-foreground" />}
                />
              ) : (
                <NotificationButton tone="secondary" disabled={pending} onClick={card.update}>
                  {failed ? gt("Retry") : gt("Update")}
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
                ? gt("Server {version} is behind this app.", { version: server.version })
                : gt("Its server is behind this app.")
            }
            action={
              // Update everything is the one way to update a server from here.
              updates.runsEverything ? (
                <NotificationButton tone="secondary" disabled={pending} onClick={updateEverything}>
                  <T>Update</T>
                </NotificationButton>
              ) : null
            }
          />
        ),
      });
    }
  }

  if (instructionUpdates) {
    cards.push({
      key: "instruction-updates",
      rank: "update",
      occurredAt: null,
      node: <InstructionUpdatesNotification onClose={onClose} />,
    });
  }

  if (surveyCard) {
    cards.push({ key: "survey", rank: "info", occurredAt: null, node: surveyCard });
  }

  const showsUpdateAll = run === null && updates.runsEverything && pendingUpdates >= 2;
  // The compact popup pads 8px vertically and 12px at the sides; pb-1 evens the bottom.
  return (
    <div className="flex flex-col pb-1">
      <div className="flex min-h-7 items-center gap-2 px-1 pb-2">
        <PopoverTitle className="flex-1">
          <T>Notifications</T>
        </PopoverTitle>
        {notices.length > 0 ? (
          <span className="text-xs">
            <InlineButton
              tone="muted"
              onClick={() => dismiss(notices.map(backgroundNoticeDismissalKey))}
            >
              <T>Clear all</T>
            </InlineButton>
          </span>
        ) : null}
        {showsUpdateAll ? (
          <NotificationButton tone="secondary" disabled={pending} onClick={updateEverything}>
            <T>Update all</T>
          </NotificationButton>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <div className="px-2 pt-5 pb-4 text-center">
          <p className="text-sm font-medium">
            <T>You're all caught up</T>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <T>Updates and alerts show here.</T>
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {orderNotificationCards(cards).map((card) => (
            <Fragment key={card.key}>{card.node}</Fragment>
          ))}
        </ol>
      )}
      {onSendFeedback ? (
        <div className="mt-2 flex border-t border-foreground/7 pt-1.5">
          <SurveyAction
            size="sm"
            tone="quiet"
            data-track="notifications.send-feedback"
            onClick={onSendFeedback}
          >
            <MessageSquareTextIcon aria-hidden />
            <T>Send feedback</T>
          </SurveyAction>
        </div>
      ) : null}
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
  const gt = useGT();
  const shell = window.desktopBridge;
  if (hasNightlyReleaseNotes(state)) {
    return (
      <Popover>
        <PopoverTrigger
          render={
            <InlineButton tone="muted">
              <T>Release notes</T>
            </InlineButton>
          }
        />
        <PopoverPopup
          side="top"
          align="start"
          tooltipStyle
          aria-label={gt("Nightly update release notes")}
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
      <T>Release notes</T>
      <ExternalLinkIcon aria-hidden className="size-3" />
    </InlineButton>
  );
}
