import {
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
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
  SIDEBAR_ACTION_BUTTON,
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../../../../apps/web/src/sidebarMetrics/sidebarMetrics.ts";
import { ThreadStatusLabel } from "../../../../apps/web/src/sidebarThreadRow/ThreadStatusLabel.tsx";
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
 * A bot's sidebar row, built like a Projects row: the row opens the bot's
 * chat, and hover or keyboard focus reveals its settings button in place of
 * the status. The status shows only while the bot is not idle, in the colors
 * thread rows use. The run counts of the tasks its chat started stay, as on a
 * thread row, and open the same task list.
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
  const isRowEvent = (event: ReactMouseEvent | ReactKeyboardEvent) =>
    (event.target as Element).closest("button") === null;
  const settingsLabel = `Settings for ${bot.agent.name}`;
  return (
    <SidebarMenuButton
      isActive={active}
      render={<div role="button" tabIndex={0} className="group/sidebar-row" />}
      onClick={(event) => {
        if (isRowEvent(event)) onOpen();
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
      {status.detail ? (
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
            {bot.agent.name}
          </TooltipTrigger>
          <TooltipPopup side="top">{status.detail}</TooltipPopup>
        </Tooltip>
      ) : (
        <span className="min-w-0 flex-1 truncate">{bot.agent.name}</span>
      )}
      {/* Keyboard focus only: a click leaves the row focused, and the status must
          stay while the chat it opened is on screen. */}
      {status.label ? (
        <span className="flex group-focus-visible/sidebar-row:hidden group-has-[:focus-visible]/sidebar-row:hidden group-any-hover/sidebar-row:hidden">
          <ThreadStatusLabel status={status.label} />
        </span>
      ) : null}
      <span className="flex shrink-0 items-center text-xs">
        <TaskThreadRunCounts
          environmentId={environmentId}
          threadId={bot.threadId}
          fallback={null}
        />
      </span>
      <span className="hidden items-center group-focus-visible/sidebar-row:flex group-has-[:focus-visible]/sidebar-row:flex group-any-hover/sidebar-row:flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={settingsLabel}
                className={SIDEBAR_ACTION_BUTTON}
                onClick={onSettings}
              />
            }
          >
            <SettingsIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Bot settings</TooltipPopup>
        </Tooltip>
      </span>
    </SidebarMenuButton>
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
