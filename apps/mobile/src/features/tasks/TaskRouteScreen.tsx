import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { taskHistoryRecords, type TaskHistoryRecord } from "@t3tools/tasks-client/taskHistory";
import {
  PERSON_DONE_STATUS,
  PERSON_OPEN_STATUS,
  TaskId,
  type TaskActor,
  type TaskAgentRun,
  type TaskUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import { msg, useGT, useMessages } from "gt-react-native";
import { useRef, useState } from "react";
import { Pressable, View, type ScrollViewInstance } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { ScreenContent } from "../../components/ui/ScreenContent";
import type { MessageResolver } from "../../i18n/messages";
import { relativeTime } from "../../lib/time";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useProjects } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useAndroidWorkspaceBack } from "../layout/workspace/useAndroidWorkspaceNavigation";
import { PullRequestSectionHeading } from "../pull-requests/PullRequestSectionHeading";
import { TaskDescriptionField, TaskDetailRow, TaskTitleField } from "./TaskDetailFields";
import { TaskMarkdown } from "./TaskMarkdown";
import { TaskProjectBadge } from "./TaskProjectBadge";
import { TaskRunsSection } from "./TaskRunsSection";
import { taskStatusChoices } from "./taskListState";
import { taskStatusTone } from "./taskPresentation";
import { readTasksClient, useTasksAccess } from "./tasksRpc";
import { useTaskRuns } from "./useTaskRuns";
import { useTaskDetail, useTaskWorkflow } from "./useTasks";

export type TaskRouteParams = {
  readonly environmentId: string;
  readonly taskId: string;
  /** The row's title, shown while the task loads. */
  readonly title?: string;
  /** A run count's status: the page opens on the runs in it. */
  readonly runStatus?: string;
};

// Selecting another task reuses this route, so its busy state and errors are keyed.
export function TaskRouteScreen({ route }: StaticScreenProps<TaskRouteParams>) {
  return (
    <TaskRoute
      key={`${route.params.environmentId}:${route.params.taskId}:${route.params.runStatus ?? ""}`}
      params={route.params}
    />
  );
}

