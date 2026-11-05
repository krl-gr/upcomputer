import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { BOTS_RPC_METHODS, type Bot } from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";
import {
  useConnectedEnvironmentIds,
  usePrimaryEnvironmentId,
} from "../../../../apps/web/src/state/environments.ts";
import { useLocalStorage } from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import {
  Collapsible,
  CollapsiblePanel,
} from "../../../../apps/web/src/components/ui/collapsible.tsx";
import { MenuItem, MenuPopup } from "../../../../apps/web/src/components/ui/menu.tsx";
import {
  SidebarRowContextMenu,
  SidebarRowContextMenuTrigger,
} from "../../../../apps/web/src/sidebarThreadRow/SidebarRowContextMenu.ts";
import { SidebarMenu, SidebarMenuItem } from "../../../../apps/web/src/components/ui/sidebar.tsx";
import { SidebarEmptyRow } from "../../../../apps/web/src/sidebarProjects/SidebarEmptyRow.tsx";
import { useSidebarProjectScope } from "../../../../apps/web/src/sidebarProjects/sidebarProjectScope.ts";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import {
  SidebarSectionHeader,
  SidebarSectionHeaderAction,
} from "../../../../apps/web/src/sidebarProjects/SidebarSectionHeader.tsx";
import {
  CompactSidebarButton,
  CompactSidebarPill,
} from "../../../../apps/web/src/components/sidebar/CompactSidebarPill.tsx";
import {
  SIDEBAR_BOT_FACE_SLOT,
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../../../../apps/web/src/sidebarMetrics/sidebarMetrics.ts";
import {
  SIDEBAR_LIST_ROW,
  SIDEBAR_LIST_ROW_ACTIVE,
  SIDEBAR_LIST_ROW_REST,
  SidebarListRowEnd,
  sidebarListRowActionClassName,
  sidebarListRowExtraActionClassName,
  sidebarListRowTitleClassName,
} from "../../../../apps/web/src/sidebarThreadRow/sidebarListRow.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { errorToastDescription } from "../../../../apps/web/src/components/errors/ErrorDetails.tsx";
import { useEnvironmentScope } from "../../../../apps/web/src/state/session.ts";
import { threadEnvironment } from "../../../../apps/web/src/state/threads.ts";
import { useOrchestrationCommand } from "../../../../apps/web/src/state/use-orchestration-command.ts";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import { claimSidebarThreads } from "../../../../apps/web/src/product/sidebarThreadClaims.ts";
import { useTimelineMinimapByDay } from "../../../../apps/web/src/timelineMinimapDays/timelineMinimapDays.ts";
import { useCompactComposerChat } from "../../../../apps/web/src/composerFooter/compactComposer.ts";
import {
  SidebarCompactTooltip,
  useSidebarCompact,
} from "../../../../apps/web/src/adaptiveSidebar/adaptiveSidebar.tsx";
import {
  readTasksWebAccess,
  useTasksWebAccess,
  useTasksWebAccessRevision,
} from "../environmentApi.ts";
import { useSidebarComputerScope } from "../../../../apps/web/src/sidebarComputers/sidebarComputerSelection.ts";
import { filterIdsToComputerScope } from "../../../../apps/web/src/sidebarComputers/sidebarComputers.logic.ts";
import { useComputerName } from "../../../../apps/web/src/sidebarComputers/useSidebarComputers.ts";
import {
  TaskThreadRunCounts,
  TaskThreadRunPill,
  TaskThreadTasksButton,
  TaskThreadTasksSubmenu,
} from "../ui/TaskThreadRunCounts.tsx";
import { botRowMenuEntries } from "./botMenu.ts";
import { botsInProjectScope } from "./botProjectScope.ts";
import {
  BotAvatar,
  botPage,
  errorReason,
  readBotsUnsupported,
  readShownBots,
  useBots,
  useBotSectionLists,
  useBotStatus,
  type BotSectionList,
} from "./botData.tsx";

/**
 * The bot lists the one Bots section merges: this computer first, then each connected one, as
 * far as the sidebar's Computers section shows them.
 */
function useBotLists() {
  const connected = useConnectedEnvironmentIds();
  const primary = usePrimaryEnvironmentId();
  const computerScope = useSidebarComputerScope();
  return useBotSectionLists(
    filterIdsToComputerScope(
      [...new Set([...(primary ? [primary] : []), ...connected])],
      computerScope,
    ),
  );
}

/** Each computer's bots the sidebar's Projects filter leaves, merged in the lists' order. */
function useShownBots(lists: ReadonlyArray<BotSectionList>) {
  const scope = useSidebarProjectScope();
  return lists.flatMap(({ environmentId, bots }) =>
    botsInProjectScope(environmentId, bots, scope).map((bot) => ({ environmentId, bot })),
  );
}

/** Whether a bot is the one on screen: its page or its chat. */
function useIsBotActive() {
  const params = useParams({ strict: false });
  const pageBot = useLocation({
    select: (location) => {
      if (location.pathname !== "/bots") return null;
      const search = location.search as Record<string, unknown>;
      return typeof search.environment === "string" && typeof search.bot === "string"
        ? `${search.environment}\t${search.bot}`
        : null;
    },
  });
  return (environmentId: EnvironmentId, bot: Bot) =>
    pageBot === `${environmentId}\t${bot.agent.id}` ||
    (params.threadId === bot.threadId && params.environmentId === environmentId);
}

function openBotChat(
  navigate: ReturnType<typeof useNavigate>,
  environmentId: EnvironmentId,
  bot: Bot,
) {
  void navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: bot.threadId },
  });
}

