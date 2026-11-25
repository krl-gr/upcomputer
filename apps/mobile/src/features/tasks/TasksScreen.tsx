import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ScopedTaskListItem } from "@t3tools/tasks-client/state/taskPages";
import { LEGACY_TASK_WORKFLOW_VERSION } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react-native";
import { use, useRef, useState } from "react";
import { Keyboard, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { usePaneRole } from "../../components/ui/Pane";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useProjects } from "../../state/entities";
import { useDebouncedValue } from "../../state/queries";
import { useWorkspaceState } from "../../state/workspace";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import { useSearchScrollRestoration } from "../layout/workspace/useSearchScrollRestoration";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { TaskListRow } from "./TaskListRow";
import {
  chooseTasksEnvironment,
  OPEN_TASKS_FILTER,
  parseTaskListFilter,
  taskListEmptyState,
  taskListFilterCount,
  taskListFilterKey,
  taskListSections,
  tasksEnvironments,
  taskStatusOptions,
  type TaskListFilter,
} from "./taskListState";
import { useTasksAccess } from "./tasksRpc";
import { useTaskList, useTaskWorkflowVersion } from "./useTasks";

// A 12dp inset keeps 16dp chips concentric with Android's 28dp ScreenContent corner.
const FILTER_ROW_STYLE =
  Platform.OS === "android"
    ? { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 8 }
    : { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, gap: 8 };

type TaskListEntry =
  | {
      readonly type: "section";
      readonly key: string;
      readonly title: string;
      readonly count: number;
    }
  | { readonly type: "task"; readonly key: string; readonly task: ScopedTaskListItem };

