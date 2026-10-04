import { describe, expect, it } from "@effect/vitest";

import { sourceWakeMessage, wakesSourceChat, type PendingWakeRow } from "./TaskSourceWake.ts";

const row = (overrides: Partial<PendingWakeRow>): PendingWakeRow => ({
  runId: "run-1",
  status: "completed",
  runThreadId: "thread-run-1",
  agentName: "Developer",
  taskId: "task-1",
  taskTitle: "Fix the build",
  sourceThreadId: "thread-chat",
  sourceIsRunThread: 0,
  summary: "Fixed it.",
  ...overrides,
});

describe("TaskSourceWake", () => {
  it("wakes the source chat only for runs the agent finished", () => {
    expect(wakesSourceChat(row({ status: "completed" }))).toBe(true);
    expect(wakesSourceChat(row({ status: "blocked" }))).toBe(true);
    expect(wakesSourceChat(row({ status: "failed" }))).toBe(true);
    expect(wakesSourceChat(row({ status: "interrupted" }))).toBe(true);
    // A person stopped it, or the task closed under it.
    expect(wakesSourceChat(row({ status: "stopped" }))).toBe(false);
    expect(wakesSourceChat(row({ sourceThreadId: null }))).toBe(false);
    expect(wakesSourceChat(row({ taskId: null }))).toBe(false);
    // Tasks created by another run do not wake that run's thread.
    expect(wakesSourceChat(row({ sourceIsRunThread: 1 }))).toBe(false);
    expect(wakesSourceChat(row({ sourceThreadId: "thread-run-1" }))).toBe(false);
  });

  it("reports one run with its thread and summary", () => {
    const run = row({});
    if (!wakesSourceChat(run)) throw new Error("expected a wake");
    const message = sourceWakeMessage([run]);
    expect(message.notification).toEqual({
      source: {
        kind: "task_agent_run",
        tasks: [{ id: "task-1", title: "Fix the build" }],
        childThreadId: "thread-run-1",
      },
      outcome: "completed",
      summary: 'Task "Fix the build" completed',
    });
    expect(message.text).toContain(
      '- Task "Fix the build" (task-1), run run-1 by agent "Developer": completed. Summary: Fixed it.',
    );
  });

  it("batches runs that finished together into one message", () => {
    const runs = [
      row({}),
      row({
        runId: "run-2",
        runThreadId: "thread-run-2",
        taskId: "task-2",
        taskTitle: "Docs",
        status: "failed",
        summary: null,
      }),
    ].filter(wakesSourceChat);
    const [first, ...rest] = runs;
    if (first === undefined) throw new Error("expected wakes");
    const message = sourceWakeMessage([first, ...rest]);
    expect(message.notification.outcome).toBe("failed");
    expect(message.notification.summary).toBe("2 task runs finished: Fix the build, Docs");
    expect(message.notification.source).toEqual({
      kind: "task_agent_run",
      tasks: [
        { id: "task-1", title: "Fix the build" },
        { id: "task-2", title: "Docs" },
      ],
    });
    expect(message.text.split("\n")).toHaveLength(4);
  });
});