export function SidebarBots() {
  const lists = useBotLists();
  const computerScope = useSidebarComputerScope();
  const selected = computerScope === null ? null : ([...computerScope][0] ?? null);
  if (selected !== null && !lists.some((list) => list.environmentId === selected)) {
    return <UnavailableComputerBots environmentId={selected} />;
  }
  return lists.length > 0 ? <BotsSection lists={lists} /> : null;
}

/**
 * The Bots section of a picked computer that shows none: offline, its last known bots dimmed
 * (its info popover in the Computers section says why); connected but too old for bots, a note
 * saying so. Nothing while it still loads, or while offline with no bots seen yet.
 */
function UnavailableComputerBots({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const connected = useConnectedEnvironmentIds().includes(environmentId);
  const access = useTasksWebAccess(environmentId);
  useTasksWebAccessRevision();
  const name = useComputerName(environmentId) ?? "This computer";
  const unsupported =
    connected && (readBotsUnsupported(environmentId) || access.availability === "unavailable");
  if (connected && !unsupported) return null;
  const lastBots = connected ? [] : (readShownBots(environmentId) ?? []);
  if (!connected && lastBots.length === 0) return null;
  return (
    <div className={SIDEBAR_SECTION_GAP} data-computer-bots={connected ? "unsupported" : "offline"}>
      <SidebarSectionHeader title="Bots" open onToggle={() => {}} />
      <div className={`${SIDEBAR_SECTION_HEADER_GAP} ${SIDEBAR_MENU_SCOPE}`}>
        {connected ? (
          <p className="px-3 pt-1 text-xs text-sidebar-muted-foreground [[data-sidebar-compact=true]_&]:hidden">
            Bots need a newer Up.computer on {name}.
          </p>
        ) : (
          <div className="opacity-55" aria-disabled>
            <SidebarMenu>
              {lastBots.map((bot) => (
                <SidebarMenuItem key={bot.agent.id}>
                  <div className={cn(SIDEBAR_LIST_ROW, "text-sidebar-foreground")}>
                    <span className={SIDEBAR_BOT_FACE_SLOT}>
                      <BotAvatar
                        id={bot.agent.id}
                        appearance={bot.appearance}
                        state="idle"
                        size={20}
                      />
                    </span>
                    <span className={sidebarListRowTitleClassName(false)}>{bot.agent.name}</span>
                  </div>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </div>
        )}
      </div>
    </div>
  );
}

/** Every shown computer's bots as avatars in one pill, like the one Bots section. */
export function CompactSidebarBots() {
  const lists = useBotLists();
  const shown = useShownBots(lists);
  const scope = useSidebarProjectScope();
  // New bots go to the first computer shown: this one in All computers.
  const createOn = lists[0]?.environmentId ?? null;
  const canWrite = useExperimentalFeatureRpcPermission(createOn, BOTS_RPC_METHODS.save);
  const navigate = useNavigate();
  const isActive = useIsBotActive();
  if (createOn === null || (scope !== null && shown.length === 0)) return null;
  return (
    <CompactSidebarPill label="Bots">
      {shown.map(({ environmentId, bot }) => (
        <CompactBotButton
          key={`${environmentId}:${bot.agent.id}`}
          environmentId={environmentId}
          bot={bot}
          active={isActive(environmentId, bot)}
          onOpen={() => openBotChat(navigate, environmentId, bot)}
        />
      ))}
      {lists.every((list) => list.bots.length === 0) ? (
        <CompactSidebarButton
          label="Create your first bot"
          disabled={!canWrite}
          onClick={() => void navigate(botPage(createOn))}
        >
          <PlusIcon />
        </CompactSidebarButton>
      ) : null}
    </CompactSidebarPill>
  );
}

function CompactBotButton({
  environmentId,
  bot,
  active,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  const status = useBotStatus(environmentId, bot);
  return (
    <CompactSidebarButton
      label={bot.agent.name}
      tooltip={status.detail ? `${bot.agent.name}: ${status.detail}` : bot.agent.name}
      isActive={active}
      onClick={onOpen}
    >
      <span className="flex size-6 items-center justify-center">
        <BotAvatar id={bot.agent.id} appearance={bot.appearance} state={status.state} size={24} />
      </span>
    </CompactSidebarButton>
  );
}

/** One Bots section for every computer the sidebar shows, its bots merged like Threads. */
function BotsSection({ lists }: { readonly lists: ReadonlyArray<BotSectionList> }) {
  const shown = useShownBots(lists);
  const scope = useSidebarProjectScope();
  // New bots go to the first computer shown: this one in All computers.
  const createOn = lists[0]!.environmentId;
  const canWrite = useExperimentalFeatureRpcPermission(createOn, BOTS_RPC_METHODS.save);
  const navigate = useNavigate();
  const isActive = useIsBotActive();
  const [open, setOpen] = useLocalStorage("upcomputer:bots-open", true, Schema.Boolean);
  // Each bot's chat belongs here, so Threads leaves it out, even while the
  // Projects filter hides its bot; a removed bot's chat returns there with the next list.
  const chatKeys = lists
    .flatMap(({ environmentId, bots }) =>
      bots.map((bot) => scopedThreadKey(scopeThreadRef(environmentId, bot.threadId))),
    )
    .join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the claims registry entry while mounted
  useEffect(() => claimSidebarThreads("bots", chatKeys ? chatKeys.split("\n") : []), [chatKeys]);
  const errors = lists.filter((list) => list.error !== "");
  // A filter no bot matches hides the section; a bot chat it hides stays open.
  if (scope !== null && shown.length === 0 && errors.length === 0) return null;
  const create = () => {
    if (canWrite) void navigate(botPage(createOn));
  };
  return (
    <Collapsible open={open}>
      <div className={SIDEBAR_SECTION_GAP}>
        <SidebarSectionHeader
          title="Bots"
          open={open}
          onToggle={() => setOpen(!open)}
          action={
            <SidebarSectionHeaderAction label="Create bot" track="bots.create" onClick={create}>
              <PlusIcon />
            </SidebarSectionHeaderAction>
          }
        />
      </div>
      {/* Each bot's run pill rises above its compact target, over the panel's top edge. */}
      <CollapsiblePanel className="[[data-sidebar-compact=true]_&]:overflow-visible">
        <div className={`${SIDEBAR_SECTION_HEADER_GAP} ${SIDEBAR_MENU_SCOPE}`}>
          <SidebarMenu>
            {shown.map(({ environmentId, bot }) => (
              <SidebarMenuItem key={`${environmentId}:${bot.agent.id}`}>
                <BotRow
                  environmentId={environmentId}
                  bot={bot}
                  active={isActive(environmentId, bot)}
                  onOpen={() => openBotChat(navigate, environmentId, bot)}
                  onSettings={() => {
                    void navigate(botPage(environmentId, { bot: bot.agent.id }));
                  }}
                />
              </SidebarMenuItem>
            ))}
            {lists.every((list) => list.bots.length === 0) ? (
              <SidebarEmptyRow
                label="Create your first bot"
                disabled={!canWrite}
                onClick={create}
              />
            ) : null}
          </SidebarMenu>
          {errors.map((list) => (
            <BotListError
              key={list.environmentId}
              environmentId={list.environmentId}
              error={list.error}
              named={lists.length > 1}
            />
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** A computer's failed bot list; with several computers merged, it names the computer. */
function BotListError({
  environmentId,
  error,
  named,
}: {
  readonly environmentId: EnvironmentId;
  readonly error: string;
  readonly named: boolean;
}) {
  const name = useComputerName(environmentId);
  return (
    <p role="alert" className="px-3 text-xs text-destructive">
      {named && name ? `${name}: ${error}` : error}
    </p>
  );
}

/**
 * A bot's sidebar row from the compact thread row's parts: face (its state, which the name's
 * tooltip says), name, run counts, and settings where a thread row has "…". A chat with tasks
 * but no counts offers its tasks menu from an icon next to settings. Double-click renames it.
 * A right-click offers settings and tasks, which the compact sidebar shows no button for.
 */
export function BotRow({
  environmentId,
  bot,
  active,
  onOpen,
  onSettings,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
  readonly active: boolean;
  readonly onOpen: () => void;
  readonly onSettings: () => void;
}) {
  const status = useBotStatus(environmentId, bot);
  const compact = useSidebarCompact();
  const canRename = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope) && !compact;
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [tasksMenuOpen, setTasksMenuOpen] = useState(false);
  useTasksWebAccessRevision();
  const menuEntries = botRowMenuEntries(readTasksWebAccess(environmentId).canReadTasks);
  const renameDone = useRef(false);
  const commitRename = (title: string) => {
    renameDone.current = true;
    setRenaming(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toastManager.add({ type: "warning", title: "Bot name cannot be empty" });
      return;
    }
    if (trimmed === bot.agent.name) return;
    void updateThreadMetadata({
      environmentId,
      input: { threadId: bot.threadId, title: trimmed },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Couldn't save the bot",
          description: errorToastDescription(
            error,
            undefined,
            `Couldn't save ${bot.agent.name}'s settings: ${errorReason(error)}. Try again.`,
          ),
          actionProps: { children: "Retry", onClick: () => commitRename(trimmed) },
        });
      }
    });
  };
  const isRowEvent = (event: ReactMouseEvent | ReactKeyboardEvent) =>
    (event.target as Element).closest("button, input") === null;
  const nameClassName = sidebarListRowTitleClassName(active);
  return (
    <>
      <SidebarRowContextMenu disabled={renaming !== null}>
        <SidebarCompactTooltip
          label={status.detail ? `${bot.agent.name}: ${status.detail}` : bot.agent.name}
        >
          <SidebarRowContextMenuTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                aria-current={active ? "page" : undefined}
                data-sidebar-list-row=""
                className={cn(
                  SIDEBAR_LIST_ROW,
                  active ? SIDEBAR_LIST_ROW_ACTIVE : SIDEBAR_LIST_ROW_REST,
                )}
                onClick={(event) => {
                  if (isRowEvent(event)) onOpen();
                }}
                onDoubleClick={(event) => {
                  if (!canRename || renaming !== null || !isRowEvent(event)) return;
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  renameDone.current = false;
                  setRenaming(bot.agent.name);
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpen();
                }}
              >
                {/* Switching styles moves nothing: the slot keeps the icon size. */}
                <span className={SIDEBAR_BOT_FACE_SLOT}>
                  <BotAvatar
                    id={bot.agent.id}
                    appearance={bot.appearance}
                    state={status.state}
                    size={20}
                  />
                </span>
                {renaming !== null ? (
                  <input
                    autoFocus
                    value={renaming}
                    aria-label="Bot name"
                    onChange={(event) => setRenaming(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename(renaming);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        renameDone.current = true;
                        setRenaming(null);
                      }
                    }}
                    onBlur={() => {
                      if (!renameDone.current) commitRename(renaming);
                    }}
                    className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm text-card-foreground outline-none focus:border-foreground"
                  />
                ) : status.detail ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className={nameClassName} />}>
                      {bot.agent.name}
                    </TooltipTrigger>
                    <TooltipPopup side="top">{status.detail}</TooltipPopup>
                  </Tooltip>
                ) : (
                  <span className={nameClassName}>{bot.agent.name}</span>
                )}
                <SidebarListRowEnd
                  pinned={tasksMenuOpen}
                  action={
                    <button
                      type="button"
                      aria-label={`Settings for ${bot.agent.name}`}
                      className={sidebarListRowActionClassName(tasksMenuOpen)}
                      onClick={onSettings}
                    >
                      <SettingsIcon />
                    </button>
                  }
                >
                  <TaskThreadRunCounts
                    environmentId={environmentId}
                    threadId={bot.threadId}
                    fallback={
                      bot.chatHasTasks ? (
                        <TaskThreadTasksButton
                          environmentId={environmentId}
                          threadId={bot.threadId}
                          label={`Tasks for ${bot.agent.name}`}
                          className={sidebarListRowExtraActionClassName(tasksMenuOpen)}
                          onOpenChange={setTasksMenuOpen}
                        />
                      ) : null
                    }
                  />
                </SidebarListRowEnd>
              </div>
            }
          />
        </SidebarCompactTooltip>
        {/* A sibling of the row: clicks in the portaled menu do not bubble to the row. */}
        <MenuPopup align="start" sideOffset={2}>
          {menuEntries.map((entry) =>
            entry === "settings" ? (
              <MenuItem key={entry} onClick={onSettings}>
                <SettingsIcon />
                Settings
              </MenuItem>
            ) : (
              <TaskThreadTasksSubmenu
                key={entry}
                environmentId={environmentId}
                threadId={bot.threadId}
              />
            ),
          )}
        </MenuPopup>
      </SidebarRowContextMenu>
      <TaskThreadRunPill
        environmentId={environmentId}
        threadId={bot.threadId}
        name={bot.agent.name}
      />
    </>
  );
}

/**
 * The chat header accessory. A bot chat has no header: the marker hides the
 * header's content (`ChatHeader`), and the bar floats over the chat with only
 * the window controls (`ChatView`). Its composer rests as the compact row. Other chats are left as they are; the
 * thread's action menu offers turning one into a bot.
 */
export function BotHeader({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { bots, loaded, enabled } = useBots(environmentId);
  const isBotChat = enabled && loaded && bots.some((bot) => bot.threadId === threadId);
  const chatKey = isBotChat ? scopedThreadKey(scopeThreadRef(environmentId, threadId)) : null;
  // A bot chat runs for days: its minimap shows one tick per day.
  useTimelineMinimapByDay(chatKey);
  useCompactComposerChat(chatKey);
  if (!isBotChat) return null;
  return <span hidden data-chat-header-hidden />;
}