function TaskRoute({ params }: { readonly params: TaskRouteParams }) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const returnToList = useAndroidWorkspaceBack();
  const { layout } = useAdaptiveWorkspaceLayout();
  const environmentId = EnvironmentId.make(params.environmentId);
  const taskId = TaskId.make(params.taskId);
  const { environments } = useWorkspaceState();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const connected = environment?.connectionState === "connected";
  const access = useTasksAccess(connected ? environmentId : null);
  const workflow = useTaskWorkflow(environmentId, access);
  const detail = useTaskDetail(environmentId, taskId, access);
  const [runFilter, setRunFilter] = useState<string | null>(params.runStatus ?? null);
  const runs = useTaskRuns(environmentId, taskId, access, runFilter);
  const task = detail.task;
  const project = useProjects().find(
    (entry) => entry.environmentId === environmentId && entry.id === task?.projectId,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [busyField, setBusyField] = useState<string | null>(null);
  const canEdit = connected && access?.canMutateTasks === true && task !== null;
  const archived = task?.archivedAt != null;
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrolledToRuns = useRef(params.runStatus === undefined);

  const updateTask = async (field: string, update: Omit<TaskUpdateInput, "id">) => {
    if (!task) return false;
    setBusyField(field);
    const saved = await readTasksClient(environmentId)
      .tasks.update({ id: task.id, ...update })
      .then(
        (updated) => {
          detail.applyLocal(updated);
          return true;
        },
        (cause: unknown) => {
          Dialog.alert(gt("Couldn't save the task"), errorText(cause));
          return false;
        },
      );
    setBusyField(null);
    return saved;
  };
  const setArchived = async (archive: boolean) => {
    if (!task || busyField !== null) return;
    setBusyField("archive");
    const client = readTasksClient(environmentId);
    await (archive ? client.tasks.archive : client.tasks.unarchive)({ ids: [task.id] }).then(
      () => detail.refresh(),
      (cause: unknown) =>
        Dialog.alert(
          archive ? gt("Failed to archive task") : gt("Failed to unarchive task"),
          errorText(cause),
        ),
    );
    setBusyField(null);
  };
  const latestRun = runFilter === null ? (runs.runs[0] ?? null) : null;
  const openTranscript = (run: TaskAgentRun) =>
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(environmentId),
        threadId: String(run.threadId),
      }),
    );
  const workerOfRun = (runId: string) => {
    const run = runs.runs.find((entry) => entry.id === runId);
    return run ? (runs.workers.get(String(run.agentId))?.name ?? null) : null;
  };
  const subtitle = [project?.title, environment?.environmentLabel, connected ? null : gt("Offline")]
    .filter(Boolean)
    .join(" · ");
  const statusChoices = !canEdit
    ? []
    : task.audience === "person"
      ? [PERSON_OPEN_STATUS, PERSON_DONE_STATUS]
      : workflow.version !== null
        ? taskStatusChoices(workflow.version, task.status)
        : [];

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={task?.title ?? params.title ?? gt("Task")}
        subtitle={subtitle}
        onBack={layout.usesSplitView ? undefined : returnToList}
        actions={
          task && canEdit
            ? [
                {
                  accessibilityLabel: archived ? gt("Unarchive task") : gt("Archive task"),
                  icon: archived ? "tray.and.arrow.up" : "archivebox",
                  disabled: busyField !== null,
                  loading: busyField === "archive",
                  onPress: () => void setArchived(!archived),
                },
              ]
            : []
        }
        menus={[
          {
            title: gt("Task actions"),
            icon: "ellipsis",
            items: [
              ...(latestRun
                ? [
                    {
                      id: "transcript",
                      title: gt("Open worker transcript"),
                      icon: "text.bubble",
                      onPress: () => openTranscript(latestRun),
                    },
                  ]
                : []),
              {
                id: "refresh",
                title: gt("Refresh"),
                icon: "arrow.clockwise",
                onPress: () => {
                  void detail.refresh();
                  runs.refresh();
                },
              },
            ],
          },
        ]}
      />
      <ScreenContent>
        <NativeScrollView
          ref={scrollRef}
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                runs.refresh();
                void detail.refresh().finally(() => setRefreshing(false));
              }}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
        >
          {task === null ? (
            detail.status === "loading" || (!connected && detail.status !== "error") ? (
              connected ? (
                <AppActivityIndicator
                  className="my-12"
                  colorClassName="accent-icon"
                  accessibilityLabel={gt("Loading task")}
                />
              ) : (
                <EmptyState
                  title={gt("Computer offline")}
                  detail={gt("Reconnect to load this task.")}
                  variant="plain"
                />
              )
            ) : (
              <EmptyState
                title={
                  detail.status === "missing" ? gt("Task not found") : gt("Couldn't load this task")
                }
                detail={
                  detail.status === "missing"
                    ? gt("It may have been deleted or archived.")
                    : (detail.error ?? "")
                }
                variant="plain"
              />
            )
          ) : (
            <View className="gap-6">
              <View className="gap-2">
                {archived ? (
                  <Text className="self-start rounded-md bg-subtle px-2 py-0.5 text-xs text-foreground-muted">
                    {gt("Archived", { $context: "status of an archived task" })}
                  </Text>
                ) : null}
                <TaskTitleField
                  key={`${task.id}:title`}
                  value={task.title}
                  canEdit={canEdit}
                  onSave={(title) => updateTask("title", { title })}
                />
                {canEdit || connected ? null : (
                  <Text className="text-xs text-foreground-muted">
                    {gt("Reconnect to this computer to change this task.")}
                  </Text>
                )}
              </View>
              <TaskDescriptionField
                key={`${task.id}:description`}
                value={task.description}
                canEdit={canEdit}
                environmentId={environmentId}
                cwd={project?.workspaceRoot ?? null}
                onSave={(description) => updateTask("description", { description })}
              />
              {task.output !== null && task.output.trim() !== "" ? (
                <View className="gap-2">
                  <PullRequestSectionHeading>{gt("Output")}</PullRequestSectionHeading>
                  <TaskMarkdown
                    markdown={task.output}
                    environmentId={environmentId}
                    cwd={project?.workspaceRoot ?? null}
                  />
                </View>
              ) : null}
              <View className="gap-2">
                <PullRequestSectionHeading>{gt("Details")}</PullRequestSectionHeading>
                <View className="overflow-hidden rounded-2xl bg-grouped-card">
                  <TaskDetailRow label={gt("Status")} first>
                    <TaskStatusControl
                      status={task.status}
                      choices={statusChoices}
                      busy={busyField === "status"}
                      onMove={(status) => {
                        if (status !== task.status) void updateTask("status", { status });
                      }}
                    />
                  </TaskDetailRow>
                  <TaskDetailRow label={gt("Project")}>
                    <TaskProjectBadge
                      environmentId={environmentId}
                      project={project ?? null}
                      size={18}
                    />
                    <Text className="shrink text-base text-foreground-muted" numberOfLines={1}>
                      {project?.title ?? gt("No project")}
                    </Text>
                  </TaskDetailRow>
                  {/* A person task's tags stay hidden; the planner hands it to an agent. */}
                  {task.audience === "person" ? null : (
                    <TaskDetailRow
                      label={gt("Tags")}
                      accessibilityValue={
                        task.tags.length > 0
                          ? task.tags.join(", ")
                          : gt("None", { $context: "a task has no tags" })
                      }
                      onPress={
                        canEdit
                          ? () =>
                              navigation.dispatch(
                                StackActions.push("TaskTags", {
                                  environmentId: String(environmentId),
                                  taskId: String(task.id),
                                  title: task.title,
                                }),
                              )
                          : undefined
                      }
                    >
                      {task.tags.length > 0 ? (
                        task.tags.map((tag) => (
                          <Text
                            key={tag}
                            numberOfLines={1}
                            className="rounded-md bg-subtle px-2 py-0.5 text-sm text-foreground-muted"
                          >
                            {tag}
                          </Text>
                        ))
                      ) : (
                        <Text className="text-base text-foreground-muted">
                          {gt("None", { $context: "a task has no tags" })}
                        </Text>
                      )}
                    </TaskDetailRow>
                  )}
                  <TaskDetailRow label={gt("Created", { $context: "date a task was created" })}>
                    <Text className="text-base text-foreground-muted">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </Text>
                  </TaskDetailRow>
                  <TaskDetailRow
                    label={gt("Updated", { $context: "date a task was last updated" })}
                  >
                    <Text className="text-base text-foreground-muted">
                      {relativeTime(task.updatedAt, undefined, messages)}
                    </Text>
                  </TaskDetailRow>
                  {task.archivedAt ? (
                    <TaskDetailRow label={gt("Archived", { $context: "date a task was archived" })}>
                      <Text className="text-base text-foreground-muted">
                        {new Date(task.archivedAt).toLocaleString()}
                      </Text>
                    </TaskDetailRow>
                  ) : null}
                  {task.notBefore ? (
                    <TaskDetailRow label={gt("Not before")}>
                      <Text className="text-base text-foreground-muted">
                        {new Date(task.notBefore).toLocaleString()}
                      </Text>
                    </TaskDetailRow>
                  ) : null}
                </View>
                {workflow.error && task.audience !== "person" ? (
                  <Text selectable className="text-xs text-foreground-muted">
                    {gt("Couldn't load this computer's task statuses: {error}", {
                      error: workflow.error,
                    })}
                  </Text>
                ) : null}
              </View>
              {task.audience === "person" ? null : (
                <View
                  onLayout={(event) => {
                    // A run count opened the page: show its runs.
                    if (scrolledToRuns.current) return;
                    scrolledToRuns.current = true;
                    const y = event.nativeEvent.layout.y;
                    setTimeout(() => scrollRef.current?.scrollTo({ y, animated: true }), 0);
                  }}
                >
                  <TaskRunsSection
                    environmentId={environmentId}
                    data={runs}
                    filter={runFilter}
                    onShowAll={() => setRunFilter(null)}
                    canMutate={connected && access?.canMutateTasks === true}
                  />
                </View>
              )}
              <View className="gap-2">
                <PullRequestSectionHeading>{gt("History")}</PullRequestSectionHeading>
                <TaskHistoryList
                  records={detail.events === null ? null : taskHistoryRecords(detail.events)}
                  workerOfRun={workerOfRun}
                />
              </View>
            </View>
          )}
        </NativeScrollView>
      </ScreenContent>
    </View>
  );
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function TaskStatusControl(props: {
  readonly status: string;
  readonly choices: readonly string[];
  readonly busy: boolean;
  readonly onMove: (status: string) => void;
}) {
  const gt = useGT();
  const tone = taskStatusTone(props.status);
  const movable = props.choices.length > 0;
  const trigger = (
    <Pressable
      accessibilityRole={movable ? "button" : undefined}
      accessibilityLabel={gt("Status, {status}", { status: props.status })}
      accessibilityHint={movable ? gt("Changes the task's status") : undefined}
      disabled={!movable || props.busy}
      className="min-h-8 flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 active:opacity-70"
    >
      <SymbolView name={tone.icon} size={14} tintColorClassName={tone.tint} />
      <Text className={`text-sm font-t3-medium ${tone.text}`}>{props.status}</Text>
      {props.busy ? (
        <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
      ) : movable ? (
        <SymbolView name="chevron.down" size={10} tintColorClassName="accent-icon-muted" />
      ) : null}
    </Pressable>
  );
  if (!movable) return trigger;
  return (
    // As wide as the trigger: iOS anchors the menu to this view, not to the text inside it.
    <View className="self-start">
      <Menu
        title={gt("Move to")}
        // The status name is the id: statuses are unique within a workflow.
        actions={props.choices.map((status) => ({
          id: status,
          title: status,
          state: status === props.status ? "on" : "off",
        }))}
        onPressAction={({ nativeEvent }) => {
          if (props.choices.includes(nativeEvent.event)) props.onMove(nativeEvent.event);
        }}
      >
        {trigger}
      </Menu>
    </View>
  );
}

