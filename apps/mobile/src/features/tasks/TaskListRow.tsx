import type { MenuAction } from "@react-native-menu/menu";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedTaskListItem } from "@t3tools/tasks-client/state/taskPages";
import { useGT, useMessages } from "gt-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { cn } from "../../lib/cn";
import { TaskProjectBadge } from "./TaskProjectBadge";
import { taskRunCounts, taskRunPresentation, type TaskRunCount } from "./taskPresentation";
import { TaskTagChip } from "./TaskTagChip";

/** One size for the badge and the run counts, level with the title's first line. */
const ROW_MARK_SIZE = 24;
/** The tags start under the title, past the badge and the gap after it. */
const TAGS_INSET = ROW_MARK_SIZE + 12;

const STATUS_PREFIX = "status:";

/**
 * A worker task in the desktop's narrow table: project badge, title, tags under it, and the
 * run counts at the end, on an inset rounded card. A long press opens the status choices of
 * the desktop's status select and the task page's Copy task ID.
 */
export const TaskListRow = memo(function TaskListRow(props: {
  readonly task: ScopedTaskListItem;
  readonly project: EnvironmentProject | null;
  readonly onSelect: (task: ScopedTaskListItem) => void;
  /** The statuses a long press offers, in the workflow's order; empty when the task can't move. */
  readonly statusChoices: readonly string[];
  readonly onMoveStatus: (task: ScopedTaskListItem, status: string) => void;
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
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={[
        task.title,
        props.project?.title ?? gt("Unknown project"),
        task.status,
        archived ? gt("Archived", { $context: "status of an archived task" }) : null,
        runCounts.length > 0
          ? gt("Runs: {counts}", {
              counts: runCounts.map((count) => `${count.label} ${count.count}`).join(", "),
            })
          : run
            ? gt("Worker: {state}", { state: run.label })
            : null,
        task.tags.length ? task.tags.join(", ") : null,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={gt("Touch and hold for actions.")}
      onPress={() => props.onSelect(task)}
      className={cn(
        "gap-1.5 rounded-xl border-continuous px-3 py-2.5",
        props.selected ? "bg-foreground/8" : "active:bg-foreground/5",
      )}
    >
      <View className="flex-row items-center gap-3">
        <TaskProjectBadge
          environmentId={task.environmentId}
          project={props.project}
          size={ROW_MARK_SIZE}
        />
        <Text
          className={cn(
            "min-w-0 flex-1 text-base leading-[21px]",
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
        {runCounts.length > 0 ? (
          <TaskRunCountBox counts={runCounts} />
        ) : run ? (
          <View
            style={{ height: ROW_MARK_SIZE }}
            className="justify-center rounded-full border border-border px-2"
          >
            <Text className={cn("text-xs font-t3-medium", run.text)}>{run.label}</Text>
          </View>
        ) : null}
      </View>
      {task.tags.length > 0 || archived ? (
        <View
          style={{ paddingLeft: TAGS_INSET }}
          className="flex-row flex-wrap items-center gap-1.5"
        >
          {archived ? (
            <Text className="text-xs text-foreground-muted">
              {gt("Archived", { $context: "status of an archived task" })}
            </Text>
          ) : null}
          {task.tags.map((tag) => (
            <TaskTagChip key={tag} tag={tag} />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
  const actions: MenuAction[] = [
    ...(props.statusChoices.length > 0
      ? [
          {
            id: "status",
            title: gt("Status"),
            subtitle: task.status,
            image: "circle.dashed",
            // The status name is the id: statuses are unique within a workflow.
            subactions: props.statusChoices.map((status) => ({
              id: `${STATUS_PREFIX}${status}`,
              title: status,
              state: status === task.status ? ("on" as const) : ("off" as const),
            })),
          },
        ]
      : []),
    { id: "copy-id", title: gt("Copy task ID"), image: "doc.on.doc" },
  ];
  return (
    <View className="px-2 py-px">
      <Menu
        accessibilityLabel={task.title}
        actions={actions}
        onPressAction={({ nativeEvent }) => {
          const event = nativeEvent.event;
          if (event === "copy-id") copyTextWithHaptic(String(task.id));
          if (!event.startsWith(STATUS_PREFIX)) return;
          const status = event.slice(STATUS_PREFIX.length);
          if (status !== task.status && props.statusChoices.includes(status))
            props.onMoveStatus(task, status);
        }}
        shouldOpenOnLongPress
      >
        {row}
      </Menu>
    </View>
  );
});

/** The desktop's Runs column: each state's count in its colour, in one hairline capsule. */
function TaskRunCountBox(props: { readonly counts: readonly TaskRunCount[] }) {
  return (
    <View
      style={{ height: ROW_MARK_SIZE, minWidth: ROW_MARK_SIZE }}
      className="flex-row items-center justify-center gap-2 rounded-full border border-border px-2"
    >
      {props.counts.map((count) => (
        <Text
          key={count.label}
          className={cn("text-sm font-t3-medium tabular-nums leading-4", count.text)}
        >
          {count.count}
        </Text>
      ))}
    </View>
  );
}
