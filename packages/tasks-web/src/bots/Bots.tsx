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
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../../../apps/web/src/components/ui/sidebar.tsx";
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
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../../../../apps/web/src/sidebarMetrics/sidebarMetrics.ts";
import { ThreadStatusLabel } from "../../../../apps/web/src/sidebarThreadRow/ThreadStatusLabel.tsx";
import {
  SIDEBAR_LIST_ROW,
  SIDEBAR_LIST_ROW_ACTIVE,
  SIDEBAR_LIST_ROW_REST,
  SidebarListRowEnd,
  sidebarListRowActionClassName,
  sidebarListRowTitleClassName,
} from "../../../../apps/web/src/sidebarThreadRow/sidebarListRow.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { useEnvironmentScope } from "../../../../apps/web/src/state/session.ts";
import { threadEnvironment } from "../../../../apps/web/src/state/threads.ts";
import { useOrchestrationCommand } from "../../../../apps/web/src/state/use-orchestration-command.ts";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import { claimSidebarThreads } from "../../../../apps/web/src/product/sidebarThreadClaims.ts";
import { TaskThreadRunCounts } from "../ui/TaskThreadRunCounts.tsx";
import { BotAvatar, botPage, useBots, useBotStatus } from "./botData.tsx";

function useBotEnvironmentIds() {
  const connected = useConnectedEnvironmentIds();
  const primary = usePrimaryEnvironmentId();
  return [...new Set([...(primary ? [primary] : []), ...connected])];
}

/** Whether a bot is the one on screen: its page or its chat. */
function useIsBotActive(environmentId: EnvironmentId) {
  const params = useParams({ strict: false });
  const pageBot = useLocation({
    select: (location) => {
      if (location.pathname !== "/bots") return null;
      const search = location.search as Record<string, unknown>;
      return search.environment === environmentId && typeof search.bot === "string"
        ? search.bot
        : null;
    },
  });
  return (bot: Bot) =>
    pageBot === bot.agent.id ||
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
  return useBotEnvironmentIds().map((id) => <EnvironmentBots key={id} environmentId={id} />);
}

/** Each environment's bots as avatars, one pill per environment like its sidebar section. */
export function CompactSidebarBots() {
  return useBotEnvironmentIds().map((id) => <CompactEnvironmentBots key={id} environmentId={id} />);
}

function CompactEnvironmentBots({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { bots, enabled } = useBots(environmentId);
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.save);
  const navigate = useNavigate();
  const isActive = useIsBotActive(environmentId);
  if (!enabled) return null;
  return (
    <CompactSidebarPill label="Bots">
      {bots.map((bot) => (
        <CompactBotButton
          key={bot.agent.id}
          environmentId={environmentId}
          bot={bot}
          active={isActive(bot)}
          onOpen={() => openBotChat(navigate, environmentId, bot)}
        />
      ))}
      {bots.length === 0 ? (
        <CompactSidebarButton
          label="Create your first bot"
          disabled={!canWrite}
          onClick={() => void navigate(botPage(environmentId))}
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

function EnvironmentBots({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { bots, error, enabled } = useBots(environmentId);
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.save);
  const navigate = useNavigate();
  const isActive = useIsBotActive(environmentId);
  const [open, setOpen] = useLocalStorage(
    `upcomputer:bots-open:${environmentId}`,
    true,
    Schema.Boolean,
  );
  // Each bot's chat is listed here, so Threads leaves it out; a removed bot's
  // chat returns there with the next list.
  const chatKeys = (enabled ? bots : [])
    .map((bot) => scopedThreadKey(scopeThreadRef(environmentId, bot.threadId)))
    .join("\n");
  useEffect(
    () => claimSidebarThreads(`bots:${environmentId}`, chatKeys ? chatKeys.split("\n") : []),
    [environmentId, chatKeys],
  );
  if (!enabled) return null;
  const create = () => {
    if (canWrite) void navigate(botPage(environmentId));
  };
  return (
    <Collapsible open={open}>
      <div className={SIDEBAR_SECTION_GAP}>
        <SidebarSectionHeader
          title="Bots"
          open={open}
          onToggle={() => setOpen(!open)}
          action={
            <SidebarSectionHeaderAction label="Create bot" onClick={create}>
              <PlusIcon className="size-3.5" />
            </SidebarSectionHeaderAction>
          }
        />
      </div>
      <CollapsiblePanel>
        <div className={`${SIDEBAR_SECTION_HEADER_GAP} ${SIDEBAR_MENU_SCOPE}`}>
          <SidebarMenu>
            {bots.map((bot) => (
              <SidebarMenuItem key={bot.agent.id}>
                <BotRow
                  environmentId={environmentId}
                  bot={bot}
                  active={isActive(bot)}
                  onOpen={() => openBotChat(navigate, environmentId, bot)}
                  onSettings={() => {
                    void navigate(botPage(environmentId, { bot: bot.agent.id }));
                  }}
                />
              </SidebarMenuItem>
            ))}
            {bots.length === 0 ? (
              <SidebarMenuItem>
                <SidebarMenuButton disabled={!canWrite} onClick={create}>
                  <PlusIcon />
                  <span>Create your first bot</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
          {error ? (
            <p role="alert" className="px-3 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * A bot's sidebar row, built from the compact thread row's parts so the two
 * look and behave alike: face, status, name, then the run counts of the tasks
 * its chat started, with the settings button where a thread row has its "…".
 * The row opens the bot's chat. The status shows only while the bot is not idle.
 * A double-click renames the bot's chat as on a thread row, and the server renames
 * the bot with it.
 */
function BotRow({
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
  const canRename = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [renaming, setRenaming] = useState<string | null>(null);
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
          title: "Failed to rename bot",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    });
  };
  const isRowEvent = (event: ReactMouseEvent | ReactKeyboardEvent) =>
    (event.target as Element).closest("button, input") === null;
  const nameClassName = sidebarListRowTitleClassName(active);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "page" : undefined}
      className={cn(SIDEBAR_LIST_ROW, active ? SIDEBAR_LIST_ROW_ACTIVE : SIDEBAR_LIST_ROW_REST)}
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
      {/* The face overflows the 16px icon slot, so the name lines up with the
          other rows' labels and switching styles moves nothing. */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <BotAvatar id={bot.agent.id} appearance={bot.appearance} state={status.state} size={20} />
      </span>
      <ThreadStatusLabel status={status.label} />
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
        pinned={false}
        action={
          <button
            type="button"
            aria-label={`Settings for ${bot.agent.name}`}
            className={sidebarListRowActionClassName(false)}
            onClick={onSettings}
          >
            <SettingsIcon className="size-4" />
          </button>
        }
      >
        <TaskThreadRunCounts
          environmentId={environmentId}
          threadId={bot.threadId}
          fallback={null}
        />
      </SidebarListRowEnd>
    </div>
  );
}

/**
 * The chat header accessory. A bot chat has no header: the marker hides the
 * header's content (`ChatHeader`), and the bar floats over the chat with only
 * the window controls (`ChatView`). Other chats are left as they are; the
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
  if (!enabled || !loaded || !bots.some((bot) => bot.threadId === threadId)) return null;
  return <span hidden data-chat-header-hidden />;
}