/** The Tasks tab: one computer's tasks by status, as the desktop's task table groups them. */
export function TasksScreen(props: { readonly sidebar?: boolean } = {}) {
  const gt = useGT();
  const navigation = useNavigation();
  const primaryColumn = use(NativePrimaryColumnContext);
  const workspace = useWorkspaceTabs()!;
  const { environments } = useWorkspaceState();
  const projects = useProjects();
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const columnSafeBottom = useNativeColumnLayoutMetrics()?.safeArea.bottom;
  const bottomSafeArea =
    Platform.OS === "ios" ? (columnSafeBottom ?? insets.bottom) : insets.bottom;
  const { themeAppearance } = useAppearancePreferences();
  const listRef = useRef<LegendListRef>(null);
  const tab = workspace.state.tabs.tasks;
  const [initialScrollOffset] = useState(() => workspace.getScrollOffset("tasks"));
  useSearchScrollRestoration(tab.searchMode, () => {
    void listRef.current?.scrollToOffset({
      offset: tab.scrollOffset - contentTopInset,
      animated: false,
    });
  });
  const debouncedQuery = useDebouncedValue(tab.query.trim(), 200);
  const query = tab.searchMode === "resting" ? "" : debouncedQuery;

  const choices = tasksEnvironments(environments);
  const [pickedEnvironment, setPickedEnvironment] = useState<EnvironmentId | null>(null);
  const environmentId = chooseTasksEnvironment(choices, pickedEnvironment);
  const environment = choices.find((choice) => choice.environmentId === environmentId) ?? null;
  const connected = environment?.connectionState === "connected";
  const access = useTasksAccess(connected ? environmentId : null);
  const workflowVersion =
    useTaskWorkflowVersion(environmentId, access) ?? LEGACY_TASK_WORKFLOW_VERSION;
  const [filter, setFilter] = useState<TaskListFilter>(OPEN_TASKS_FILTER);
  const list = useTaskList(connected ? environmentId : null, access, filter);
  const counts = list.counts?.counts ?? [];
  const page = list.page?.page;

  const projectNames = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id, project.title]),
  );
  const projectName = (task: ScopedTaskListItem) => projectNames.get(task.projectId) ?? null;
  const sections = taskListSections({
    tasks: page?.tasks ?? [],
    counts,
    statuses: page?.statuses ?? [],
    filter,
    workflowVersion,
    query,
    projectName,
  });
  const entries: TaskListEntry[] = sections.flatMap((section) => [
    {
      type: "section" as const,
      key: `s:${section.key}`,
      title: section.title,
      count: section.count,
    },
    ...section.tasks.map((task) => ({ type: "task" as const, key: `t:${task.id}`, task })),
  ]);
  const statusOptions = taskStatusOptions(counts, workflowVersion);
  const error = list.page?.error ?? list.counts?.error;
  const emptyState = taskListEmptyState({
    environment,
    availability: access?.availability ?? null,
    initialLoading: list.page === null || list.page.initialLoading,
    error,
    searching: query !== "",
  });

  const paneRole = usePaneRole();
  const sidebar = props.sidebar === true || (primaryColumn !== null && paneRole === "sidebar");
  const selectDetail = useSelectWorkspaceDetail();
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
  const scrollToTop = () =>
    void listRef.current?.scrollToOffset({ offset: -contentTopInset, animated: false });
  const filterLabel =
    filter.kind === "open"
      ? gt("Open", { $context: "task filter: tasks that are not done or cancelled" })
      : filter.kind === "all"
        ? gt("All tasks")
        : filter.status;
  const countSuffix = (count: number) => (list.counts?.counts ? ` (${count})` : "");
  const canCreate = connected && access?.canMutateTasks === true;

  return (
    <View className={sidebar ? "flex-1 bg-drawer" : "flex-1 bg-screen"}>
      <LegendList
        ref={listRef}
        data={entries}
        extraData={selectedKey}
        keyExtractor={(entry) => entry.key}
        getItemType={(entry) => entry.type}
        estimatedItemSize={84}
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
          paddingBottom: Math.max(bottomSafeArea, workspace.bottomClearance),
        }}
        onScroll={(event) => {
          workspace.recordScrollOffset(
            "tasks",
            Math.max(0, event.nativeEvent.contentOffset.y + contentTopInset),
          );
        }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) =>
          item.type === "section" ? (
            <View className="flex-row items-baseline gap-2 px-4 pb-1 pt-4">
              <Text className="text-sm font-t3-bold text-foreground">{item.title}</Text>
              <Text className="text-xs tabular-nums text-foreground-muted">{item.count}</Text>
            </View>
          ) : (
            <TaskListRow
              task={item.task}
              projectName={projectName(item.task)}
              onSelect={selectTask}
              selected={selectedKey === item.key}
              sidebar={sidebar}
            />
          )
        }
        ListHeaderComponentStyle={{ zIndex: 1 }}
        ListHeaderComponent={
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ overflow: "visible" }}
              contentContainerStyle={FILTER_ROW_STYLE}
            >
              {choices.length > 1 ? (
                <ListFilterMenu
                  label={environment?.environmentLabel ?? gt("Computer")}
                  accessibilityLabel={gt("Choose a computer")}
                  actions={choices.map((choice) => ({
                    id: choice.environmentId,
                    title: choice.environmentLabel,
                    subtitle: choice.connectionState === "connected" ? undefined : gt("Offline"),
                    state: choice.environmentId === environmentId ? "on" : "off",
                  }))}
                  onSelect={(id) => {
                    setPickedEnvironment(id as EnvironmentId);
                    scrollToTop();
                  }}
                />
              ) : null}
              <ListFilterMenu
                label={filterLabel}
                active={filter.kind !== "open"}
                accessibilityLabel={gt("Filter by status")}
                actions={[
                  {
                    id: "open",
                    title:
                      gt("Open", {
                        $context: "task filter: tasks that are not done or cancelled",
                      }) + countSuffix(taskListFilterCount(OPEN_TASKS_FILTER, counts)),
                    state: filter.kind === "open" ? "on" : "off",
                  },
                  {
                    id: "all",
                    title:
                      gt("All tasks") + countSuffix(taskListFilterCount({ kind: "all" }, counts)),
                    state: filter.kind === "all" ? "on" : "off",
                  },
                  ...statusOptions.map((option) => {
                    const id = taskListFilterKey({ kind: "status", status: option.status });
                    return {
                      id,
                      title: `${option.status} (${option.count})`,
                      state: taskListFilterKey(filter) === id ? ("on" as const) : ("off" as const),
                    };
                  }),
                ]}
                onSelect={(id) => {
                  setFilter(
                    parseTaskListFilter(
                      id,
                      statusOptions.map((option) => option.status),
                    ),
                  );
                  scrollToTop();
                }}
              />
              <Chip
                label={gt("New task")}
                icon="plus"
                glass
                colorScheme={themeAppearance}
                disabled={!canCreate}
                accessibilityLabel={gt("New task")}
                onPress={() =>
                  environmentId !== null &&
                  navigation.navigate("TaskCreate", { environmentId: String(environmentId) })
                }
              />
            </ScrollView>
            {entries.length > 0 && error ? (
              <Text selectable className="px-4 py-1.5 text-sm text-foreground-muted">
                {error}
              </Text>
            ) : null}
          </>
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
    noResults: { title: gt("No results"), detail: gt("No loaded task matches your search.") },
    empty: {
      title: gt("No tasks here"),
      detail: gt("Tasks you and your workers create show up here."),
    },
  }[props.state];
  return (
    <View className="px-8 py-12">
      <EmptyState title={copy.title} detail={copy.detail} variant="plain" />
    </View>
  );
}
