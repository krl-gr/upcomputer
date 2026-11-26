import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { canStopRun } from "@t3tools/tasks-client/runs/taskRuns";
import type { TaskAgentRun } from "@t3tools/tasks-contracts/v1";
import { useGT, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useServerConfigs } from "../../state/entities";
import { PullRequestSectionHeading } from "../pull-requests/PullRequestSectionHeading";
import { modelSelectionLabel } from "../workers/modelLabel";
import { taskRunPresentation } from "./taskPresentation";
import { readTasksClient } from "./tasksRpc";
import type { TaskRunsData } from "./useTaskRuns";

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The desktop's Runs section of a task page: each run's state, worker, model and times, newest
 * first. A run opens its chat; its menu messages it, and stops it while it is active.
 */
export function TaskRunsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly data: TaskRunsData;
  /** The run-count status a run count opened the page with; null shows every run. */
  readonly filter: string | null;
  readonly onShowAll: () => void;
  readonly canMutate: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { data } = props;
  const filterLabel =
    props.filter === null ? null : (taskRunPresentation(props.filter, messages)?.label ?? null);
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline gap-2">
        <PullRequestSectionHeading>
          {gt("Runs", { $context: "noun: a task's worker runs" })}
        </PullRequestSectionHeading>
        {data.runs.length > 0 ? (
          <Text className="text-sm text-foreground-muted tabular-nums">{data.runs.length}</Text>
        ) : null}
      </View>
      {filterLabel !== null ? (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-sm text-foreground">{filterLabel}</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={props.onShowAll}>
            <Text className="text-sm text-primary-text">{gt("Show all runs")}</Text>
          </Pressable>
        </View>
      ) : null}
      {data.status === "loading" && data.runs.length === 0 ? (
        <View className="flex-row items-center gap-2 py-1">
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
          <Text className="text-sm text-foreground-muted">{gt("Loading worker runs...")}</Text>
        </View>
      ) : data.status === "error" && data.runs.length === 0 ? (
        <Text className="text-sm text-foreground-muted">{gt("Could not refresh runs.")}</Text>
      ) : data.runs.length === 0 ? (
        <Text className="text-sm text-foreground-muted">
          {props.filter === null
            ? gt("No worker has worked on this task yet.")
            : gt("No runs match this status.")}
        </Text>
      ) : (
        <>
          {data.status === "error" ? (
            <Text className="text-sm text-foreground-muted">{gt("Could not refresh runs.")}</Text>
          ) : null}
          <View className="overflow-hidden rounded-2xl bg-grouped-card">
            {data.runs.map((run, index) => (
              <TaskRunRow
                key={run.id}
                environmentId={props.environmentId}
                run={run}
                workerName={data.workers.get(String(run.agentId))?.name ?? null}
                first={index === 0}
                canMutate={props.canMutate}
                onChanged={data.refresh}
              />
            ))}
          </View>
        </>
      )}
      {data.hasMore ? (
        <Pressable
          accessibilityRole="button"
          disabled={data.status === "loading"}
          className="self-start py-2"
          onPress={data.loadMore}
        >
          <Text className="text-sm text-primary-text">{gt("Load more runs")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TaskRunRow(props: {
  readonly environmentId: EnvironmentId;
  readonly run: TaskAgentRun;
  readonly workerName: string | null;
  readonly first: boolean;
  readonly canMutate: boolean;
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const providers = useServerConfigs().get(props.environmentId)?.providers ?? [];
  const { run } = props;
  const state = taskRunPresentation(run.status, messages);
  const worker = props.workerName ?? gt("Worker run");
  const model = modelSelectionLabel(providers, run.modelSelection);
  const times = run.completedAt
    ? gt("Started {started}, ended {ended}", {
        started: relativeTime(run.startedAt, undefined, messages),
        ended: relativeTime(run.completedAt, undefined, messages),
      })
    : gt("Started {started}", { started: relativeTime(run.startedAt, undefined, messages) });
  const stoppable = props.canMutate && canStopRun(run);

  const openChat = () =>
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(props.environmentId),
        threadId: String(run.threadId),
      }),
    );
  const message = () =>
    navigation.dispatch(
      StackActions.push("TaskRunMessage", {
        environmentId: String(props.environmentId),
        runId: String(run.id),
        worker,
        active: run.completedAt === null,
      }),
    );
  const stop = () =>
    Dialog.confirm({
      title: gt("Stop this run?"),
      message: gt("{worker} stops working on this task now.", { worker }),
      confirmText: gt("Stop", { $context: "button that stops a worker run" }),
      destructive: true,
      onConfirm: () =>
        void readTasksClient(props.environmentId)
          .agents.stopRun({ id: run.id })
          .then(props.onChanged, (cause: unknown) =>
            Dialog.alert(gt("Couldn't stop the run"), errorText(cause)),
          ),
    });

  return (
    <View
      className={cn("flex-row items-center", props.first ? null : "border-t border-border-subtle")}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[state?.label ?? run.status, worker, model, times].join(", ")}
        accessibilityHint={gt("Opens the worker's chat for this run")}
        onPress={openChat}
        className="min-w-0 flex-1 gap-0.5 py-2.5 pl-4 pr-2 active:bg-row-hover"
      >
        <View className="flex-row items-center gap-1.5">
          {state ? (
            <SymbolView name={state.icon} size={14} tintColorClassName={state.tint} />
          ) : null}
          <Text className={cn("text-sm font-t3-medium", state?.text ?? "text-foreground")}>
            {state?.label ?? run.status}
          </Text>
          <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
            {worker}
          </Text>
        </View>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {model}
        </Text>
        <Text className="text-xs text-foreground-muted">{times}</Text>
      </Pressable>
      {props.canMutate ? (
        <Menu
          title={worker}
          actions={[
            { id: "open", title: gt("Open chat"), image: "text.bubble" },
            {
              id: "message",
              title: gt("Message", { $context: "menu item: send a message to a worker run" }),
              image: "paperplane",
            },
            ...(stoppable
              ? [
                  {
                    id: "stop",
                    title: gt("Stop", { $context: "button that stops a worker run" }),
                    image: "stop.circle",
                    attributes: { destructive: true },
                  },
                ]
              : []),
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "open") openChat();
            else if (nativeEvent.event === "message") message();
            else if (nativeEvent.event === "stop") stop();
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Run actions, {worker}", { worker })}
            hitSlop={6}
            className="size-11 items-center justify-center"
          >
            <SymbolView name="ellipsis.circle" size={20} tintColorClassName="accent-icon-muted" />
          </Pressable>
        </Menu>
      ) : null}
    </View>
  );
}
