import * as NodeAssert from "node:assert/strict";
import { createElement, act } from "react";
import { afterEach, test, vi } from "vite-plus/test";
import type {
  TaskChange,
  TaskPageInput,
  TaskPageResult,
  TaskStatusCountsInput,
} from "@t3tools/tasks-contracts/v1";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllGlobals();
});

// act renders once its callback ends, so a chain of renders (counts, then pages) needs several.
async function settle(steps: number) {
  for (let step = 0; step < steps; step += 1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
}

const TOTALS: Record<string, number> = { "To Do": 150, Done: 300 };

test("grouped, an open group pages by itself and a collapsed group loads only its count", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  const { create } = await import("react-test-renderer");
  const { useTaskPages } = await import("./useTaskPages.ts");
  const { createTaskChangeSubscription } = await import("../rpc/taskChanges.ts");

  const pages: TaskPageInput[] = [];
  const counts: TaskStatusCountsInput[] = [];
  const subscribe = createTaskChangeSubscription(
    (signal, listener) =>
      new Promise<void>((resolve) => {
        queueMicrotask(() => listener({ kind: "sync", sequence: 1 } as TaskChange));
        signal.addEventListener("abort", () => resolve());
      }),
  );
  const targets = [
    {
      environmentId: "local",
      client: {
        tasks: {
          subscribe,
          statusCounts: async (input: TaskStatusCountsInput) => {
            counts.push(input);
            return {
              counts: Object.entries(TOTALS).map(([status, count]) => ({ status, count })),
            };
          },
          page: async (input: TaskPageInput): Promise<TaskPageResult> => {
            pages.push(input);
            const status = input.status!;
            const from = input.cursor ? Number(input.cursor.id.split("-").at(-1)) + 1 : 0;
            const to = Math.min(from + input.limit!, TOTALS[status]!);
            const tasks = Array.from({ length: to - from }, (_, offset) => ({
              id: `${status}-${from + offset}`,
              projectId: "project",
              rank: String(from + offset).padStart(16, "0"),
              title: `${status} ${from + offset}`,
              status,
              runCounts: [],
            })) as unknown as TaskPageResult["tasks"];
            const last = tasks.at(-1);
            return {
              tasks,
              statuses: Object.keys(TOTALS),
              nextCursor: to < TOTALS[status]! && last ? { rank: last.rank, id: last.id } : null,
            };
          },
        },
      },
      access: { canReadTasks: true, availability: "enabled", reason: "" },
      projectNameById: new Map(),
    },
  ] as never;
  const tags: string[] = [];
  const open = (key: string) => key !== "done";
  const results: ReturnType<typeof useTaskPages>[] = [];
  function List() {
    results.push(useTaskPages(targets, null, "__all__", tags, "active", "failed", open));
    return null;
  }
  const result = () => results.at(-1)!;
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(createElement(List));
  });
  await settle(5);

  NodeAssert.deepEqual(counts, [{ audience: "agent", lastRun: "failed" }]);
  NodeAssert.deepEqual(
    pages.map(({ status, cursor }) => [status, cursor ?? null]),
    [["To Do", null]],
    "Done is collapsed: no rows asked for",
  );
  NodeAssert.equal(pages[0]?.lastRun, "failed", "the group's lane keeps the list's filters");
  NodeAssert.deepEqual(Object.fromEntries(result().groupCounts!), { "to do": 150, done: 300 });
  NodeAssert.equal(result().tasks.length, 100);
  NodeAssert.deepEqual(result().groupPaging.get("to do"), { hasMore: true, loading: false });
  NodeAssert.equal(result().hasMore, false, "no Load more for a grouped list");

  await act(async () => result().loadGroup("to do"));
  await settle(3);
  NodeAssert.deepEqual(pages.at(-1)?.cursor?.id, "To Do-99");
  NodeAssert.equal(result().tasks.length, 150);
  NodeAssert.deepEqual(result().groupPaging.get("to do"), { hasMore: false, loading: false });

  await act(async () => renderer?.unmount());
});
