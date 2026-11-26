import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { canBecomeBotChat } from "@t3tools/tasks-client/bots/bots";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react-native";
import type { ComponentProps } from "react";
import { Platform } from "react-native";

import { scopedProjectKey, scopedThreadKey } from "../../../lib/scopedEntities";
import { threadListEnvironmentsAtom } from "../../../state/presentation";
import type { WorkspaceEnvironment } from "../../../state/workspaceModel";
import { useBotSections } from "../../bots/botsData";
import type { ThreadListV2ListItem } from "../../threads/threadListV2";
import type { HomeListFilterMenuEnvironment } from "../home-list-filter-menu";
import { sortHomeProjectScopes, type HomeProjectScope } from "../homeThreadList";
import { ChatsSidebarGroups } from "./ChatsSidebarGroups";
import { SidebarGroupHeader } from "./SidebarGroupHeader";
import { SidebarThreadRow, type SidebarThreadRowActions } from "./SidebarThreadRow";
import { toggleSidebarGroup, useSidebarGroupsOpen } from "./sidebarGroupsOpen";
import { sidebarListItems, type SidebarListItem } from "./sidebarListItems";
import { useNewThreadWithoutProject } from "./useNewThreadWithoutProject";

type RowProps = ComponentProps<typeof SidebarThreadRow>;

/** What the list reads from Home's props. */
export interface ChatsSidebarHomeProps {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environments: ReadonlyArray<
    HomeListFilterMenuEnvironment & Pick<WorkspaceEnvironment, "connectionState">
  >;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onStartNewTask: () => void;
  readonly onNewThreadInProject: (project: EnvironmentProject) => void;
  readonly onArchiveThread: SidebarThreadRowActions["onArchive"];
  readonly onDeleteThread: SidebarThreadRowActions["onDelete"];
  readonly onRenameThread: SidebarThreadRowActions["onRename"];
  readonly onRegenerateThreadTitle: SidebarThreadRowActions["onRegenerateTitle"];
  readonly onPinThread: SidebarThreadRowActions["onPin"];
  readonly onUnpinThread: SidebarThreadRowActions["onUnpin"];
  readonly onSnoozeThread: SidebarThreadRowActions["onSnooze"];
  readonly onUnsnoozeThread: SidebarThreadRowActions["onUnsnooze"];
  readonly onNewThreadOnBranch: SidebarThreadRowActions["onNewThreadOnBranch"];
}

export interface ChatsSidebarListInput {
  /** The upstream thread list; iOS regroups it into the desktop sidebar's groups. */
  readonly items: ReadonlyArray<ThreadListV2ListItem>;
  readonly projectScopes: ReadonlyArray<HomeProjectScope>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly scopedProjectGroup: HomeProjectScope | null;
  /** The connected computers the list reads; their bots and bot chats. */
  readonly searchEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly selectedThreadKey: string | null;
  readonly onSelectThread: SidebarThreadRowActions["onSelect"];
  readonly swipe: Pick<
    RowProps,
    "fullSwipeWidth" | "onSwipeableClose" | "onSwipeableWillOpen" | "simultaneousSwipeGesture"
  >;
}

/**
 * The Chats list as the desktop sidebar on iOS: the rows it renders, the group headers and
 * thread rows it draws itself, and the groups above the rows. Elsewhere it hands back the
 * upstream list untouched, renders nothing and has no header.
 */
