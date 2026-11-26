import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { taskHistoryRecords, type TaskHistoryRecord } from "@t3tools/tasks-client/taskHistory";
import {
  TaskId,
  type TaskActor,
  type TaskAgent,
  type TaskAgentRun,
} from "@t3tools/tasks-contracts/v1";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
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
import { TaskMarkdown } from "./TaskMarkdown";
import { taskStatusChoices } from "./taskListState";
import { taskRunPresentation, taskStatusTone } from "./taskPresentation";
import { readTasksClient, useTasksAccess } from "./tasksRpc";
import { useTaskDetail, useTaskWorkflow } from "./useTasks";

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
  const openTranscript = (run: TaskAgentRun) =>
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(environmentId),
        threadId: String(run.threadId),
      }),
    );
  const subtitle = [project?.title, environment?.environmentLabel, connected ? null : gt("Offline")]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={task?.title ?? params.title ?? gt("Task")}
        subtitle={subtitle}
        onBack={layout.usesSplitView ? undefined : returnToList}
        menus={[
          {
            title: gt("Task actions"),
            icon: "ellipsis",
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
            <View className="gap-5">
              <View className="gap-3">
                <TaskStatusControl
                  status={task.status}
                  choices={
                    canEdit && workflow.version !== null
                      ? taskStatusChoices(workflow.version, task.status)
                      : []
                  }
                  busy={busy}
                  onMove={(status) => void moveTo(status)}
                />
                {workflow.error ? (
                  <Text selectable className="text-xs text-foreground-muted">
                    {gt("Couldn't load this computer's task statuses: {error}", {
                      error: workflow.error,
                    })}
                  </Text>
                ) : null}
                <Text selectable className="text-xl font-t3-bold leading-7">
                  {task.title}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {gt("Updated {time}", {
                    time: relativeTime(task.updatedAt, undefined, messages),
                  })}
                </Text>
                {task.tags.length > 0 ? (
                  <View className="flex-row flex-wrap gap-1.5">
                    {task.tags.map((tag) => (
                      <Text
                        key={tag}
                        className="rounded-md bg-subtle px-2 py-0.5 text-xs text-foreground-muted"
                      >
                        {tag}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {mutationError ? (
                  <Text selectable className="text-sm text-danger-foreground">
                    {mutationError}
                  </Text>
                ) : null}
              </View>
              <TaskWorkerSection
                run={detail.latestRun}
                worker={detail.worker}
                onOpenTranscript={openTranscript}
              />
              <View className="gap-2">
                <PullRequestSectionHeading>{gt("Description")}</PullRequestSectionHeading>
                <TaskMarkdown
                  markdown={task.description}
                  environmentId={environmentId}
                  cwd={project?.workspaceRoot ?? null}
                />
              </View>
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
                <PullRequestSectionHeading>{gt("History")}</PullRequestSectionHeading>
                <TaskHistoryList
                  records={detail.events === null ? null : taskHistoryRecords(detail.events)}
                  worker={{
                    runId: detail.latestRun?.id ?? null,
                    name: detail.worker?.name ?? null,
                  }}
                />
              </View>
            </View>
          )}
        </NativeScrollView>
      </ScreenContent>
    </View>
  );
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

function TaskWorkerSection(props: {
  readonly run: TaskAgentRun | null;
  readonly worker: TaskAgent | null;
  readonly onOpenTranscript: (run: TaskAgentRun) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { run } = props;
  const state = run ? taskRunPresentation(run.status, messages) : null;
  return (
    <View className="gap-2">
      <PullRequestSectionHeading>{gt("Worker")}</PullRequestSectionHeading>
      {run === null ? (
        <Text className="text-sm text-foreground-muted">
          {gt("No worker has run on this task yet.")}
        </Text>
      ) : (
        <View className="gap-3 rounded-2xl bg-grouped-card p-4">
          <View className="flex-row items-center gap-2">
            {state ? (
              <SymbolView name={state.icon} size={16} tintColorClassName={state.tint} />
            ) : null}
            <Text className={`text-sm font-t3-semibold ${state?.text ?? "text-foreground"}`}>
              {state?.label ?? run.status}
            </Text>
            <Text
              className="min-w-0 flex-1 text-right text-xs text-foreground-muted"
              numberOfLines={1}
            >
              {props.worker?.name ??
                gt("Worker", { $context: "a task agent whose name is unknown" })}
            </Text>
          </View>
          <Text className="text-xs text-foreground-muted">
            {run.completedAt
              ? gt("Started {started}, ended {ended}", {
                  started: relativeTime(run.startedAt, undefined, messages),
                  ended: relativeTime(run.completedAt, undefined, messages),
                })
              : gt("Started {started}", {
                  started: relativeTime(run.startedAt, undefined, messages),
                })}
          </Text>
          <Button
            label={gt("Open transcript")}
            icon="text.bubble"
            accessibilityHint={gt("Opens the worker's chat for this run")}
            onPress={() => props.onOpenTranscript(run)}
          />
        </View>
      )}
    </View>
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

function TaskHistoryList(props: {
  readonly records: readonly TaskHistoryRecord[] | null;
  readonly worker: LatestWorker;
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
        const text = historyText(record, props.worker, gt, messages);
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
