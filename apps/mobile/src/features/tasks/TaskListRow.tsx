import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedTaskListItem } from "@t3tools/tasks-client/state/taskPages";
import { useGT, useMessages } from "gt-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { TaskProjectBadge } from "./TaskProjectBadge";
import { taskRunCounts, taskRunPresentation } from "./taskPresentation";

/**
 * A worker task in the desktop's narrow table: project badge, title, tags under it, and the
 * run counts at the end. The status group above names the status. The counts sit beside the
 * row's button: a tap opens the task on the runs in that state, as a click on one does there.
 */
export const TaskListRow = memo(function TaskListRow(props: {
  readonly task: ScopedTaskListItem;
  readonly project: EnvironmentProject | null;
  readonly onSelect: (task: ScopedTaskListItem, runStatus?: string) => void;
  readonly selected: boolean;
  readonly sidebar: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { task } = props;
  const runCounts = taskRunCounts(task.runCounts, messages);
  // An older server only names the latest run.
  const run = runCounts.length > 0 ? null : taskRunPresentation(task.latestRunStatus, messages);
  const archived = task.archivedAt !== null;
  const countsLabel = gt("Runs: {counts}", {
    counts: runCounts.map((count) => `${count.label} ${count.count}`).join(", "),
  });
  const pill =
    runCounts.length > 0 || run ? (
      <View className="flex-row items-center gap-2 rounded-lg border border-border px-2 py-1">
        {runCounts.length > 0 ? (
          runCounts.map((count) => (
            <Text
              key={count.label}
              className={cn("text-sm font-t3-medium tabular-nums", count.text)}
            >
              {count.count}
            </Text>
          ))
        ) : run ? (
          <Text className={cn("text-xs font-t3-medium", run.text)}>{run.label}</Text>
        ) : null}
      </View>
    ) : null;
  return (
    <View className={cn("flex-row items-start", props.selected ? "bg-thread-selected" : null)}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: props.selected }}
        accessibilityLabel={[
          task.title,
          props.project?.title ?? gt("Unknown project"),
          archived ? gt("Archived", { $context: "status of an archived task" }) : null,
          runCounts.length > 0
            ? countsLabel
            : run
              ? gt("Worker: {state}", { state: run.label })
              : null,
          task.tags.length ? task.tags.join(", ") : null,
        ]
          .filter(Boolean)
          .join(", ")}
        onPress={() => props.onSelect(task)}
        className={cn(
          "min-w-0 flex-1 flex-row items-start gap-3 py-2.5 pl-4",
          pill ? "pr-2" : "pr-4",
          props.selected ? null : props.sidebar ? "active:bg-thread-hover" : "active:bg-row-hover",
        )}
      >
        <View className="pt-px">
          <TaskProjectBadge environmentId={task.environmentId} project={props.project} size={22} />
        </View>
        <View className="min-w-0 flex-1 gap-1.5">
          <Text
            className={cn(
              "text-base leading-5",
              archived
                ? "text-foreground-muted"
                : props.sidebar
                  ? "text-drawer-foreground"
                  : "text-foreground",
            )}
            numberOfLines={3}
          >
            {task.title}
          </Text>
          {task.tags.length > 0 || archived ? (
            <View className="flex-row flex-wrap items-center gap-1.5">
              {archived ? (
                <Text className="text-xs text-foreground-muted">
                  {gt("Archived", { $context: "status of an archived task" })}
                </Text>
              ) : null}
              {task.tags.map((tag) => (
                <Text
                  key={tag}
                  numberOfLines={1}
                  className="rounded-md bg-subtle px-1.5 py-px text-xs text-foreground-muted"
                >
                  {tag}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
      {pill === null ? null : runCounts.length > 1 ? (
        <Menu
          title={gt("Runs", { $context: "noun: a task's worker runs" })}
          actions={[
            ...runCounts.map((count) => ({
              id: count.status,
              title: count.label,
              subtitle: String(count.count),
            })),
            { id: "", title: gt("Show all runs") },
          ]}
          onPressAction={({ nativeEvent }) =>
            props.onSelect(task, nativeEvent.event === "" ? undefined : nativeEvent.event)
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={countsLabel}
            accessibilityHint={gt("Shows this task's runs")}
            className="py-2.5 pl-1 pr-4 active:opacity-60"
          >
            {pill}
          </Pressable>
        </Menu>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            runCounts.length > 0 ? countsLabel : gt("Worker: {state}", { state: run!.label })
          }
          accessibilityHint={gt("Shows this task's runs")}
          onPress={() => props.onSelect(task, runCounts[0]?.status)}
          className="py-2.5 pl-1 pr-4 active:opacity-60"
        >
          {pill}
        </Pressable>
      )}
    </View>
  );
});
