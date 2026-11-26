import { useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { useGT, useMessages } from "gt-react-native";
import { use } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useThreadShells } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { SidebarGroupHeader } from "../home/sidebar/SidebarGroupHeader";
import { toggleSidebarGroup, useSidebarGroupsOpen } from "../home/sidebar/sidebarGroupsOpen";
import { ThreadSwipeable } from "../home/thread-swipe-actions";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { useSelectWorkspaceTab } from "../layout/workspace/useSelectWorkspaceTab";
import { BotCharacter } from "./character/BotCharacter";
import { botLists, useBotSections } from "./botsData";
import { BOT_STATUS_DETAILS, BOT_STATUS_TONES } from "./botPresentation";
import { botStatusOf, shownBots } from "./botState";

/**
 * The desktop sidebar's Bots group in the Chats list: its header with New bot, and the bots of
 * the computers Chats shows, one line each, each opening its chat.
 */
export function BotsSection(props: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef> | null;
  readonly query: string;
}) {
  const gt = useGT();
  const open = useSidebarGroupsOpen().bots;
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
  if (sections.length === 0 || (searching && bots.length === 0)) return null;
  const several = sections.length > 1;

  return (
    <View>
      <SidebarGroupHeader
        title={gt("Bots", { $context: "list section with the computer's bots" })}
        open={open}
        onToggle={() => toggleSidebarGroup("bots")}
        action={{
          icon: "plus",
          label: gt("New bot"),
          // The phone's New bot sheet comes in a later part; until then bots start on the desktop.
          onPress: () => Dialog.alert(gt("New bot"), gt("Create bots in the desktop app for now.")),
        }}
      />
      {open ? (
        <>
          {bots.map(({ environmentId, bot }) => (
            <BotRow
              key={`${environmentId}:${bot.agent.id}`}
              environmentId={environmentId}
              bot={bot}
              computer={several ? label(environmentId) : null}
              shell={(threadId) => shellByKey.get(scopedThreadKey(environmentId, threadId)) ?? null}
              selected={selectedThreadKey === scopedThreadKey(environmentId, bot.threadId)}
            />
          ))}
          {loading ? (
            <View className="flex-row items-center gap-2 px-5 py-2">
              <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
              <Text className="text-sm text-foreground-muted">{gt("Loading bots…")}</Text>
            </View>
          ) : null}
          {!loading && bots.length === 0 && failed.length === 0 ? (
            <Text className="px-5 py-2 text-sm text-foreground-muted">
              {props.projectRefs ? gt("No bots in this project") : gt("No bots yet")}
            </Text>
          ) : null}
          {failed.map((section) => (
            <Pressable
              key={section.environmentId}
              accessibilityRole="button"
              accessibilityHint={gt("Loads the bots again")}
              onPress={botLists.refreshShown}
              className="gap-0.5 px-5 py-2 active:opacity-60"
            >
              <Text className="text-sm text-foreground">
                {gt("Bots didn't load on {computer}", {
                  computer: label(section.environmentId) ?? gt("this computer"),
                })}
              </Text>
              <Text className="text-xs text-foreground-muted">{gt("Tap to try again.")}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </View>
  );
}

function BotRow(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
  readonly computer: string | null;
  readonly shell: (threadId: ThreadId) => EnvironmentThreadShell | null;
  readonly selected: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const selectTab = useSelectWorkspaceTab();
  const { width } = useWindowDimensions();
  const { colors } = useControlTheme();
  const { bot } = props;
  const status = botStatusOf(bot, props.shell);
  const tone = status === null ? null : BOT_STATUS_TONES[status.kind];
  const statusText =
    tone === null
      ? gt("Idle", { $context: "bot status, nothing running" })
      : status?.detail
        ? messages(BOT_STATUS_DETAILS[status.detail])
        : messages(tone.label);
  const openChat = () =>
    selectDetail({
      name: "Thread",
      params: { environmentId: String(props.environmentId), threadId: String(bot.threadId) },
    });
  const openTasks = () => selectTab("tasks");
  // The phone has no bot settings page yet; its memory is what it can show of them.
  const openSettings = () =>
    navigation.navigate("BotMemory", {
      environmentId: String(props.environmentId),
      agentId: String(bot.agent.id),
      name: bot.agent.name,
    });

  return (
    <ThreadSwipeable
      dormant={false}
      threadKey={`bot:${props.environmentId}:${bot.agent.id}`}
      backgroundColor={colors["--color-screen"]}
      compactActions
      fullSwipeAction="primary"
      fullSwipeWidth={width - 32}
      onDelete={() => undefined}
      primaryAction={{
        accessibilityLabel: gt("Tasks for {name}", { name: bot.agent.name }),
        icon: "checkmark.circle",
        label: gt("Tasks"),
        onPress: openTasks,
      }}
      secondaryAction={{
        accessibilityLabel: gt("Settings for {name}", { name: bot.agent.name }),
        icon: "gearshape",
        label: gt("Settings"),
        onPress: openSettings,
      }}
      threadTitle={bot.agent.name}
    >
      {(close) => (
        <Menu
          shouldOpenOnLongPress
          title={bot.agent.name}
          actions={[
            { id: "tasks", title: gt("Tasks"), image: "checkmark.circle" },
            { id: "settings", title: gt("Settings"), image: "gearshape" },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "tasks") openTasks();
            if (nativeEvent.event === "settings") openSettings();
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: props.selected }}
            accessibilityLabel={[bot.agent.name, statusText, props.computer]
              .filter(Boolean)
              .join(", ")}
            accessibilityHint={gt("Opens the bot's chat")}
            onPress={() => {
              close();
              openChat();
            }}
            className={cn(
              "min-h-[48px] flex-row items-center gap-3 px-5 py-2",
              props.selected ? "bg-thread-selected" : "bg-screen active:bg-row-hover",
            )}
          >
            <View className="w-[22px] items-center justify-center">
              <BotCharacter id={bot.agent.id} appearance={bot.appearance} size={24} />
            </View>
            <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
              {bot.agent.name}
            </Text>
            {props.computer ? (
              <Text className="shrink-0 text-sm text-foreground-tertiary" numberOfLines={1}>
                {props.computer}
              </Text>
            ) : null}
            {tone ? <SymbolView name={tone.icon} size={14} tintColorClassName={tone.tint} /> : null}
          </Pressable>
        </Menu>
      )}
    </ThreadSwipeable>
  );
}
