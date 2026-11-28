import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { taskHistoryRecords, type TaskHistoryRecord } from "@t3tools/tasks-client/taskHistory";
import {
  PERSON_DONE_STATUS,
  PERSON_OPEN_STATUS,
  TaskId,
  type TaskActor,
  type TaskUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import { msg, useGT, useMessages } from "gt-react-native";
import { useRef, useState } from "react";
import { Pressable, View, type ScrollViewInstance } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { UpIcon } from "../../components/up-icons/UpIcon";
import type { MessageResolver } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { relativeTime } from "../../lib/time";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useAndroidWorkspaceBack } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  DetailRow,
  DetailValue,
  GroupedCard,
  TaskDescriptionField,
  TaskPageSection,
  TaskTitleField,
} from "./TaskDetailFields";
import { TaskMarkdown } from "./TaskMarkdown";
import { TaskRunsSection } from "./TaskRunsSection";
import { taskStatusChoices } from "./taskListState";
import { taskStatusTone } from "./taskPresentation";
import { TaskTagChip } from "./TaskTagChip";
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The desktop's task page (`TasksView` detail) stacked for the phone, in its order: the title,
 * Description and Output, then the Details column's Details, Runs and History sections.
 */
function TaskRoute({ params }: { readonly params: TaskRouteParams }) {
  const gt = useGT();
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
  const refresh = () => {
    runs.refresh();
    return detail.refresh();
  };
  const openThread = (threadId: ThreadId) =>
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(environmentId),
        threadId: String(threadId),
      }),
    );
  const latestRun = runFilter === null ? (runs.runs[0] ?? null) : null;
  const workerOfRun = (runId: string) => {
    const run = runs.runs.find((entry) => entry.id === runId);
    return run ? (runs.workers.get(String(run.agentId))?.name ?? null) : null;
  };
  const output =
    task !== null && task.output !== null && task.output.trim() !== "" ? task.output : null;
  const cwd = project?.workspaceRoot ?? null;
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
        hideTitle
        onBack={layout.usesSplitView ? undefined : returnToList}
        menus={[
          {
            title: gt("More actions"),
            icon: "up.more-horizontal",
            items: [
              ...(latestRun
                ? [
                    {
                      id: "transcript",
                      title: gt("Open worker transcript"),
                      icon: "text.bubble",
                      onPress: () => openThread(latestRun.threadId),
                    },
                  ]
                : []),
              // The desktop's header action: Archive, or Unarchive for an archived task.
              ...(canEdit
                ? [
                    {
                      id: "archive",
                      title: archived
                        ? gt("Unarchive", { $context: "button that unarchives a task" })
                        : gt("Archive", { $context: "button that archives a task" }),
                      icon: archived ? "tray.and.arrow.up" : "archivebox",
                      disabled: busyField !== null,
                      onPress: () => void setArchived(!archived),
                    },
                  ]
                : []),
              {
                id: "copy-id",
                title: gt("Copy task ID"),
                icon: "doc.on.doc",
                onPress: () => copyTextWithHaptic(String(taskId)),
              },
              {
                id: "refresh",
                title: gt("Refresh"),
                icon: "arrow.clockwise",
                onPress: () => void refresh(),
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
                void refresh().finally(() => setRefreshing(false));
              }}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }}
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
            <View className="gap-2">
              <View className="gap-1.5 px-1 pb-2">
                <TaskTitleField
                  key={`${task.id}:title`}
                  value={task.title}
                  canEdit={canEdit}
                  onSave={(title) => updateTask("title", { title })}
                />
                {archived ? (
                  <Text className="text-sm text-foreground-muted">
                    {gt("Archived", { $context: "status of an archived task" })}
                  </Text>
                ) : null}
                {canEdit || connected ? null : (
                  <Text className="text-sm text-foreground-muted">
                    {gt("Reconnect to this computer to change this task.")}
                  </Text>
                )}
              </View>

              {/* As on the desktop: collapsed when the task has output. */}
              <TaskDescriptionField
                key={`${task.id}:description`}
                value={task.description}
                canEdit={canEdit}
                defaultOpen={output === null}
                environmentId={environmentId}
                cwd={cwd}
                onSave={(description) => updateTask("description", { description })}
              />

              {output !== null ? (
                <TaskPageSection title={gt("Output")}>
                  <View className="px-1">
                    <TaskMarkdown markdown={output} environmentId={environmentId} cwd={cwd} />
                  </View>
                </TaskPageSection>
              ) : null}

              <TaskPageSection title={gt("Details")}>
                <GroupedCard>
                  <TaskStatusRow
                    status={task.status}
                    choices={statusChoices}
                    busy={busyField === "status"}
                    onMove={(status) => {
                      if (status !== task.status) void updateTask("status", { status });
                    }}
                  />
                  <DetailRow label={gt("Project")}>
                    <View className="min-w-0 shrink flex-row items-center justify-end gap-2">
                      {project ? (
                        <ProjectFavicon
                          environmentId={environmentId}
                          faviconPath={project.faviconPath}
                          projectIcon={project.projectIcon}
                          size={18}
                          projectTitle={project.title}
                          workspaceRoot={project.workspaceRoot}
                        />
                      ) : null}
                      <DetailValue>{project?.title ?? gt("No project")}</DetailValue>
                    </View>
                  </DetailRow>
                  {/* A person task's tags stay hidden, as on the desktop. */}
                  {task.audience === "person" ? null : (
                    <DetailRow
                      label={gt("Tags")}
                      accessibilityValue={
                        task.tags.length > 0
                          ? task.tags.join(", ")
                          : gt("None", { $context: "a task has no tags" })
                      }
                      chevron={canEdit}
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
                        <View className="min-w-0 shrink flex-row flex-wrap justify-end gap-1.5">
                          {task.tags.map((tag) => (
                            <TaskTagChip key={tag} tag={tag} />
                          ))}
                        </View>
                      ) : (
                        <DetailValue>{gt("None", { $context: "a task has no tags" })}</DetailValue>
                      )}
                    </DetailRow>
                  )}
                  {task.sourceThreadId ? (
                    <SourceThreadRow
                      environmentId={environmentId}
                      threadId={task.sourceThreadId}
                      onOpen={openThread}
                    />
                  ) : null}
                  <DetailRow label={gt("Created", { $context: "date a task was created" })}>
                    <DetailValue>{formatDate(task.createdAt)}</DetailValue>
                  </DetailRow>
                  <DetailRow label={gt("Updated", { $context: "date a task was last updated" })}>
                    <DetailValue>{formatDate(task.updatedAt)}</DetailValue>
                  </DetailRow>
                  {task.archivedAt ? (
                    <DetailRow label={gt("Archived", { $context: "date a task was archived" })}>
                      <DetailValue>{formatDateTime(task.archivedAt)}</DetailValue>
                    </DetailRow>
                  ) : null}
                  {task.notBefore ? (
                    <DetailRow label={gt("Not before")}>
                      <DetailValue>{formatDateTime(task.notBefore)}</DetailValue>
                    </DetailRow>
                  ) : null}
                </GroupedCard>
                {workflow.error && task.audience !== "person" ? (
                  <Text selectable className="px-4 pt-2 text-xs text-foreground-muted">
                    {gt("Couldn't load this computer's task statuses: {error}", {
                      error: workflow.error,
                    })}
                  </Text>
                ) : null}
              </TaskPageSection>

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

              <TaskHistorySection
                records={detail.events === null ? null : taskHistoryRecords(detail.events)}
                workerOfRun={workerOfRun}
              />
            </View>
          )}
        </NativeScrollView>
      </ScreenContent>
    </View>
  );
}

