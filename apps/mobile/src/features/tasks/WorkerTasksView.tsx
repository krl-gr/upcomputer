import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ScopedTaskListItem } from "@t3tools/tasks-client/state/taskPages";
import { CURRENT_TASK_WORKFLOW_VERSION } from "@t3tools/tasks-contracts/v1";
import { useGT, useMessages } from "gt-react-native";
import { use, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { UpIcon } from "../../components/up-icons/UpIcon";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { Toolbar } from "../../components/ui/Toolbar";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { useProjects } from "../../state/entities";
import {
  SelectsDetailOverPageContext,
  useSelectWorkspaceDetail,
} from "../layout/workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { TaskListRow } from "./TaskListRow";
import {
  appliedWorkerTaskFilterCount,
  ARCHIVE_OPTIONS,
  collapsedTaskStatuses,
  DEFAULT_WORKER_TASK_FILTERS,
  LAST_RUN_OPTIONS,
  taskListEmptyState,
  taskListSections,
  taskStatusChoices,
  toggledTag,
  workerStatusOptions,
  workerTagOptions,
  type tasksEnvironments,
  type WorkerTaskFilters,
} from "./taskListState";
import { TasksToolbar } from "./TasksHeader";
import { updateTasksPreferences, useTasksPreferences } from "./tasksPreferences";
import { readTasksClient, useTasksAccess } from "./tasksRpc";
import { useTaskList, useTaskListSettings } from "./useTasks";

type TaskListEntry =
  | {
      readonly type: "section";
      readonly key: string;
      readonly title: string;
      readonly count: number;
      readonly open: boolean;
    }
  | { readonly type: "task"; readonly key: string; readonly task: ScopedTaskListItem };

/**
 * Worker tasks: one computer's worker tasks in the desktop's narrow table, grouped by status in
 * the user's order, with the desktop's filters in the header menu.
 */
export function WorkerTasksView(props: {
  readonly environmentId: EnvironmentId | null;
  readonly environment: ReturnType<typeof tasksEnvironments>[number] | null;
  readonly connected: boolean;
  readonly sidebar: boolean;
  /** The computer picker for the header menu, when there is more than one. */
  readonly environmentMenu: ReactNode;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  // Absent in the chat's side panel, which shows these views outside the workspace tabs.
  const workspace = useWorkspaceTabs();
  const allProjects = useProjects();
  const { environmentId, environment, connected, sidebar } = props;
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const columnSafeBottom = useNativeColumnLayoutMetrics()?.safeArea.bottom;
  const bottomSafeArea =
    Platform.OS === "ios" ? (columnSafeBottom ?? insets.bottom) : insets.bottom;
  const listRef = useRef<LegendListRef>(null);
  const [initialScrollOffset] = useState(() => workspace?.getScrollOffset("tasks") ?? 0);
  const access = useTasksAccess(connected ? environmentId : null);
  const listSettings = useTaskListSettings(environmentId, access);
  // Grouping only; the statuses themselves come from the page and its counts.
  const workflowVersion = listSettings.workflowVersion ?? CURRENT_TASK_WORKFLOW_VERSION;
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  const projectById = new Map<string, EnvironmentProject>(
    projects.map((project) => [project.id, project]),
  );
  const saved = useTasksPreferences().workerFilters;
  // A project of another computer is no filter here; it stays saved for that computer.
  const filters: WorkerTaskFilters =
    saved.projectId !== null && !projectById.has(saved.projectId)
      ? { ...saved, projectId: null }
      : saved;
  const setFilters = (next: WorkerTaskFilters) => {
    updateTasksPreferences({ workerFilters: next });
    void listRef.current?.scrollToOffset({ offset: -contentTopInset, animated: false });
  };
  // Collapsed groups load nothing until opened; their counts still show.
  const collapsed = collapsedTaskStatuses(filters, listSettings.settings);
  const list = useTaskList(connected ? environmentId : null, access, filters, collapsed);
  const counts = list.counts?.counts ?? [];
  const page = list.page?.page;
  const sections = taskListSections({
    tasks: page?.tasks ?? [],
    counts,
    statuses: page?.statuses ?? [],
    status: filters.status,
    workflowVersion,
    settings: listSettings.settings,
  });
  const entries: TaskListEntry[] = sections.flatMap((section) => [
    ...(section.title
      ? [
          {
            type: "section" as const,
            key: `s:${section.key}`,
            title: section.title,
            count: section.count,
            open: section.open,
          },
        ]
      : []),
    ...section.tasks.map((task) => ({ type: "task" as const, key: `t:${task.id}`, task })),
  ]);
  const appliedCount = appliedWorkerTaskFilterCount(filters);
  const error = list.page?.error ?? list.counts?.error;
  const emptyState = taskListEmptyState({
    environment,
    availability: access?.availability ?? null,
    initialLoading: list.page === null || list.page.initialLoading,
    error,
    filtered: appliedCount > 0,
  });

  const selectDetail = useSelectWorkspaceDetail();
  const overPage = use(SelectsDetailOverPageContext) && Platform.OS === "ios";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectTask = (task: ScopedTaskListItem) => {
    Keyboard.dismiss();
    setSelectedKey(`t:${task.id}`);
    selectDetail({
      name: "Task",
      params: {
        environmentId: String(task.environmentId),
        taskId: String(task.id),
        title: task.title,
      },
    });
  };
  const canCreate = connected && access?.canMutateTasks === true;
  // The task page's status change; the change stream then moves the row to its new group.
  const moveStatus = (task: ScopedTaskListItem, status: string) => {
    void readTasksClient(task.environmentId)
      .tasks.update({ id: task.id, status })
      .catch((cause: unknown) =>
        Dialog.alert(
          gt("Couldn't change the status"),
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
  };

  const statusOptions = workerStatusOptions(counts, workflowVersion, filters.status);
  const tagOptions = workerTagOptions(page?.tasks ?? [], filters.tags);
  const filterSections = (
    <Toolbar.Menu inline title={gt("Filters")}>
      <Toolbar.Menu title={gt("Project")}>
        <Toolbar.MenuAction
          isOn={filters.projectId === null}
          onPress={() => setFilters({ ...filters, projectId: null })}
        >
          {gt("All projects")}
        </Toolbar.MenuAction>
        {projects.map((project) => (
          <Toolbar.MenuAction
            key={project.id}
            isOn={filters.projectId === project.id}
            onPress={() => setFilters({ ...filters, projectId: project.id })}
          >
            {project.title}
          </Toolbar.MenuAction>
        ))}
      </Toolbar.Menu>
      <Toolbar.Menu title={gt("Status")}>
        <Toolbar.MenuAction
          isOn={filters.status === null}
          onPress={() => setFilters({ ...filters, status: null })}
        >
          {gt("All statuses")}
        </Toolbar.MenuAction>
        {statusOptions.map((status) => (
          <Toolbar.MenuAction
            key={status}
            isOn={filters.status === status}
            onPress={() => setFilters({ ...filters, status })}
          >
            {status}
          </Toolbar.MenuAction>
        ))}
      </Toolbar.Menu>
      <Toolbar.Menu title={gt("Last run")}>
        <Toolbar.MenuAction
          isOn={filters.lastRun === null}
          onPress={() => setFilters({ ...filters, lastRun: null })}
        >
          {gt("Any last run")}
        </Toolbar.MenuAction>
        {LAST_RUN_OPTIONS.map((option) => (
          <Toolbar.MenuAction
            key={option.value}
            isOn={filters.lastRun === option.value}
            onPress={() => setFilters({ ...filters, lastRun: option.value })}
          >
            {messages(option.label)}
          </Toolbar.MenuAction>
        ))}
      </Toolbar.Menu>
      <Toolbar.Menu title={gt("Tags")}>
        <Toolbar.MenuAction
          isOn={filters.tags.length === 0}
          onPress={() => setFilters({ ...filters, tags: [] })}
        >
          {gt("All tags")}
        </Toolbar.MenuAction>
        {tagOptions.map((tag) => (
          <Toolbar.MenuAction
            key={tag}
            isOn={filters.tags.includes(tag)}
            onPress={() => setFilters({ ...filters, tags: toggledTag(filters.tags, tag) })}
          >
            {tag}
          </Toolbar.MenuAction>
        ))}
      </Toolbar.Menu>
      <Toolbar.Menu
        title={gt("Show", { $context: "filter label: which tasks to show, active or archived" })}
      >
        {ARCHIVE_OPTIONS.map((option) => (
          <Toolbar.MenuAction
            key={option.value}
            isOn={filters.archive === option.value}
            onPress={() => setFilters({ ...filters, archive: option.value })}
          >
            {messages(option.label)}
          </Toolbar.MenuAction>
        ))}
      </Toolbar.Menu>
      <Toolbar.MenuAction
        disabled={appliedCount === 0}
        onPress={() => setFilters(DEFAULT_WORKER_TASK_FILTERS)}
      >
        {gt("Reset")}
      </Toolbar.MenuAction>
    </Toolbar.Menu>
  );

  return (
    <View className={sidebar ? "flex-1 bg-drawer" : "flex-1 bg-screen"}>
      <TasksToolbar
        createLabel={gt("New task")}
        createDisabled={!canCreate}
        onCreate={() =>
          environmentId !== null &&
          navigation.navigate("TaskCreate", {
            environmentId: String(environmentId),
            ...(overPage ? { overPage: true } : {}),
          })
        }
        menuLabel={
          appliedCount > 0 ? gt("Filters, {count} applied", { count: appliedCount }) : gt("Filters")
        }
        applied={appliedCount > 0}
        sections={
          <>
            {filterSections}
            {props.environmentMenu}
          </>
        }
      />
      <LegendList
        ref={listRef}
        data={entries}
        extraData={selectedKey}
        keyExtractor={(entry) => entry.key}
        getItemType={(entry) => entry.type}
        estimatedItemSize={64}
        drawDistance={1_000}
        onEndReached={() => {
          if (page?.nextCursor && !list.page?.loadingMore) list.loadMore();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={list.refresh}
            progressViewOffset={Platform.OS === "ios" ? 60 : undefined}
          />
        }
        alwaysBounceVertical
        showsVerticalScrollIndicator={Platform.OS !== "android"}
        recycleItems
        renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
        contentInsetAdjustmentBehavior="never"
        contentInset={Platform.OS === "ios" ? { top: contentTopInset } : undefined}
        initialScrollOffset={
          initialScrollOffset > 0 ? initialScrollOffset - contentTopInset : undefined
        }
        contentContainerStyle={{
          paddingTop: 4,
          paddingBottom: Math.max(bottomSafeArea, workspace?.bottomClearance ?? 0),
        }}
        onScroll={(event) => {
          workspace?.recordScrollOffset(
            "tasks",
            Math.max(0, event.nativeEvent.contentOffset.y + contentTopInset),
          );
        }}
        renderItem={({ item }) =>
          item.type === "section" ? (
            <StatusGroupHeader
              title={item.title}
              count={item.count}
              open={item.open}
              onToggle={() => listSettings.setGroupOpen(item.key.slice(2), !item.open)}
            />
          ) : (
            <TaskListRow
              task={item.task}
              project={projectById.get(item.task.projectId) ?? null}
              onSelect={selectTask}
              statusChoices={canCreate ? taskStatusChoices(workflowVersion, item.task.status) : []}
              onMoveStatus={moveStatus}
              selected={selectedKey === item.key}
              sidebar={sidebar}
            />
          )
        }
        ListHeaderComponent={
          entries.length > 0 && error ? (
            <Text selectable className="px-4 py-1.5 text-sm text-foreground-muted">
              {error}
            </Text>
          ) : undefined
        }
        ListFooterComponent={
          list.page?.loadingMore ? (
            <View className="items-center py-5">
              <AppActivityIndicator
                colorClassName="accent-icon"
                accessibilityLabel={gt("Loading more tasks")}
              />
            </View>
          ) : page?.nextCursor && entries.length > 0 ? (
            <View className="items-center py-4">
              <Button label={gt("Load more")} onPress={list.loadMore} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={<TaskListEmpty state={emptyState} error={error} />}
      />
    </View>
  );
}

/**
 * The desktop's narrow group header in the Chats list's group header metrics: the status and a
 * chevron, and the count at the end, level with the rows' run counts.
 */
function StatusGroupHeader(props: {
  readonly title: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: props.open }}
      accessibilityLabel={`${props.title}, ${props.count}`}
      accessibilityHint={props.open ? gt("Hides the group") : gt("Shows the group")}
      onPress={props.onToggle}
      className="min-h-[52px] flex-row items-center gap-2 px-5 pt-2 active:opacity-60"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-1.5 py-2">
        <Text
          className="shrink text-base font-t3-medium text-foreground-tertiary"
          numberOfLines={1}
        >
          {props.title}
        </Text>
        <UpIcon
          name={props.open ? "chevron-down" : "chevron-right"}
          size={17}
          tintColorClassName="accent-icon-muted"
        />
      </View>
      <Text className="text-base tabular-nums text-foreground-tertiary">{props.count}</Text>
    </Pressable>
  );
}

function TaskListEmpty(props: {
  readonly state: ReturnType<typeof taskListEmptyState>;
  readonly error: string | undefined;
}) {
  const gt = useGT();
  if (props.state === "loading" || props.state === "checking") {
    return (
      <View className="items-center py-12">
        <AppActivityIndicator
          colorClassName="accent-icon"
          accessibilityLabel={gt("Loading tasks")}
        />
      </View>
    );
  }
  const copy = {
    noEnvironment: {
      title: gt("Connect a computer"),
      detail: gt("Add an environment in Settings to see its tasks."),
    },
    offline: {
      title: gt("Computer offline"),
      detail: gt("Reconnect to load its tasks."),
    },
    unavailable: {
      title: gt("Tasks unavailable"),
      detail: gt("Update this computer's Up.computer to see its tasks here."),
    },
    error: { title: gt("Couldn't load tasks"), detail: props.error ?? "" },
    filtered: { title: gt("No tasks match the current filters"), detail: "" },
    empty: {
      title: gt("No tasks yet"),
      detail: gt("Tap + to add one, or ask any thread to plan the work for you."),
    },
  }[props.state];
  return (
    <View className="px-8 py-12">
      <EmptyState title={copy.title} detail={copy.detail} variant="plain" />
    </View>
  );
}
