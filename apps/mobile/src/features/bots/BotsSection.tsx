import { useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { useGT, useMessages } from "gt-react-native";
import { use } from "react";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useThreadShells } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import {
  selectedThreadRowColors,
  THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE,
  THREAD_LIST_V2_SIDEBAR_ROW_STYLE,
} from "../threads/thread-list-v2-row-appearance";
import { botLists, useBotSections } from "./botsData";
import { BOT_STATUS_DETAILS, BOT_STATUS_TONES, botColor, botInitial } from "./botPresentation";
import { botStatusOf, shownBots } from "./botState";

/**
 * The Bots section at the top of Chats, as on the desktop's sidebar: the bots of the computers
 * Chats shows, each opening its chat.
 */
export function BotsSection(props: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef> | null;
  readonly query: string;
  readonly sidebar: boolean;
}) {
  const gt = useGT();
  const sections = useBotSections(props.environmentIds);
  const bots = shownBots(sections, { projectRefs: props.projectRefs, query: props.query });
  const { environments } = useWorkspaceState();
  const label = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)
      ?.environmentLabel ?? null;
  const loading = bots.length === 0 && sections.some((section) => section.state === "loading");
  const failed = sections.filter((section) => section.state === "failed");
  const shells = useThreadShells();
  const shellByKey = new Map(
    shells.map((shell) => [scopedThreadKey(shell.environmentId, shell.id), shell]),
  );
  const selectedThreadKey = use(NativePrimaryColumnContext)?.selectedThreadKey ?? null;
  const searching = props.query.trim() !== "";
  if (bots.length === 0 && (searching || (!loading && failed.length === 0))) return null;
  const several = sections.length > 1;

  return (
    <View className="mb-1">
      <View
        className={cn("mb-1.5 mt-3 flex-row items-center gap-2.5", props.sidebar ? "px-3" : "px-5")}
      >
        <Text
          className={cn(
            "text-xs font-t3-medium",
            props.sidebar ? "text-drawer-foreground-muted" : "text-foreground-tertiary",
          )}
        >
          {gt("Bots", { $context: "list section with the computer's bots" })}
        </Text>
        <View className={cn("h-px flex-1", props.sidebar ? "bg-drawer-border" : "bg-border")} />
      </View>
      {bots.map(({ environmentId, bot }) => (
        <BotRow
          key={`${environmentId}:${bot.agent.id}`}
          environmentId={environmentId}
          bot={bot}
          computer={several ? label(environmentId) : null}
          shell={(threadId) => shellByKey.get(scopedThreadKey(environmentId, threadId)) ?? null}
          selected={selectedThreadKey === scopedThreadKey(environmentId, bot.threadId)}
          sidebar={props.sidebar}
        />
      ))}
      {loading ? (
        <View className={cn("flex-row items-center gap-2 py-2", props.sidebar ? "px-3" : "px-5")}>
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
          <Text className="text-sm text-foreground-muted">{gt("Loading bots…")}</Text>
        </View>
      ) : null}
      {failed.map((section) => (
        <Pressable
          key={section.environmentId}
          accessibilityRole="button"
          accessibilityHint={gt("Loads the bots again")}
          onPress={botLists.refreshShown}
          className={cn("gap-0.5 py-2 active:opacity-60", props.sidebar ? "px-3" : "px-5")}
        >
          <Text className="text-sm text-foreground">
            {gt("Bots didn't load on {computer}", {
              computer: label(section.environmentId) ?? gt("this computer"),
            })}
          </Text>
          <Text className="text-xs text-foreground-muted">{gt("Tap to try again.")}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function BotRow(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
  readonly computer: string | null;
  readonly shell: (threadId: ThreadId) => EnvironmentThreadShell | null;
  readonly selected: boolean;
  readonly sidebar: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const { bot } = props;
  const status = botStatusOf(bot, props.shell);
  const tone = status === null ? null : BOT_STATUS_TONES[status.kind];
  const statusText =
    tone === null
      ? gt("Idle", { $context: "bot status, nothing running" })
      : status?.detail
        ? messages(BOT_STATUS_DETAILS[status.detail])
        : messages(tone.label);
  const foreground = props.selected
    ? selectedThreadRowColors.foregroundClassName
    : props.sidebar
      ? "text-drawer-foreground"
      : "text-foreground";
  const muted = props.selected
    ? selectedThreadRowColors.mutedForegroundClassName
    : props.sidebar
      ? "text-drawer-foreground-muted"
      : "text-foreground-muted";
  const openChat = () =>
    selectDetail({
      name: "Thread",
      params: { environmentId: String(props.environmentId), threadId: String(bot.threadId) },
    });
  const openMemory = () =>
    navigation.navigate("BotMemory", {
      environmentId: String(props.environmentId),
      agentId: String(bot.agent.id),
      name: bot.agent.name,
    });

  return (
    <Menu
      shouldOpenOnLongPress
      title={bot.agent.name}
      actions={[
        { id: "chat", title: gt("Open chat"), image: "text.bubble" },
        { id: "memory", title: gt("Memory", { $context: "a bot's saved memory" }), image: "brain" },
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "chat") openChat();
        if (nativeEvent.event === "memory") openMemory();
      }}
    >
      <View style={props.sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: props.selected }}
          accessibilityLabel={[bot.agent.name, statusText, props.computer]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint={gt("Opens the bot's chat")}
          onPress={openChat}
          style={props.sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_STYLE : undefined}
          className={cn(
            "flex-row items-center gap-3",
            !props.sidebar && "px-5 py-2 active:bg-row-hover",
            props.sidebar && !props.selected && "bg-drawer active:bg-thread-hover",
            props.selected && "bg-thread-selected",
          )}
        >
          <View
            className="h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: botColor(bot) }}
          >
            <Text className="text-base font-t3-bold text-white">{botInitial(bot)}</Text>
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text
              className={cn("text-base leading-5 font-t3-medium", foreground)}
              numberOfLines={1}
            >
              {bot.agent.name}
            </Text>
            <View className="flex-row items-center gap-1">
              {tone ? (
                <SymbolView name={tone.icon} size={11} tintColorClassName={tone.tint} />
              ) : null}
              <Text
                className={cn(
                  "min-w-0 shrink text-xs",
                  tone && !props.selected ? tone.text : muted,
                )}
                numberOfLines={1}
              >
                {statusText}
              </Text>
              {props.computer ? (
                <Text className={cn("shrink-0 text-xs", muted)} numberOfLines={1}>
                  {`· ${props.computer}`}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      </View>
    </Menu>
  );
}
