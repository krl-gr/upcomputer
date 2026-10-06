import * as NodeAssert from "node:assert/strict";
import { createElement, act } from "react";
import { afterEach, test, vi } from "vite-plus/test";

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

test("the project choice is shared by the pages, and all filters survive a remount", async () => {
  const storage = memoryStorage();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: storage }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { create } = await import("react-test-renderer");
  const filters = await import("./pageFilters.ts");

  const seen: Record<string, unknown> = {};
  let setProject: (key: string | null) => void = () => undefined;
  let setTaskFilters: (value: typeof filters.DEFAULT_TASKS_PAGE_FILTERS) => void = () => undefined;
  function TasksPage() {
    const [project, set] = filters.usePagesProjectKey();
    const [taskFilters, setFilters] = filters.useTasksPageFilters();
    setProject = set;
    setTaskFilters = setFilters;
    seen.tasksProject = project;
    seen.taskFilters = taskFilters;
    return null;
  }
  function AgentsPage() {
    seen.agentsProject = filters.usePagesProjectKey()[0];
    return null;
  }
  function AutomationsPage() {
    seen.automationsProject = filters.usePagesProjectKey()[0];
    return null;
  }

  let pages!: ReturnType<typeof create>;
  await act(async () => {
    pages = create(
      createElement("div", null, [
        createElement(TasksPage, { key: "tasks" }),
        createElement(AgentsPage, { key: "agents" }),
        createElement(AutomationsPage, { key: "automations" }),
      ]),
    );
  });
  NodeAssert.equal(seen.tasksProject, null, "All projects by default");
  NodeAssert.deepEqual(seen.taskFilters, filters.DEFAULT_TASKS_PAGE_FILTERS);

  const chosen = { status: "To Do", lastRun: "failed", tags: ["browser-use", "ui"] };
  await act(async () => {
    setProject("repo:upcomputer");
    setTaskFilters(chosen);
  });
  NodeAssert.equal(seen.agentsProject, "repo:upcomputer", "Agents follow the choice on Tasks");
  NodeAssert.equal(seen.automationsProject, "repo:upcomputer");
  await act(async () => pages.unmount());

  for (const key of Object.keys(seen)) delete seen[key];
  await act(async () => {
    pages = create(createElement(TasksPage));
  });
  NodeAssert.equal(seen.tasksProject, "repo:upcomputer", "the project survives a remount");
  NodeAssert.deepEqual(seen.taskFilters, chosen, "the Tasks filters survive a remount");
  NodeAssert.deepEqual(
    [...Array(storage.length).keys()].map((index) => storage.key(index)).toSorted(),
    [filters.PAGES_PROJECT_STORAGE_KEY, filters.TASKS_PAGE_FILTERS_STORAGE_KEY],
    "stored under the pages' own keys, apart from the sidebar's state",
  );

  await act(async () => setProject(null));
  NodeAssert.equal(seen.tasksProject, null, "All projects clears the choice");
  await act(async () => pages.unmount());
});

test("trigger tags come from enabled agents only", async () => {
  const { agentTriggerTags } = await import("./pageFilters.ts");
  NodeAssert.deepEqual(
    [
      ...agentTriggerTags([
        { enabled: true, startTags: ["browser-use", "dev-2"] },
        { enabled: false, startTags: ["paused"] },
      ]),
    ],
    ["browser-use", "dev-2"],
  );
});
