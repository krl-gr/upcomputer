import * as NodeAssert from "node:assert/strict";
import {
  TASK_STATUS_CHANGED_EVENT,
  TASK_UNARCHIVED_EVENT,
  type TaskEvent,
} from "@t3tools/tasks-contracts/v1";
import { test } from "vite-plus/test";

import { taskHistoryEntries } from "./TaskHistory.tsx";

const event = (id: string, kind: string, payload: unknown) =>
  ({ id, taskId: "task-1", kind, payload, createdAt: "2026-10-07T10:00:00.000Z" }) as TaskEvent;

test("history names the agent of a run and keeps only readable history events", () => {
  const entries = taskHistoryEntries(
    [
      event("e4", TASK_UNARCHIVED_EVENT, { actor: { type: "server" } }),
      event("e3", TASK_STATUS_CHANGED_EVENT, {
        from: "In Progress",
        to: "Needs Review",
        actor: { type: "agent-run", agentRunId: "run-1" },
      }),
      event("e2", TASK_STATUS_CHANGED_EVENT, {
        from: "To Do",
        to: "In Progress",
        actor: { type: "agent-run", agentRunId: "run-unknown" },
      }),
      event("e1", TASK_STATUS_CHANGED_EVENT, { from: "To Do" }),
      event("e0", "task.agent-started", { agentRunId: "run-1" }),
    ],
    (runId) => (runId === "run-1" ? "Developer" : null),
  );
  NodeAssert.deepEqual(
    entries.map(({ id, title, actor, reason }) => ({ id, title, actor, reason })),
    [
      { id: "e4", title: "Unarchived", actor: "Server", reason: null },
      { id: "e3", title: "In Progress → Needs Review", actor: "Developer", reason: null },
      { id: "e2", title: "To Do → In Progress", actor: "Agent run", reason: null },
    ],
  );
});
