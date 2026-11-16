import {
  TASK_ARCHIVED_EVENT,
  TASK_STATUS_CHANGED_EVENT,
  TASK_UNARCHIVED_EVENT,
  TaskArchiveChangedPayload,
  TaskStatusChangedPayload,
  type TaskActor,
  type TaskEvent,
} from "@t3tools/tasks-contracts/v1";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { gtFallback, useGT } from "gt-react";

export interface TaskHistoryEntry {
  readonly id: string;
  readonly title: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly at: string;
}

const decodeStatusChange = Schema.decodeUnknownOption(TaskStatusChangedPayload);
const decodeAgentNotice = Schema.decodeUnknownOption(
  Schema.Struct({ agentName: Schema.optional(Schema.String), reason: Schema.String }),
);

type GT = ReturnType<typeof useGT>;

/** Events that explain why an agent did not act, so a waiting task is not silent. */
function agentNoticeTitle(kind: string, gt: GT): string | undefined {
  if (kind === "task.agent-not-started") return gt("Didn't start");
  if (kind === "task.no-matching-agent") return gt("No worker will pick this up");
  return undefined;
}
const decodeArchiveChange = Schema.decodeUnknownOption(TaskArchiveChangedPayload);

function actorLabel(
  actor: TaskActor,
  agentNameForRun: (runId: string) => string | null,
  gt: GT,
): string {
  switch (actor.type) {
    case "person":
      return gt("Person");
    case "agent-run":
      return agentNameForRun(actor.agentRunId) ?? gt("Worker run");
    case "thread":
      return gt("Chat agent");
    case "server":
      return gt("Server");
  }
}

/**
 * The task's status and archive history and why agents did not start, newest
 * first, as the server recorded it. Other event kinds and unreadable payloads
 * are left out. Components pass their `useGT()`; without it the labels stay English.
 */
export function taskHistoryEntries(
  events: ReadonlyArray<TaskEvent>,
  agentNameForRun: (runId: string) => string | null,
  gt: GT = gtFallback,
): TaskHistoryEntry[] {
  return events.flatMap((event): TaskHistoryEntry[] => {
    if (event.kind === TASK_STATUS_CHANGED_EVENT) {
      return Option.match(decodeStatusChange(event.payload), {
        onNone: () => [],
        onSome: ({ from, to, actor }) => [
          {
            id: event.id,
            title: `${from} → ${to}`,
            actor: actorLabel(actor, agentNameForRun, gt),
            reason: null,
            at: event.createdAt,
          },
        ],
      });
    }
    if (event.kind === TASK_ARCHIVED_EVENT || event.kind === TASK_UNARCHIVED_EVENT) {
      return Option.match(decodeArchiveChange(event.payload), {
        onNone: () => [],
        onSome: ({ actor, reason }) => [
          {
            id: event.id,
            title:
              event.kind === TASK_ARCHIVED_EVENT
                ? gt("Archived", { $context: "history entry: the task was archived" })
                : gt("Unarchived", { $context: "history entry: the task was unarchived" }),
            actor: actorLabel(actor, agentNameForRun, gt),
            reason: reason ?? null,
            at: event.createdAt,
          },
        ],
      });
    }
    const noticeTitle = agentNoticeTitle(event.kind, gt);
    if (noticeTitle !== undefined) {
      return Option.match(decodeAgentNotice(event.payload), {
        onNone: () => [],
        onSome: ({ agentName, reason }) => [
          {
            id: event.id,
            title: noticeTitle,
            actor: agentName ?? gt("Server"),
            reason,
            at: event.createdAt,
          },
        ],
      });
    }
    return [];
  });
}

/** Compact timeline of a task's history entries for the detail column. */
export function TaskHistory(props: {
  readonly entries: ReadonlyArray<TaskHistoryEntry>;
  readonly status: "loading" | "ready" | "error";
}) {
  const gt = useGT();
  if (props.entries.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {props.status === "loading"
          ? gt("Loading history…")
          : props.status === "error"
            ? gt("Could not load the history.")
            : gt("No status changes recorded yet.")}
      </p>
    );
  }
  return (
    <ol className="flex min-w-0 flex-col gap-0.5" aria-label={gt("Task history")}>
      {props.entries.map((entry) => (
        <li key={entry.id} className="flex min-w-0 flex-col px-2 py-1.5 text-sm">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-foreground">{entry.title}</span>
            <time dateTime={entry.at} className="shrink-0 text-xs text-muted-foreground">
              {new Date(entry.at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </time>
          </div>
          <span className="break-words text-xs text-muted-foreground">
            {entry.reason ? `${entry.actor}: ${entry.reason}` : entry.actor}
          </span>
        </li>
      ))}
    </ol>
  );
}
