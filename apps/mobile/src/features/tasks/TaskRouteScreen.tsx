import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { taskHistoryRecords, type TaskHistoryRecord } from "@t3tools/tasks-client/taskHistory";
import {
  PERSON_DONE_STATUS,
  PERSON_OPEN_STATUS,
  TaskId,
  type TaskActor,
  type TaskAgentRun,
} from "@t3tools/tasks-contracts/v1";
import { msg, useGT, useMessages } from "gt-react-native";
import { Children, Fragment, isValidElement, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { UpIcon } from "../../components/up-icons/UpIcon";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { ScreenContent } from "../../components/ui/ScreenContent";
import type { MessageResolver } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { relativeTime } from "../../lib/time";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useAndroidWorkspaceBack } from "../layout/workspace/useAndroidWorkspaceNavigation";
import { TaskMarkdown } from "./TaskMarkdown";
import { taskStatusChoices } from "./taskListState";
import { taskRunPresentation, taskStatusTone } from "./taskPresentation";
import { TaskTagChip } from "./TaskTagChip";
import { readTasksClient, useTasksAccess } from "./tasksRpc";
import { useTaskDetail, useTaskWorkflow, type TaskDetailRun } from "./useTasks";

export type TaskRouteParams = {
  readonly environmentId: string;
  readonly taskId: string;
  /** The row's title, shown while the task loads. */
  readonly title?: string;
};

// Selecting another task reuses this route, so its busy state and errors are keyed.
export function TaskRouteScreen({ route }: StaticScreenProps<TaskRouteParams>) {
  return (
    <TaskRoute key={`${route.params.environmentId}:${route.params.taskId}`} params={route.params} />
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
  const task = detail.task;
  const project = useProjects().find(
    (entry) => entry.environmentId === environmentId && entry.id === task?.projectId,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const canEdit = connected && access?.canMutateTasks === true && task !== null;

  const moveTo = async (status: string) => {
    if (!task || busy || status === task.status) return;
    setBusy(true);
    setMutationError(null);
    await readTasksClient(environmentId)
      .tasks.update({ id: task.id, status })
      .then(detail.applyLocal, (cause: unknown) =>
        setMutationError(cause instanceof Error ? cause.message : String(cause)),
      );
    setBusy(false);
  };
  const openThread = (threadId: ThreadId) =>
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(environmentId),
        threadId: String(threadId),
      }),
    );
  const openTranscript = (run: TaskAgentRun) => openThread(run.threadId);
  const output =
    task !== null && task.output !== null && task.output.trim() !== "" ? task.output : null;
  const cwd = project?.workspaceRoot ?? null;

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
              ...(detail.latestRun
                ? [
                    {
                      id: "transcript",
                      title: gt("Open worker transcript"),
                      icon: "text.bubble",
                      onPress: () => openTranscript(detail.latestRun!),
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
                onPress: () => void detail.refresh(),
              },
            ],
          },
        ]}
      />
      <ScreenContent>
        <NativeScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void detail.refresh().finally(() => setRefreshing(false));
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
                <Text selectable className="text-[22px] font-t3-bold leading-7 text-foreground">
                  {task.title}
                </Text>
                {task.archivedAt ? (
                  <Text className="text-sm text-foreground-muted">
                    {gt("Archived", { $context: "status of an archived task" })}
                  </Text>
                ) : null}
              </View>

              {/* As on the desktop: collapsed when the task has output. */}
              <TaskPageSection title={gt("Description")} defaultOpen={output === null}>
                {task.description.trim() === "" ? (
                  <Text className="px-1 text-base text-foreground-muted">
                    {gt("No description", { $context: "a task has no description" })}
                  </Text>
                ) : (
                  <View className="px-1">
                    <TaskMarkdown
                      markdown={task.description}
                      environmentId={environmentId}
                      cwd={cwd}
                    />
                  </View>
                )}
              </TaskPageSection>

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
                    choices={
                      !canEdit
                        ? []
                        : task.audience === "person"
                          ? [PERSON_OPEN_STATUS, PERSON_DONE_STATUS]
                          : workflow.version !== null
                            ? taskStatusChoices(workflow.version, task.status)
                            : []
                    }
                    busy={busy}
                    onMove={(status) => void moveTo(status)}
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
                    <DetailRow label={gt("Tags")}>
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
                {mutationError ? (
                  <Text selectable className="px-4 pt-2 text-sm text-danger-foreground">
                    {mutationError}
                  </Text>
                ) : null}
                {workflow.error && task.audience !== "person" ? (
                  <Text selectable className="px-4 pt-2 text-xs text-foreground-muted">
                    {gt("Couldn't load this computer's task statuses: {error}", {
                      error: workflow.error,
                    })}
                  </Text>
                ) : null}
              </TaskPageSection>

              <TaskPageSection
                title={gt("Runs", { $context: "noun: a task's worker runs" })}
                count={detail.runs.length}
              >
                <TaskRunList runs={detail.runs} onOpen={openTranscript} />
              </TaskPageSection>

              <TaskHistorySection
                records={detail.events === null ? null : taskHistoryRecords(detail.events)}
                worker={{
                  runId: detail.latestRun?.id ?? null,
                  name: detail.worker?.name ?? null,
                }}
              />
            </View>
          )}
        </NativeScrollView>
      </ScreenContent>
    </View>
  );
}

