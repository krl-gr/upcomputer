import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  TaskAgentId,
  TaskAgentRunId,
  TaskEventId,
  TaskId,
  type TaskEvent,
} from "@t3tools/tasks-contracts/v1";

import {
  previousRunSection,
  RECENT_EVENTS_READ_LIMIT,
  recentEventsSection,
} from "./TaskAgentRunContext.ts";

let sequence = 0;
function event(kind: string, payload: unknown, minute = sequence): TaskEvent {
  sequence += 1;
  return {
    id: TaskEventId.make(`event-${sequence}`),
    taskId: TaskId.make("task-1"),
    kind,
    payload,
    createdAt: `2026-10-19T20:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

/** Newest first, as the repository returns them. */
const newestFirst = (events: ReadonlyArray<TaskEvent>) => events.toReversed();

it("shows nothing for a task without events, or with only server snapshots", () => {
  assert.equal(recentEventsSection([]), "");
  assert.equal(
    recentEventsSection(
      newestFirst([
        event("task.created", { status: "To Do", tags: ["dev-2"] }),
        event("task.updated", { status: "To Do", tags: ["dev-2"] }),
        event("task.agent-started", { agentId: "agent-1", agentRunId: "run-0" }),
      ]),
    ),
    "",
  );
});

it("shows the events that matter, newest last, with time, kind, author and text", () => {
  const section = recentEventsSection(
    newestFirst([
      event("task.created", { status: "To Do", tags: [] }, 1),
      event(
        "task.status-changed",
        { from: "To Do", to: "In Progress", actor: { type: "agent-run", agentRunId: "run-0" } },
        2,
      ),
      event("task.updated", { status: "In Progress", tags: [] }, 2),
      event("note", { text: "Use the staging database, not prod." }, 3),
      event(
        "task.agent-result",
        {
          source: "task_update",
          agentId: "agent-1",
          agentRunId: "run-0",
          status: "Blocked",
          blocked: true,
          summary: "Needs the staging password.",
        },
        4,
      ),
      event("task.archived", { actor: { type: "person" }, reason: "Done elsewhere" }, 5),
    ]),
  );
  assert.equal(
    section,
    `
Recent task events (newest last; server snapshots and run starts left out):
- 2026-10-19T20:02:00.000Z task.status-changed by run run-0: To Do -> In Progress
- 2026-10-19T20:03:00.000Z note: Use the staging database, not prod.
- 2026-10-19T20:04:00.000Z task.agent-result by agent agent-1 run run-0: Needs the staging password.
  {"source":"task_update","status":"Blocked","blocked":true}
- 2026-10-19T20:05:00.000Z task.archived by person: {"reason":"Done elsewhere"}
`,
  );
});

it("keeps the newest events within the budget and counts the rest", () => {
  const notes = Array.from({ length: 60 }, (_, index) =>
    event("note", { text: `Note ${index}: ${"x".repeat(200)}` }, index),
  );
  const section = recentEventsSection(newestFirst(notes));
  assert.isBelow(section.length, 4_300);
  const shown = section.split("\n").filter((line) => line.startsWith("- "));
  assert.isAbove(shown.length, 5);
  assert.include(section, `${60 - shown.length} earlier events are not shown.`);
  assert.include(shown.at(-1)!, "Note 59:");
  assert.include(shown[0]!, `Note ${60 - shown.length}:`);
});

it("always shows the newest event, cut to its own limit", () => {
  const section = recentEventsSection([event("finding", { summary: "y".repeat(10_000) })]);
  assert.include(section, "... (truncated)");
  assert.isBelow(section.length, 1_400);
});

it("says more may be hidden when the read stopped at its limit", () => {
  const events = Array.from({ length: RECENT_EVENTS_READ_LIMIT }, () =>
    event("task.updated", { status: "To Do", tags: [] }),
  );
  events[0] = event("note", "Latest note.");
  assert.include(recentEventsSection(events), "Some earlier events are not shown.");
});

it("points a repeat run to its previous run's result", () => {
  const run = {
    id: TaskAgentRunId.make("run-0"),
    taskId: TaskId.make("task-1"),
    agentId: TaskAgentId.make("agent-1"),
    threadId: ThreadId.make("thread-0"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    status: "blocked",
    startedAt: "2026-10-19T20:00:00.000Z",
    completedAt: "2026-10-19T20:04:00.000Z",
    triggerRunId: null,
    continuesRunId: null,
  };
  assert.equal(previousRunSection(null, true), "");
  assert.equal(
    previousRunSection(run, true),
    `
Your previous run on this task:
- runId: run-0
- status: blocked
- ended: 2026-10-19T20:04:00.000Z
Its result is in the current output above; its events, if any, are in the recent events above.
`,
  );
  assert.include(previousRunSection(run, false), "It left no task output");
});