export function useChatsSidebarList(home: ChatsSidebarHomeProps, input: ChatsSidebarListInput) {
  const gt = useGT();
  const groupsOpen = useSidebarGroupsOpen();
  const newThreadWithoutProject = useNewThreadWithoutProject(
    home.selectedEnvironmentId,
    home.onStartNewTask,
  );
  const environmentsState = useAtomValue(threadListEnvironmentsAtom);
  const botSections = useBotSections(input.searchEnvironmentIds);
  const botsByEnvironment = new Map<EnvironmentId, ReadonlyArray<Bot>>(
    botSections.flatMap((section) =>
      section.state === "ready" ? [[section.environmentId, section.bots] as const] : [],
    ),
  );
  if (Platform.OS !== "ios")
    return { listData: input.items, renderItem: () => null, header: null } as const;

  const listData: ReadonlyArray<SidebarListItem> = sidebarListItems(input.items, groupsOpen);
  const pickableProjects = pickableProjectGroups(
    sortHomeProjectScopes({
      scopes: input.projectScopes,
      threads: home.threads,
      pendingTasks: [],
      projectSortOrder: "updated_at",
    }),
  );
  const projectOf = (environmentId: EnvironmentId, projectId: ProjectId) =>
    input.projectByKey.get(scopedProjectKey(environmentId, projectId)) ?? null;
  const actions: SidebarThreadRowActions = {
    onSelect: input.onSelectThread,
    onArchive: home.onArchiveThread,
    onDelete: home.onDeleteThread,
    onRename: home.onRenameThread,
    onRegenerateTitle: home.onRegenerateThreadTitle,
    onPin: home.onPinThread,
    onUnpin: home.onUnpinThread,
    onSnooze: home.onSnoozeThread,
    onUnsnooze: home.onUnsnoozeThread,
    onNewThreadOnBranch: home.onNewThreadOnBranch,
    onFilterProject: (thread) =>
      home.onProjectChange(
        thread === null
          ? null
          : (pickableProjects.find((scope) =>
              scope.projectRefs.some(
                (ref) =>
                  ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
              ),
            )?.key ?? null),
      ),
  };

  const renderItem = (item: SidebarListItem) => {
    if (item.type === "sidebar-group")
      return (
        <SidebarGroupHeader
          title={item.group === "pinned" ? gt("Pinned") : gt("Threads")}
          open={item.open}
          onToggle={() => toggleSidebarGroup(item.group)}
          action={
            item.group === "threads"
              ? {
                  icon: "square.and.pencil",
                  label: gt("New thread"),
                  onPress: () => void newThreadWithoutProject(),
                }
              : undefined
          }
        />
      );
    if (item.type !== "v2-thread") return null;
    const thread = item.item.thread;
    const bots = botsByEnvironment.get(thread.environmentId);
    return (
      <SidebarThreadRow
        thread={thread}
        project={projectOf(thread.environmentId, thread.projectId)}
        timeLabel={item.timeLabel}
        snoozed={item.item.snoozed}
        snoozeWakeLabel={item.snoozeWakeLabelText}
        snoozePresetMinute={item.snoozePresetMinute ?? ""}
        snoozePresets={environmentsState.snoozePresetsByEnvironmentId.get(thread.environmentId)}
        snoozeSupported={environmentsState.snoozeEnvironmentIds.has(thread.environmentId)}
        pinningSupported={environmentsState.pinningEnvironmentIds.has(thread.environmentId)}
        titleRegenerationSupported={environmentsState.titleRegenerationEnvironmentIds.has(
          thread.environmentId,
        )}
        turnIntoBotOffered={bots !== undefined && canBecomeBotChat(thread, bots)}
        projectFiltered={input.scopedProjectGroup !== null}
        selected={scopedThreadKey(thread.environmentId, thread.id) === input.selectedThreadKey}
        actions={actions}
        {...input.swipe}
        activationKey={item.key}
      />
    );
  };

  const header = (
    <ChatsSidebarGroups
      computers={home.environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        connected: environment.connectionState === "connected",
        machine: environmentsState.machineByEnvironmentId.get(environment.environmentId),
      }))}
      selectedEnvironmentId={home.selectedEnvironmentId}
      onEnvironmentChange={home.onEnvironmentChange}
      projects={pickableProjects.map((scope) => {
        const ref = scope.projectRefs[0];
        return {
          key: scope.key,
          label: scope.title,
          project: ref ? projectOf(ref.environmentId, ref.projectId) : null,
        };
      })}
      selectedProjectKey={home.selectedProjectKey}
      onProjectChange={home.onProjectChange}
      onNewChat={home.onNewThreadInProject}
      botEnvironmentIds={input.searchEnvironmentIds}
      botProjectRefs={input.scopedProjectGroup?.projectRefs ?? null}
      query={home.searchQuery}
    />
  );

  return { listData, renderItem, header } as const;
}
