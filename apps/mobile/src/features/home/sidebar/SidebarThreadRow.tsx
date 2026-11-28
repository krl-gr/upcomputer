import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { resolveThreadProjectIconStack } from "@t3tools/client-runtime/thread-project-icons";
import { threadChipCopyTarget } from "@t3tools/client-runtime/thread-reference";
import { AuthOrchestrationOperateScope, type ProjectId } from "@t3tools/contracts";
import type { SnoozePresetSetting } from "@t3tools/contracts/settings";
import { useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { memo, useState, type ComponentProps } from "react";
import { useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import * as Dialog from "../../../components/ui/Dialog";
import { AppText as Text } from "../../../components/ui/AppText";
import { Menu } from "../../../components/ui/Menu";
import { RowPressable } from "../../../components/ui/RowPressable";
import { cn } from "../../../lib/cn";
import { scopedProjectKey } from "../../../lib/scopedEntities";
import { copyTextWithHaptic } from "../../../lib/copyTextWithHaptic";
import { copyThreadReference } from "../../../lib/copyThreadReference";
import { useControlTheme } from "../../../components/ui/useControlTheme";
import { useEnvironmentScope } from "../../../state/session";
import { threadEnvironment } from "../../../state/threads";
import { useAtomCommand } from "../../../state/use-atom-command";
import { openSettings } from "../../settings/settings-navigation";
import { CustomSnoozeSheet } from "../../threads/CustomSnoozeSheet";
import { selectedThreadRowColors } from "../../threads/thread-list-v2-row-appearance";
import {
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2SnoozePresets,
} from "../../threads/threadListV2";
import {
  canTurnThreadIntoProject,
  turnThreadIntoProject,
} from "../../threads/turnThreadIntoProject";
import { useCanShareWithGuest } from "../../threads/useCanShareWithGuest";
import { ProjectFavicon } from "../../../components/ProjectFavicon";
import { ThreadRunCountNumbers, useThreadRunCounts } from "../../tasks/ThreadRunCounts";
import { useSwipeRowDormant } from "../swipe-row-activation";
import { ThreadSwipeable } from "../thread-swipe-actions";
import { threadCanArchive } from "../threadArchive";
import { NoProjectIcon } from "./NoProjectIcon";
import { sidebarThreadMenuActions } from "./sidebarThreadMenu";
import { sidebarThreadStatusWord } from "./sidebarThreadStatus";

export interface SidebarThreadRowActions {
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
  readonly onArchive: (thread: EnvironmentThreadShell) => void;
  readonly onDelete: (thread: EnvironmentThreadShell) => void;
  readonly onRename: (thread: EnvironmentThreadShell) => void;
  readonly onRegenerateTitle: (thread: EnvironmentThreadShell) => void;
  readonly onPin: (thread: EnvironmentThreadShell) => void;
  readonly onUnpin: (thread: EnvironmentThreadShell) => void;
  readonly onSnooze: (thread: EnvironmentThreadShell, snoozedUntil: string) => void;
  readonly onUnsnooze: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  /** Picks the thread's project in the Projects group, or null for All projects. */
  readonly onFilterProject: (thread: EnvironmentThreadShell | null) => void;
}

const PROJECT_ICON_SIZE = 22;

/**
 * A thread as one line of the desktop sidebar: its project icons, the status word, the title,
 * and its run counts or the time. Swiping shows Archive and Delete; a long press opens the
 * desktop's thread menu.
 */
export const SidebarThreadRow = memo(function SidebarThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly project: EnvironmentProject | null;
  /** Resolves the desktop's leading icons: the thread's own project, then those it links. */
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly scratchWorkspaceRoot: string | undefined;
  readonly timeLabel: string;
  readonly snoozed: boolean;
  readonly snoozeWakeLabel: string | undefined;
  readonly snoozePresetMinute: string;
  readonly snoozePresets: ReadonlyArray<SnoozePresetSetting> | undefined;
  readonly snoozeSupported: boolean;
  readonly pinningSupported: boolean;
  readonly titleRegenerationSupported: boolean;
  readonly turnIntoBotOffered: boolean;
  /** The list shows one project, so rows leave out its icons and the menu offers All projects. */
  readonly projectFiltered: boolean;
  readonly selected: boolean;
  readonly fullSwipeWidth: number | undefined;
  readonly actions: SidebarThreadRowActions;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly simultaneousSwipeGesture?: ComponentProps<typeof ThreadSwipeable>["simultaneousWith"];
  readonly activationKey: string;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const { width: windowWidth } = useWindowDimensions();
  const { colors } = useControlTheme();
  const { thread, actions } = props;
  const runCounts = useThreadRunCounts(thread.environmentId, thread.id);
  const dormant = useSwipeRowDormant(props.activationKey);
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const canShareWithGuest = useCanShareWithGuest(thread.environmentId);
  const markUnread = useAtomCommand(threadEnvironment.markUnread, { reportFailure: false });
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  const status = sidebarThreadStatusWord(thread);
  // Resolved here, not by the list, so the memo above still skips rows whose inputs are unchanged.
  const projectIcons = props.projectFiltered
    ? null
    : resolveThreadProjectIconStack({
        thread,
        ownProject: props.project,
        projectById: (projectId) =>
          props.projectByKey.get(scopedProjectKey(thread.environmentId, projectId as ProjectId)),
        isScratchProject: (candidate) => isScratchProject(candidate, props.scratchWorkspaceRoot),
      });
  const statusLabel = status ? m(status.label) : null;
  const timeLabel =
    props.snoozed && props.snoozeWakeLabel ? m(props.snoozeWakeLabel) : m(props.timeLabel);

  // The list puts its minute on a row only while the thread can snooze.
  const now = props.snoozePresetMinute;
  const snoozePresets = resolveThreadListV2SnoozePresets(
    {
      secondary: props.snoozeSupported && now !== "" ? "snooze" : null,
      now,
      presets: props.snoozePresets,
    },
    m,
  );
  const workspacePath = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const menuActions = sidebarThreadMenuActions(
    {
      branch: thread.branch,
      pinned: props.pinningSupported ? thread.pinnedAt != null : null,
      snooze: props.snoozed
        ? "wake"
        : snoozePresets.length > 0
          ? [
              ...snoozePresets.map((preset) => ({
                id: `snooze:${preset.id}`,
                title: preset.label,
                subtitle: preset.whenLabel,
              })),
              { id: "snooze:custom", title: gt("Custom…", { $context: "custom snooze time" }) },
            ]
          : null,
      regenerateTitle: props.titleRegenerationSupported
        ? thread.titleRegeneration != null
          ? "running"
          : "available"
        : null,
      shareWithGuest: canShareWithGuest,
      filter: props.projectFiltered
        ? "all"
        : props.project && !props.project.isScratch
          ? { project: props.project.title }
          : null,
      turnIntoProject: canTurnThreadIntoProject(thread)
        ? { enabled: threadCanArchive(thread.runtime) }
        : null,
      turnIntoBot: props.turnIntoBotOffered,
      path: workspacePath !== null,
      archivable: threadCanArchive(thread.runtime),
    },
    m,
  );
  const handleMenu = ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
    const event = nativeEvent.event;
    if (event === "new-thread-on-branch") actions.onNewThreadOnBranch(thread);
    if (event === "pin") actions.onPin(thread);
    if (event === "unpin") actions.onUnpin(thread);
    if (event === "unsnooze") actions.onUnsnooze(thread);
    if (event === "rename") actions.onRename(thread);
    if (event === "regenerate-title") actions.onRegenerateTitle(thread);
    if (event === "mark-unread")
      void markUnread({ environmentId: thread.environmentId, input: { threadId: thread.id } });
    if (event === "share-guest")
      navigation.navigate("ThreadGuestShare", {
        environmentId: thread.environmentId,
        threadId: thread.id,
      });
    if (event === "filter-project") actions.onFilterProject(thread);
    if (event === "show-all-projects") actions.onFilterProject(null);
    if (event === "turn-into-project") void turnThreadIntoProject(thread);
    if (event === "turn-into-bot")
      navigation.navigate("BotSettings", {
        environmentId: thread.environmentId,
        threadId: thread.id,
      });
    if (event === "copy-path" && workspacePath) copyTextWithHaptic(workspacePath);
    if (event === "copy-branch" && thread.branch) copyTextWithHaptic(thread.branch);
    if (event === "copy-thread") {
      const target = threadChipCopyTarget(
        { environmentId: thread.environmentId, threadId: thread.id },
        thread.title,
        undefined,
        m,
      );
      void copyThreadReference(target).then((copied) => {
        if (!copied) Dialog.alert(target.failureTitle, gt("Try copying this thread again."));
      });
    }
    if (event === "copy-thread-id") copyTextWithHaptic(thread.id, { target: "thread-id" });
    if (event === "project-settings") openSettings(navigation, "SettingsProjectOverview");
    if (event === "archive") actions.onArchive(thread);
    if (event === "delete") actions.onDelete(thread);
    if (event === "snooze:custom") {
      setCustomSnoozeOpen(true);
      return;
    }
    const selection = resolveThreadListV2SnoozeMenuSelection({
      event,
      displayedPresets: snoozePresets,
      now: new Date(),
      presets: props.snoozePresets,
    });
    if (selection._tag === "selected") actions.onSnooze(thread, selection.preset.snoozedUntil);
    else if (selection._tag === "expired")
      Dialog.alert(
        gt("Could not snooze thread"),
        gt("That snooze time has passed. Choose another time."),
      );
  };

  const foreground = props.selected
    ? selectedThreadRowColors.foregroundClassName
    : "text-foreground";
  const muted = props.selected
    ? selectedThreadRowColors.mutedForegroundClassName
    : "text-foreground-tertiary";
  const row = (close: () => void) => (
    <RowPressable
      interactionClassName="bg-row-hover"
      interactionOpacity={props.selected ? 0 : 1}
      className={props.selected ? "bg-thread-selected" : "bg-screen"}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={[
        statusLabel,
        thread.title,
        runCounts.length > 0 && !props.snoozed
          ? gt("Runs: {counts}", {
              counts: runCounts.map((count) => `${count.label} ${count.count}`).join(", "),
            })
          : timeLabel,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={canOperate ? gt("Opens the thread. Swipe left to archive.") : undefined}
      onPress={() => {
        close();
        actions.onSelect(thread);
      }}
    >
      <View className="min-h-[48px] flex-row items-center gap-3 px-5 py-2.5">
        {projectIcons === null ? null : projectIcons.showScratchIcon ? (
          <NoProjectIcon size={PROJECT_ICON_SIZE} />
        ) : projectIcons.visibleProjects.length > 0 ? (
          <View className="flex-row items-center gap-0.5" accessibilityElementsHidden>
            {projectIcons.visibleProjects.map((project) => (
              <ProjectFavicon
                key={project.id}
                environmentId={project.environmentId}
                faviconPath={project.faviconPath}
                projectIcon={project.projectIcon}
                size={PROJECT_ICON_SIZE}
                projectTitle={project.title}
                workspaceRoot={project.workspaceRoot}
              />
            ))}
          </View>
        ) : null}
        <Text className="min-w-0 flex-1 text-base" numberOfLines={1}>
          {statusLabel ? (
            <Text className={cn("text-base", props.selected ? foreground : status?.className)}>
              {`${statusLabel}  `}
            </Text>
          ) : null}
          <Text
            className={cn(
              "text-base",
              foreground,
              thread.titleRegeneration != null && "opacity-55",
            )}
          >
            {thread.title}
          </Text>
        </Text>
        {runCounts.length > 0 && !props.snoozed ? (
          <ThreadRunCountNumbers
            counts={runCounts}
            colorClassName={props.selected ? foreground : undefined}
          />
        ) : (
          <Text className={cn("text-base tabular-nums", muted)}>{timeLabel}</Text>
        )}
      </View>
    </RowPressable>
  );

  if (!canOperate) return row(() => undefined);
  return (
    <View collapsable={false}>
      {customSnoozeOpen ? (
        <CustomSnoozeSheet
          onClose={() => setCustomSnoozeOpen(false)}
          onSnooze={(until) => actions.onSnooze(thread, until)}
        />
      ) : null}
      <ThreadSwipeable
        dormant={dormant}
        threadKey={`${thread.environmentId}:${thread.id}`}
        backgroundColor={colors["--color-screen"]}
        compactActions
        enableTrackpadSwipe
        fullSwipeAction="primary"
        fullSwipeWidth={props.fullSwipeWidth ?? windowWidth - 32}
        listAnimatesLayout
        onDelete={() => actions.onDelete(thread)}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={{
          accessibilityLabel: gt("Archive {title}", { title: thread.title }),
          icon: "up.archive",
          label: gt("Archive", { $context: "verb, thread action" }),
          onPress: () => actions.onArchive(thread),
        }}
        resetKey={`${thread.environmentId}:${thread.id}:${thread.pinnedAt}:${thread.snoozedUntil}`}
        simultaneousWith={props.simultaneousSwipeGesture}
        threadTitle={thread.title}
      >
        {(close) => (
          <Menu
            accessibilityLabel={thread.title}
            actions={menuActions}
            onPressAction={handleMenu}
            shouldOpenOnLongPress
          >
            {row(close)}
          </Menu>
        )}
      </ThreadSwipeable>
    </View>
  );
});
