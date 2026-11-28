import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { canStopRun } from "@t3tools/tasks-client/runs/taskRuns";
import type { TaskAgentRun } from "@t3tools/tasks-contracts/v1";
import { useGT, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { UpIcon } from "../../components/up-icons/UpIcon";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useServerConfigs } from "../../state/entities";
import { modelSelectionLabel } from "../workers/modelLabel";
import { GroupedCard, TaskPageSection } from "./TaskDetailFields";
import { taskRunPresentation } from "./taskPresentation";
import { readTasksClient } from "./tasksRpc";
import type { TaskRunsData } from "./useTaskRuns";

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The desktop's Runs section of a task page: each run's state, worker and model, newest first. A
 * run opens its chat; its menu messages it, and stops it while it is active.
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
  if (data.status === "unavailable") return null;
  const filterLabel =
    props.filter === null ? null : (taskRunPresentation(props.filter, messages)?.label ?? null);
  const note = (text: string) => (
    <Text className="px-1 text-base text-foreground-muted">{text}</Text>
  );
  return (
    <TaskPageSection
      title={gt("Runs", { $context: "noun: a task's worker runs" })}
      count={data.runs.length}
    >
      <View className="gap-2">
        {filterLabel !== null ? (
          <View className="flex-row items-center justify-between gap-3 px-1">
            <Text className="text-base text-foreground">{filterLabel}</Text>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={props.onShowAll}>
              <Text className="text-base text-primary-text">{gt("Show all runs")}</Text>
            </Pressable>
          </View>
        ) : null}
        {data.status === "loading" && data.runs.length === 0 ? (
          <View className="flex-row items-center gap-2 px-1">
            <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
            <Text className="text-base text-foreground-muted">{gt("Loading worker runs...")}</Text>
          </View>
        ) : data.status === "error" && data.runs.length === 0 ? (
          note(gt("Could not refresh runs."))
        ) : data.runs.length === 0 ? (
          note(
            props.filter === null
              ? gt("No worker has worked on this task yet.")
              : gt("No runs match this status."),
          )
        ) : (
          <>
            {data.status === "error" ? note(gt("Could not refresh runs.")) : null}
            <GroupedCard>
              {data.runs.map((run) => (
                <TaskRunRow
                  key={run.id}
                  environmentId={props.environmentId}
                  run={run}
                  workerName={data.workers.get(String(run.agentId))?.name ?? null}
                  canMutate={props.canMutate}
                  onChanged={data.refresh}
                />
              ))}
            </GroupedCard>
          </>
        )}
        {data.hasMore ? (
          <Pressable
            accessibilityRole="button"
            disabled={data.status === "loading"}
            className="min-h-11 justify-center self-start px-1 active:opacity-60"
            onPress={data.loadMore}
          >
            <Text className="text-base text-primary-text">{gt("Load more runs")}</Text>
          </Pressable>
        ) : null}
      </View>
    </TaskPageSection>
  );
}

function TaskRunRow(props: {
  readonly environmentId: EnvironmentId;
  readonly run: TaskAgentRun;
  readonly workerName: string | null;
  readonly canMutate: boolean;
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const providers = useServerConfigs().get(props.environmentId)?.providers ?? [];
  const { run } = props;
  const state = taskRunPresentation(run.status, messages);
  const stateLabel = state?.label ?? run.status;
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
    <View className="flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[stateLabel, worker, model, times].join(", ")}
        accessibilityHint={gt("Opens the worker's chat for this run")}
        onPress={openChat}
        className={cn(
          "min-h-14 min-w-0 flex-1 flex-row items-center gap-3 py-2.5 pl-4 active:bg-foreground/5",
          props.canMutate ? "pr-1" : "pr-4",
        )}
      >
        <UpIcon
          name={state?.icon ?? "circle-dashed"}
          size={19}
          tintColorClassName={state?.tint ?? "accent-icon-muted"}
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-base text-foreground">
            {worker}
          </Text>
          <Text numberOfLines={1} className="text-sm text-foreground-muted">
            <Text className={state?.text ?? "text-foreground-muted"}>{stateLabel}</Text>
            {model ? ` · ${model}` : ""}
          </Text>
        </View>
        <Text className="shrink-0 text-sm text-foreground-tertiary">
          {relativeTime(run.startedAt, undefined, messages)}
        </Text>
        {props.canMutate ? null : (
          <UpIcon name="chevron-right" size={15} tintColorClassName="accent-icon-muted" />
        )}
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
            className="size-11 items-center justify-center active:opacity-60"
          >
            <UpIcon name="more-horizontal" size={19} tintColorClassName="accent-icon-muted" />
          </Pressable>
        </Menu>
      ) : null}
    </View>
  );
}
