import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { TaskAgentRunSearchInput, TaskId } from "@t3tools/tasks-contracts/v1";

import { TASK_RUNS_PAGE_SIZE, canStopRun, fetchTaskRuns, mergeTaskRuns } from "./taskRuns.ts";

const run = (index: number) =>
  ({
    id: `run-${index}`,
    startedAt: new Date(Date.UTC(2026, 10, 26, 0, 0, 1000 - index)).toISOString(),
  }) as never;

function client(total: number, calls: TaskAgentRunSearchInput[]) {
  const all = Array.from({ length: total }, (_, index) => run(index)) as Array<{
    id: string;
    startedAt: string;
  }>;
  return {
    agents: {
      searchRuns: async (input: TaskAgentRunSearchInput) => {
        calls.push(input);
        const start = input.cursor
          ? all.findIndex((entry) => entry.id === input.cursor!.id) + 1
          : 0;
        return { runs: all.slice(start, start + (input.limit ?? 500)) };
      },
    },
  } as never;
}

test("pages through a task's runs from the newest, filtered by the run count's status", async () => {
  const calls: TaskAgentRunSearchInput[] = [];
  const taskId = "task-1" as TaskId;
  const first = await fetchTaskRuns(client(150, calls), {
    taskId,
    status: "blocked:superseded",
    pages: 1,
  });
  NodeAssert.deepEqual([first.runs.length, first.hasMore], [TASK_RUNS_PAGE_SIZE, true]);
  NodeAssert.equal(calls[0]!.status, "blocked");
  const rest = await fetchTaskRuns(client(150, calls), {
    taskId,
    status: null,
    after: first.runs[first.runs.length - 1],
    pages: 1,
  });
  NodeAssert.deepEqual([rest.runs.length, rest.hasMore], [50, false]);
  NodeAssert.equal("status" in calls[1]!, false);
  // A reload covers every page shown so far.
  const reload = await fetchTaskRuns(client(150, calls), { taskId, status: null, pages: 2 });
  NodeAssert.equal(reload.runs.length, 150);
  const replaced = await fetchTaskRuns(client(150, calls), {
    taskId,
    status: null,
    pages: 2,
    isCurrent: () => false,
  });
  NodeAssert.equal(replaced.runs.length, 0);
});

test("appending keeps one entry per run; a reload replaces the list", () => {
  const a = { id: "a", status: "running" };
  const b = { id: "b", status: "completed" };
  const fresh = { id: "a", status: "stopped" };
  NodeAssert.deepEqual(mergeTaskRuns([a, b], [fresh], true), [fresh, b]);
  NodeAssert.deepEqual(mergeTaskRuns([a, b], [fresh], false), [fresh]);
});

test("only an active run that isn't wrapping up can be stopped", () => {
  NodeAssert.equal(canStopRun({ completedAt: null, status: "running" }), true);
  NodeAssert.equal(canStopRun({ completedAt: null, status: "blocked" }), true);
  NodeAssert.equal(canStopRun({ completedAt: null, status: "finalizing:result" }), false);
  NodeAssert.equal(canStopRun({ completedAt: "2026-11-26T00:00:00Z", status: "stopped" }), false);
});
