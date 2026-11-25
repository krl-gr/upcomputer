import type { ScopedTaskListItem } from "@t3tools/tasks-client/state/taskPages";
import { useGT, useMessages } from "gt-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import {
  selectedThreadRowColors,
  THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE,
  THREAD_LIST_V2_SIDEBAR_ROW_STYLE,
} from "../threads/thread-list-v2-row-appearance";
import { taskRunPresentation, taskStatusTone } from "./taskPresentation";

export const TaskListRow = memo(function TaskListRow(props: {
  readonly task: ScopedTaskListItem;
  readonly projectName: string | null;
  readonly onSelect: (task: ScopedTaskListItem) => void;
  readonly selected: boolean;
  readonly sidebar: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { task } = props;
  const status = taskStatusTone(task.status);
  const run = taskRunPresentation(task.latestRunStatus, messages);
  const foreground = props.selected
    ? selectedThreadRowColors.foregroundClassName
    : props.sidebar
      ? "text-drawer-foreground"
      : "text-foreground";
  const muted = props.selected
    ? selectedThreadRowColors.mutedForegroundClassName
    : props.sidebar
      ? "text-drawer-foreground-muted"
      : "text-foreground-muted";
  return (
    <View style={props.sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: props.selected }}
        accessibilityLabel={[
          task.title,
          task.status,
          props.projectName,
          run ? gt("Worker: {state}", { state: run.label }) : null,
          task.tags.length ? task.tags.join(", ") : null,
        ]
          .filter(Boolean)
          .join(", ")}
        onPress={() => props.onSelect(task)}
        style={props.sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_STYLE : undefined}
        className={cn(
          "flex-row gap-3 overflow-hidden",
          !props.sidebar && "px-4 active:bg-row-hover",
          props.sidebar && "bg-drawer",
          props.sidebar && !props.selected && "active:bg-thread-hover",
          props.selected && "bg-thread-selected",
        )}
      >
        <View className={cn("self-start", props.sidebar ? "pt-0.5" : "pt-2.5")}>
          <SymbolView name={status.icon} size={20} tintColorClassName={status.tint} />
        </View>
        <View
          className={cn(
            "min-w-0 flex-1 gap-1",
            !props.sidebar && "border-b border-border-subtle py-2.5",
          )}
        >
          <View className="flex-row items-center gap-1.5">
            <Text className={cn("min-w-0 flex-1 text-xs", muted)} numberOfLines={1}>
              {props.projectName ?? gt("Unknown project")}
            </Text>
            <Text className={cn("text-2xs tabular-nums", muted)}>
              <RelativeTime timestamp={task.updatedAt} />
            </Text>
          </View>
          <Text
            className={cn("text-base leading-5 font-t3-medium", foreground)}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {task.title}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className={cn("shrink-0 text-2xs font-t3-medium", status.text)}>
              {task.status}
            </Text>
            {run ? (
              <View className="shrink-0 flex-row items-center gap-1">
                <SymbolView name={run.icon} size={11} tintColorClassName={run.tint} />
                <Text className={cn("text-2xs font-t3-medium", run.text)}>{run.label}</Text>
              </View>
            ) : null}
            <View className="min-w-0 flex-1 flex-row items-center gap-1">
              {task.tags.slice(0, 2).map((tag) => (
                <Text
                  key={tag}
                  numberOfLines={1}
                  className={cn("shrink rounded-md bg-subtle px-1.5 py-px text-2xs", muted)}
                >
                  {tag}
                </Text>
              ))}
              {task.tags.length > 2 ? (
                <Text className={cn("shrink-0 text-2xs", muted)}>+{task.tags.length - 2}</Text>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
});