/** The Details Status row: an iOS pop-up button over the workflow's statuses. */
function TaskStatusRow(props: {
  readonly status: string;
  readonly choices: readonly string[];
  readonly busy: boolean;
  readonly onMove: (status: string) => void;
}) {
  const gt = useGT();
  const tone = taskStatusTone(props.status);
  const movable = props.choices.length > 0;
  const row = (
    <Pressable
      accessibilityRole={movable ? "button" : undefined}
      accessibilityLabel={gt("Status, {status}", { status: props.status })}
      accessibilityHint={movable ? gt("Changes the task's status") : undefined}
      disabled={!movable || props.busy}
      className="min-h-11 flex-row items-center gap-3 px-4 py-2.5 active:bg-foreground/5"
    >
      <Text className="shrink-0 text-base text-foreground">{gt("Status")}</Text>
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1.5">
        <UpIcon name={tone.icon} size={17} tintColorClassName={tone.tint} />
        <Text numberOfLines={1} className={cn("shrink text-base font-t3-medium", tone.text)}>
          {props.status}
        </Text>
        {props.busy ? (
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
        ) : movable ? (
          <UpIcon name="chevrons-up-down" size={15} tintColorClassName="accent-icon-muted" />
        ) : null}
      </View>
    </Pressable>
  );
  if (!movable) return row;
  return (
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
      {row}
    </Menu>
  );
}

function SourceThreadRow(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  // The shell may leave the thread out; the chat route opens it either way.
  const thread = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  return (
    <DetailRow label={gt("Source thread")} onPress={() => props.onOpen(props.threadId)} chevron>
      <DetailValue className="text-primary-text">
        {thread?.title || gt("Source thread")}
      </DetailValue>
    </DetailRow>
  );
}

const ACTOR_LABELS = {
  person: msg("Person", { $context: "who changed a task: a person" }),
  "agent-run": msg("Worker run"),
  thread: msg("Chat agent"),
  server: msg("Server", { $context: "who changed a task: the Up.computer server" }),
} as const satisfies Record<TaskActor["type"], string>;

type WorkerOfRun = (runId: string) => string | null;

/** Who made a change; a worker run is named by its worker once the page's runs list it. */
function actorLabel(actor: TaskActor, workerOfRun: WorkerOfRun, resolve: MessageResolver) {
  const worker = actor.type === "agent-run" ? workerOfRun(actor.agentRunId) : null;
  return worker ?? resolve(ACTOR_LABELS[actor.type]);
}

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

function TaskHistorySection(props: {
  readonly records: readonly TaskHistoryRecord[] | null;
  readonly workerOfRun: WorkerOfRun;
}) {
  const gt = useGT();
  const messages = useMessages();
  return (
    <TaskPageSection title={gt("History")} count={props.records?.length}>
      {props.records === null ? (
        <Text className="px-1 text-base text-foreground-muted">
          {gt("Couldn't load the history.")}
        </Text>
      ) : props.records.length === 0 ? (
        <Text className="px-1 text-base text-foreground-muted">
          {gt("No status changes recorded yet.")}
        </Text>
      ) : (
        <GroupedCard>
          {props.records.map((record) => {
            const text = historyText(record, props.workerOfRun, gt, messages);
            return (
              <View key={record.id} className="gap-0.5 px-4 py-2.5">
                <View className="flex-row items-baseline gap-3">
                  <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={2}>
                    {text.title}
                  </Text>
                  <Text className="shrink-0 text-sm text-foreground-tertiary">
                    {relativeTime(record.at, undefined, messages)}
                  </Text>
                </View>
                <Text selectable className="text-sm text-foreground-muted">
                  {text.detail}
                </Text>
              </View>
            );
          })}
        </GroupedCard>
      )}
    </TaskPageSection>
  );
}
