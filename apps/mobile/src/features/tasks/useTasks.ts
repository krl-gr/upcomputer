import type { EnvironmentId } from "@t3tools/contracts";
import type { TasksWebAccess, TasksWebRpcClient } from "@t3tools/tasks-client/rpc";
import { TaskPageLoader, type TaskPageLoadState } from "@t3tools/tasks-client/state/taskPageLoader";
import { TaskPageRequests } from "@t3tools/tasks-client/state/taskPages";
import {
  TaskStatusCountsLoader,
  type TaskStatusCountsState,
} from "@t3tools/tasks-client/state/taskStatusCounts";
import {
  CURRENT_TASK_WORKFLOW_VERSION,
  DEFAULT_TASK_LIST_SETTINGS,
  TASK_HISTORY_EVENT_KINDS,
  taskWorkflowVersionOf,
  type Task,
  type TaskEvent,
  type TaskId,
  type TaskListSettings,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { readTasksClient } from "./tasksRpc";
import { taskListCountsInput, taskListPageInput, type WorkerTaskFilters } from "./taskListState";

/** The kinds the detail's history shows: status and archive changes, and why no worker started. */
const TASK_DETAIL_EVENT_KINDS = [
  ...TASK_HISTORY_EVENT_KINDS,
  "task.agent-not-started",
  "task.no-matching-agent",
];

export interface TaskListData {
  /** While a new filter loads, the previous one's rows, so the list never blanks. */
  readonly page: TaskPageLoadState | null;
  readonly counts: TaskStatusCountsState | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
}

/**
 * One environment's worker tasks for the filters, kept current by the environment's change
 * stream: the same page and count loaders the desktop's task table runs. The counts leave the
 * status out, so a group opened or a status chosen keeps them while its rows load.
 */
export function useTaskList(
  environmentId: EnvironmentId | null,
  access: TasksWebAccess | null,
  filters: WorkerTaskFilters,
  collapsed: readonly string[],
): TaskListData {
  const enabled = environmentId !== null && access?.availability === "enabled";
  const countsInput = taskListCountsInput(filters);
  const countsInputKey = JSON.stringify(countsInput);
  const pageInput = taskListPageInput(filters, collapsed);
  const pageInputKey = JSON.stringify(pageInput);
  const countsKey = enabled ? `${environmentId}:${countsInputKey}` : null;
  const key = enabled ? `${environmentId}:${pageInputKey}` : null;
  const pagesLoader = useRef<{ key: string; loader: TaskPageLoader } | null>(null);
  const countsLoader = useRef<{ key: string; loader: TaskStatusCountsLoader } | null>(null);
  const [page, setPage] = useState<{ key: string; state: TaskPageLoadState } | null>(null);
  const [counts, setCounts] = useState<{ key: string; state: TaskStatusCountsState } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the count loader and its change stream subscription
  useEffect(() => {
    if (countsKey === null || environmentId === null || access === null) return;
    const client = readTasksClient(environmentId);
    const loader = new TaskStatusCountsLoader(
      { environmentId, client, access },
      JSON.parse(countsInputKey) as typeof countsInput,
      (state) =>
        setCounts((previous) =>
          state.counts === undefined &&
          state.error === undefined &&
          previous?.state.counts !== undefined &&
          previous.key.startsWith(`${environmentId}:`)
            ? { key: countsKey, state: { ...state, counts: previous.state.counts } }
            : { key: countsKey, state },
        ),
    );
    countsLoader.current = { key: countsKey, loader };
    const unsubscribe = client.tasks.subscribe(
      (change) => loader.change(change),
      (error) => loader.fail(error),
    );
    return () => {
      unsubscribe();
      loader.dispose();
      if (countsLoader.current?.loader === loader) countsLoader.current = null;
    };
  }, [countsKey, countsInputKey, environmentId, access]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the page loader and its change stream subscription for this lane
  useEffect(() => {
    if (key === null || environmentId === null || access === null) return;
    const client = readTasksClient(environmentId);
    const loader = new TaskPageLoader(
      { environmentId, client, access },
      JSON.parse(pageInputKey) as typeof pageInput,
      (state) =>
        setPage((previous) =>
          state.page === undefined &&
          state.error === undefined &&
          previous?.state.page !== undefined &&
          previous.key.startsWith(`${environmentId}:`)
            ? { key, state: { ...state, page: previous.state.page } }
            : { key, state },
        ),
    );
    pagesLoader.current = { key, loader };
    const unsubscribe = client.tasks.subscribe(
      (change) => loader.change(change),
      (error) => loader.fail(error),
    );
    return () => {
      unsubscribe();
      loader.dispose();
      if (pagesLoader.current?.loader === loader) pagesLoader.current = null;
    };
  }, [key, pageInputKey, environmentId, access]);
  const pages = () => (pagesLoader.current?.key === key ? pagesLoader.current.loader : null);
  return {
    page: page !== null && page.key === key ? page.state : null,
    counts: counts !== null && counts.key === countsKey ? counts.state : null,
    refresh: () => {
      pages()?.refresh();
      if (countsLoader.current?.key === countsKey) countsLoader.current.loader.refresh();
    },
    loadMore: () => pages()?.loadMore(),
  };
}

export interface TaskWorkflow {
  /** Null until the computer answers; after a failed read, the current workflow. */
  readonly version: TaskWorkflowVersion | null;
  readonly error: string | null;
}

const UNKNOWN_WORKFLOW: TaskWorkflow = { version: null, error: null };

/** The install's task workflow, which decides the statuses and their order. */
export function useTaskWorkflow(
  environmentId: EnvironmentId | null,
  access: TasksWebAccess | null,
): TaskWorkflow {
  const enabled = environmentId !== null && access?.availability === "enabled";
  const [known, setKnown] = useState<{
    environmentId: EnvironmentId;
    workflow: TaskWorkflow;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the environment's list settings once it serves tasks
  useEffect(() => {
    if (!enabled || environmentId === null) return;
    let cancelled = false;
    readTasksClient(environmentId)
      .tasks.getListSettings({})
      .then(
        (settings) => ({ version: taskWorkflowVersionOf(settings), error: null }),
        (cause: unknown) => ({
          version: CURRENT_TASK_WORKFLOW_VERSION,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .then((workflow) => {
        if (!cancelled) setKnown({ environmentId, workflow });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, environmentId]);
  return known !== null && known.environmentId === environmentId
    ? known.workflow
    : UNKNOWN_WORKFLOW;
}

export interface TaskListSettingsData {
  /** Null until the computer answers; after a failed read, the current workflow. */
  readonly workflowVersion: TaskWorkflowVersion | null;
  readonly settings: TaskListSettings;
  readonly setGroupOpen: (key: string, open: boolean) => void;
}

/**
 * How the computer's task list groups, shared with the desktop: grouped or not, the group order
 * and the open groups. Opening a group here opens it there, as between two desktops.
 */
export function useTaskListSettings(
  environmentId: EnvironmentId | null,
  access: TasksWebAccess | null,
): TaskListSettingsData {
  const enabled = environmentId !== null && access?.availability === "enabled";
  const [known, setKnown] = useState<{
    environmentId: EnvironmentId;
    settings: TaskListSettings;
    failed: boolean;
  } | null>(null);
  const generation = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the computer's list settings and their change stream
  useEffect(() => {
    if (!enabled || environmentId === null) return;
    const client = readTasksClient(environmentId);
    let disposed = false;
    const load = () => {
      const request = ++generation.current;
      client.tasks.getListSettings({}).then(
        (settings) => {
          if (!disposed && request === generation.current)
            setKnown({ environmentId, settings, failed: false });
        },
        () => {
          if (!disposed && request === generation.current)
            setKnown((current) =>
              current?.environmentId === environmentId
                ? current
                : { environmentId, settings: DEFAULT_TASK_LIST_SETTINGS, failed: true },
            );
        },
      );
    };
    load();
    const unsubscribe = client.tasks.subscribe((change) => {
      if (change.kind === "sync" || change.listSettingsChanged) load();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [enabled, environmentId]);
  const current = known !== null && known.environmentId === environmentId ? known : null;
  return {
    workflowVersion:
      current === null
        ? null
        : current.failed
          ? CURRENT_TASK_WORKFLOW_VERSION
          : taskWorkflowVersionOf(current.settings),
    settings: current?.settings ?? DEFAULT_TASK_LIST_SETTINGS,
    setGroupOpen: (key, open) => {
      if (environmentId === null || current === null) return;
      generation.current += 1;
      setKnown({
        ...current,
        settings: {
          ...current.settings,
          statusGroupOpen: { ...current.settings.statusGroupOpen, [key]: open },
        },
      });
      // A failed write keeps this device's choice; the next read brings the computer's back.
      void readTasksClient(environmentId)
        .tasks.updateListSettings({ statusGroupOpen: { [key]: open } })
        .catch(() => undefined);
    },
  };
}

export interface TaskDetailData {
  readonly task: Task | null;
  readonly status: "loading" | "ready" | "missing" | "error";
  readonly error: string | null;
  readonly events: readonly TaskEvent[] | null;
  readonly refresh: () => Promise<void>;
  /** Shows a change this device made before the change stream reports it. */
  readonly applyLocal: (task: Task) => void;
}

interface DetailSnapshot {
  readonly key: string;
  readonly task: Task | null;
  readonly events: readonly TaskEvent[] | null;
  readonly error: string | null;
}

async function loadDetail(client: TasksWebRpcClient, taskId: TaskId, key: string) {
  const [task, events] = await Promise.all([
    client.tasks.get({ id: taskId }),
    client.tasks
      .events({ taskId, kinds: TASK_DETAIL_EVENT_KINDS, limit: 50 })
      .then((result) => result.events)
      .catch(() => null),
  ]);
  return { key, task, events, error: null } satisfies DetailSnapshot;
}

/** One task with its history, reloaded when the change stream names it. */
export function useTaskDetail(
  environmentId: EnvironmentId,
  taskId: TaskId,
  access: TasksWebAccess | null,
): TaskDetailData {
  const enabled = access?.availability === "enabled";
  const key = `${environmentId}:${taskId}`;
  const [snapshot, setSnapshot] = useState<DetailSnapshot | null>(null);
  // A slower, older reload must not land over a newer one.
  const [requests] = useState(() => new TaskPageRequests());
  const load = () => {
    const current = requests.begin();
    return loadDetail(readTasksClient(environmentId), taskId, key).then(
      (loaded) => {
        if (current()) setSnapshot(loaded);
      },
      (cause: unknown) => {
        if (!current()) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setSnapshot((previous) => ({
          key,
          task: previous?.key === key ? previous.task : null,
          events: previous?.key === key ? previous.events : null,
          error: message,
        }));
      },
    );
  };
  const reload = useEffectEvent(() => void load());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the environment's change stream for this task
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const client = readTasksClient(environmentId);
    const unsubscribe = client.tasks.subscribe((change) => {
      if (change.kind !== "sync" && !change.taskIds.includes(taskId)) return;
      clearTimeout(timer);
      timer = setTimeout(reload, change.kind === "sync" ? 0 : 150);
    }, reload);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, environmentId, taskId]);
  const current = snapshot !== null && snapshot.key === key ? snapshot : null;
  return {
    task: current?.task ?? null,
    status:
      current === null
        ? "loading"
        : current.task !== null
          ? "ready"
          : current.error !== null
            ? "error"
            : "missing",
    error: current?.error ?? null,
    events: current?.events ?? null,
    refresh: load,
    applyLocal: (task) => {
      // A reload already in flight may predate this change; the change stream reloads after it.
      requests.invalidate();
      setSnapshot((previous) =>
        previous !== null && previous.key === key ? { ...previous, task } : previous,
      );
    },
  };
}
