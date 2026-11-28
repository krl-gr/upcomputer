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

/** One history entry of a task, before a client words it. */
export type TaskHistoryRecord = { readonly id: string; readonly at: string } & (
  | {
      readonly kind: "status";
      readonly from: string;
      readonly to: string;
      readonly actor: TaskActor;
    }
  | {
      readonly kind: "archived" | "unarchived";
      readonly actor: TaskActor;
      readonly reason: string | null;
    }
  | {
      /** Events that explain why an agent did not act, so a waiting task is not silent. */
      readonly kind: "agentNotStarted" | "noMatchingAgent";
      readonly agentName: string | null;
      readonly reason: string;
    }
);

const decodeStatusChange = Schema.decodeUnknownOption(TaskStatusChangedPayload);
const decodeArchiveChange = Schema.decodeUnknownOption(TaskArchiveChangedPayload);
const decodeAgentNotice = Schema.decodeUnknownOption(
  Schema.Struct({ agentName: Schema.optional(Schema.String), reason: Schema.String }),
);

const AGENT_NOTICE_KINDS: Readonly<Record<string, "agentNotStarted" | "noMatchingAgent">> = {
  "task.agent-not-started": "agentNotStarted",
  "task.no-matching-agent": "noMatchingAgent",
};

/**
 * The task's status and archive history and why agents did not start, in the events' order,
 * as the server recorded it. Other event kinds and unreadable payloads are left out.
 */
export function taskHistoryRecords(events: ReadonlyArray<TaskEvent>): TaskHistoryRecord[] {
  return events.flatMap((event): TaskHistoryRecord[] => {
    const base = { id: event.id, at: event.createdAt };
    if (event.kind === TASK_STATUS_CHANGED_EVENT) {
      return Option.match(decodeStatusChange(event.payload), {
        onNone: () => [],
        onSome: ({ from, to, actor }) => [{ ...base, kind: "status", from, to, actor }],
      });
    }
    if (event.kind === TASK_ARCHIVED_EVENT || event.kind === TASK_UNARCHIVED_EVENT) {
      return Option.match(decodeArchiveChange(event.payload), {
        onNone: () => [],
        onSome: ({ actor, reason }) => [
          {
            ...base,
            kind: event.kind === TASK_ARCHIVED_EVENT ? "archived" : "unarchived",
            actor,
            reason: reason ?? null,
          },
        ],
      });
    }
    const noticeKind = AGENT_NOTICE_KINDS[event.kind];
    if (noticeKind !== undefined) {
      return Option.match(decodeAgentNotice(event.payload), {
        onNone: () => [],
        onSome: ({ agentName, reason }) => [
          { ...base, kind: noticeKind, agentName: agentName ?? null, reason },
        ],
      });
    }
    return [];
  });
}