/**
 * The desktop's collapsible detail section in the Tasks list's group header type: the name, a
 * chevron, and the count at the end.
 */
function TaskPageSection(props: {
  readonly title: string;
  readonly count?: number;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          props.count === undefined ? props.title : `${props.title}, ${props.count}`
        }
        accessibilityHint={open ? gt("Hides the section") : gt("Shows the section")}
        onPress={() => setOpen(!open)}
        className="min-h-11 flex-row items-center gap-2 px-1 active:opacity-60"
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
          <Text
            className="shrink text-base font-t3-medium text-foreground-tertiary"
            numberOfLines={1}
          >
            {props.title}
          </Text>
          <UpIcon
            name={open ? "chevron-down" : "chevron-right"}
            size={17}
            tintColorClassName="accent-icon-muted"
          />
        </View>
        {props.count === undefined ? null : (
          <Text className="text-base tabular-nums text-foreground-tertiary">{props.count}</Text>
        )}
      </Pressable>
      {open ? <View className="pb-3 pt-1">{props.children}</View> : null}
    </View>
  );
}

/** An iOS inset grouped card whose rows are split by hairlines. */
function GroupedCard(props: { readonly children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-[14px] border-continuous bg-grouped-card">
      {Children.toArray(props.children).map((row, index) => (
        <Fragment key={isValidElement(row) && row.key !== null ? row.key : index}>
          {index > 0 ? (
            <View className="ml-4 bg-separator" style={{ height: StyleSheet.hairlineWidth }} />
          ) : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

function DetailRow(props: {
  readonly label: string;
  readonly children: ReactNode;
  readonly onPress?: () => void;
}) {
  const content = (
    <View className="min-h-11 flex-row items-center gap-3 px-4 py-2.5">
      <Text className="shrink-0 text-base text-foreground" numberOfLines={1}>
        {props.label}
      </Text>
      <View className="min-w-0 flex-1 flex-row items-center justify-end">{props.children}</View>
    </View>
  );
  if (!props.onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="active:bg-foreground/5"
    >
      {content}
    </Pressable>
  );
}

function DetailValue(props: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <Text
      numberOfLines={1}
      className={cn("shrink text-right text-base text-foreground-secondary", props.className)}
    >
      {props.children}
    </Text>
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
    <DetailRow label={gt("Source thread")} onPress={() => props.onOpen(props.threadId)}>
      <View className="min-w-0 shrink flex-row items-center gap-1">
        <DetailValue className="text-primary-text">
          {thread?.title || gt("Source thread")}
        </DetailValue>
        <UpIcon name="chevron-right" size={15} tintColorClassName="accent-icon-muted" />
      </View>
    </DetailRow>
  );
}

/** The desktop's Runs section: each run's state and worker, newest first; a tap opens its chat. */
function TaskRunList(props: {
  readonly runs: readonly TaskDetailRun[];
  readonly onOpen: (run: TaskAgentRun) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  if (props.runs.length === 0) {
    return (
      <Text className="px-1 text-base text-foreground-muted">
        {gt("No worker has worked on this task yet.")}
      </Text>
    );
  }
  return (
    <GroupedCard>
      {props.runs.map(({ run, worker }) => {
        const state = taskRunPresentation(run.status, messages);
        const name = worker?.name ?? gt("Worker run");
        return (
          <Pressable
            key={run.id}
            accessibilityRole="button"
            accessibilityLabel={[state?.label ?? run.status, name].join(", ")}
            accessibilityHint={gt("Opens the worker's chat for this run")}
            onPress={() => props.onOpen(run)}
            className="min-h-14 flex-row items-center gap-3 px-4 py-2.5 active:bg-foreground/5"
          >
            <UpIcon
              name={state?.icon ?? "hammer"}
              size={19}
              tintColorClassName={state?.tint ?? "accent-icon-muted"}
            />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text numberOfLines={1} className="text-base text-foreground">
                {name}
              </Text>
              <Text
                numberOfLines={1}
                className={cn("text-sm", state?.text ?? "text-foreground-muted")}
              >
                {state?.label ?? run.status}
              </Text>
            </View>
            <Text className="shrink-0 text-sm text-foreground-tertiary">
              {relativeTime(run.startedAt, undefined, messages)}
            </Text>
            <UpIcon name="chevron-right" size={15} tintColorClassName="accent-icon-muted" />
          </Pressable>
        );
      })}
    </GroupedCard>
  );
}

const ACTOR_LABELS = {
  person: msg("Person", { $context: "who changed a task: a person" }),
  "agent-run": msg("Worker run"),
  thread: msg("Chat agent"),
  server: msg("Server", { $context: "who changed a task: the Up.computer server" }),
} as const satisfies Record<TaskActor["type"], string>;

/** Who made a change; a worker run is named only when it is the run this page shows. */
function actorLabel(actor: TaskActor, latest: LatestWorker, resolve: MessageResolver) {
  if (actor.type === "agent-run" && actor.agentRunId === latest.runId && latest.name !== null)
    return latest.name;
  return resolve(ACTOR_LABELS[actor.type]);
}

interface LatestWorker {
  readonly runId: string | null;
  readonly name: string | null;
}

function historyText(
  record: TaskHistoryRecord,
  worker: LatestWorker,
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
  readonly worker: LatestWorker;
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
            const text = historyText(record, props.worker, gt, messages);
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