const ACTOR_LABELS = {
  person: msg("Person", { $context: "who changed a task: a person" }),
  "agent-run": msg("Worker run"),
  thread: msg("Chat agent"),
  server: msg("Server", { $context: "who changed a task: the Up.computer server" }),
} as const satisfies Record<TaskActor["type"], string>;

/** Who made a change; a worker run is named by its worker once the page's runs list it. */
function actorLabel(actor: TaskActor, workerOfRun: WorkerOfRun, resolve: MessageResolver) {
  const worker = actor.type === "agent-run" ? workerOfRun(actor.agentRunId) : null;
  return worker ?? resolve(ACTOR_LABELS[actor.type]);
}

type WorkerOfRun = (runId: string) => string | null;

function historyText(
  record: TaskHistoryRecord,
  worker: WorkerOfRun,
  gt: ReturnType<typeof useGT>,
  resolve: MessageResolver,
): { readonly title: string; readonly detail: string } {
  switch (record.kind) {
    case "status":
      return {
        title: `${record.from} → ${record.to}`,
        detail: actorLabel(record.actor, worker, resolve),
      };
    case "archived":
    case "unarchived": {
      const actor = actorLabel(record.actor, worker, resolve);
      return {
        title:
          record.kind === "archived"
            ? gt("Archived", { $context: "history entry: the task was archived" })
            : gt("Unarchived", { $context: "history entry: the task was unarchived" }),
        detail: record.reason ? `${actor}: ${record.reason}` : actor,
      };
    }
    case "agentNotStarted":
    case "noMatchingAgent":
      return {
        title:
          record.kind === "agentNotStarted"
            ? gt("Didn't start", { $context: "history entry: a worker did not start" })
            : gt("No worker will pick this up"),
        detail: `${record.agentName ?? resolve(ACTOR_LABELS.server)}: ${record.reason}`,
      };
  }
}

function TaskHistoryList(props: {
  readonly records: readonly TaskHistoryRecord[] | null;
  readonly workerOfRun: WorkerOfRun;
}) {
  const gt = useGT();
  const messages = useMessages();
  if (props.records === null) {
    return (
      <Text className="text-sm text-foreground-muted">{gt("Couldn't load the history.")}</Text>
    );
  }
  if (props.records.length === 0) {
    return (
      <Text className="text-sm text-foreground-muted">{gt("No status changes recorded yet.")}</Text>
    );
  }
  return (
    <View className="gap-3">
      {props.records.map((record) => {
        const text = historyText(record, props.workerOfRun, gt, messages);
        return (
          <View key={record.id} className="gap-0.5">
            <View className="flex-row items-baseline gap-3">
              <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={2}>
                {text.title}
              </Text>
              <Text className="shrink-0 text-2xs text-foreground-tertiary">
                {relativeTime(record.at, undefined, messages)}
              </Text>
            </View>
            <Text selectable className="text-xs text-foreground-muted">
              {text.detail}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
