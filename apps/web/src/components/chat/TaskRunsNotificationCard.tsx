import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, OrchestrationV2NotificationSource } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ChevronRightIcon, CircleCheckIcon } from "lucide-react";

import { formatShortTimestamp } from "../../timestampFormat";

type TaskRunsSource = Extract<OrchestrationV2NotificationSource, { kind: "task_agent_run" }>;

/**
 * The card a chat shows when its tasks finished without needing its agent: each task with
 * its status then, opening it on the Tasks page.
 */
export function TaskRunsNotificationCard(props: {
  readonly environmentId: EnvironmentId;
  readonly tasks: TaskRunsSource["tasks"];
  readonly createdAt: string;
  readonly timestampFormat: TimestampFormat;
}) {
  const navigate = useNavigate();
  const count = props.tasks.length;
  return (
    <div
      data-v2-item-type="notification"
      className="rounded-md border border-border/70 px-2 py-1.5"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {count === 1 ? "1 task done" : `${count} tasks done`}
        </span>
        <span className="shrink-0 font-mono text-3xs text-muted-foreground/80">
          {formatShortTimestamp(props.createdAt, props.timestampFormat)}
        </span>
      </div>
      <ul className="mt-1 flex flex-col">
        {props.tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              aria-label={`Open task ${task.title}`}
              onClick={() =>
                void navigate({
                  to: "/tasks",
                  search: { task: `${props.environmentId}:${task.id}` },
                } as never)
              }
              className="group/task flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm py-1 ps-6 pe-0.5 text-left transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            >
              <span className="min-w-0 flex-1 truncate text-2xs text-foreground">{task.title}</span>
              {task.status === undefined ? null : (
                <span className="shrink-0 text-3xs text-muted-foreground">{task.status}</span>
              )}
              <ChevronRightIcon
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/task:text-foreground"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
