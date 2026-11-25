import * as NodeAssert from "node:assert/strict";
import { act, createElement } from "react";
import { test, vi } from "vite-plus/test";
import type { TaskChange, TaskListSettings } from "@t3tools/tasks-contracts/v1";

vi.mock("../../../../apps/web/src/hooks/useLocalStorage.ts", async () => {
  const { useState } = await import("react");
  return { useLocalStorage: (_key: string, initial: unknown) => useState(initial) };
});
vi.mock("../../../../apps/web/src/state/environments.ts", () => ({
  usePrimaryEnvironmentId: () => "local",
}));
vi.mock("../planner/data/preferences.ts", () => ({
  useStoredPlannerEnvironment: () => [null, () => undefined],
}));
vi.mock("../planner/ui/PlannerView.tsx", () => ({
  pickEnvironment: (candidates: ReadonlyArray<{ environmentId: string }>) =>
    candidates[0]?.environmentId ?? null,
}));

test("a settings read that started before a local change does not undo it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { create } = await import("react-test-renderer");
  const { useTaskListSettings } = await import("./useTaskListSettings.ts");

  let resolveRead: (settings: TaskListSettings) => void = () => undefined;
  let listener: (change: TaskChange) => void = () => undefined;
  const targets = [
    {
      environmentId: "local",
      access: { canReadTasks: true, canMutateTasks: true },
      client: {
        tasks: {
          subscribe: (next: (change: TaskChange) => void) => {
            listener = next;
            return () => undefined;
          },
          getListSettings: () =>
            new Promise<TaskListSettings>((resolve) => {
              resolveRead = resolve;
            }),
          updateListSettings: async () => ({}),
        },
      },
    },
  ] as never;

  let result: ReturnType<typeof useTaskListSettings> | undefined;
  function Probe() {
    result = useTaskListSettings(targets);
    return null;
  }
  const renderer = await act(async () => create(createElement(Probe)));
  try {
    act(() => listener({ kind: "sync", sequence: 1 } as TaskChange));
    act(() => result!.update({ statusGroupOpen: { "to do": false } }));
    await act(async () => {
      resolveRead({ groupByStatus: true, statusGroupOrder: [], statusGroupOpen: {} });
    });
    NodeAssert.deepEqual(result!.settings.statusGroupOpen, { "to do": false });
  } finally {
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
  }
});
