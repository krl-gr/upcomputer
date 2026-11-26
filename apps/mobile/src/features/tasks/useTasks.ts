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
  TASK_HISTORY_EVENT_KINDS,
  taskWorkflowVersionOf,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
  type TaskEvent,
  type TaskId,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { readTasksClient } from "./tasksRpc";
import {
  TASK_LIST_COUNTS_INPUT,
  taskListFilterKey,
  taskListPageInput,
  type TaskListFilter,
} from "./taskListState";

/** The kinds the detail's history shows: status and archive changes, and why no worker started. */
const TASK_DETAIL_EVENT_KINDS = [
  ...TASK_HISTORY_EVENT_KINDS,
  "task.agent-not-started",
  "task.no-matching-agent",
];

export interface TaskListData {
  readonly page: TaskPageLoadState | null;
  readonly counts: TaskStatusCountsState | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
}

interface LiveLane {
  readonly key: string;
  readonly pages: TaskPageLoader;
  readonly counts: TaskStatusCountsLoader;
}

/**
 * One environment's task list for a filter, kept current by the environment's change stream:
 * the same page and count loaders the desktop's task table runs.
 */
export function useTaskList(
  environmentId: EnvironmentId | null,
  access: TasksWebAccess | null,
  filter: TaskListFilter,
): TaskListData {
  const enabled = environmentId !== null && access?.availability === "enabled";
  const key = enabled ? `${environmentId}:${taskListFilterKey(filter)}` : null;
  const live = useRef<LiveLane | null>(null);
  const [page, setPage] = useState<{ key: string; state: TaskPageLoadState } | null>(null);
  const [counts, setCounts] = useState<{ key: string; state: TaskStatusCountsState } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the loaders and the environment's change stream subscription for this lane
  useEffect(() => {
    if (key === null || environmentId === null || access === null) return;
    const client = readTasksClient(environmentId);
    const target = { environmentId, client, access };
    const pages = new TaskPageLoader(target, taskListPageInput(filter), (state) =>
      setPage({ key, state }),
    );
    const counter = new TaskStatusCountsLoader(target, TASK_LIST_COUNTS_INPUT, (state) =>
      setCounts({ key, state }),
    );
    live.current = { key, pages, counts: counter };
    const unsubscribe = client.tasks.subscribe(
      (change) => {
        pages.change(change);
        counter.change(change);
      },
      (error) => {
        pages.fail(error);
        counter.fail(error);
      },
    );
    return () => {
      unsubscribe();
      pages.dispose();
      counter.dispose();
      if (live.current?.key === key) live.current = null;
    };
  }, [key, environmentId, access, filter]);
  const lane = () => (live.current !== null && live.current.key === key ? live.current : null);
  return {
    page: page !== null && page.key === key ? page.state : null,
    counts: counts !== null && counts.key === key ? counts.state : null,
    refresh: () => {
      lane()?.pages.refresh();
      lane()?.counts.refresh();
    },
    loadMore: () => lane()?.pages.loadMore(),
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

export interface TaskDetailData {
  readonly task: Task | null;
  readonly status: "loading" | "ready" | "missing" | "error";
  readonly error: string | null;
  readonly events: readonly TaskEvent[] | null;
  readonly latestRun: TaskAgentRun | null;
  readonly worker: TaskAgent | null;
  readonly refresh: () => Promise<void>;
  /** Shows a change this device made before the change stream reports it. */
  readonly applyLocal: (task: Task) => void;
}

interface DetailSnapshot {
  readonly key: string;
  readonly task: Task | null;
  readonly events: readonly TaskEvent[] | null;
  readonly latestRun: TaskAgentRun | null;
  readonly worker: TaskAgent | null;
  readonly error: string | null;
}

async function loadDetail(client: TasksWebRpcClient, taskId: TaskId, key: string) {
  const [task, events, runs] = await Promise.all([
    client.tasks.get({ id: taskId }),
    client.tasks
      .events({ taskId, kinds: TASK_DETAIL_EVENT_KINDS, limit: 50 })
      .then((result) => result.events)
      .catch(() => null),
    client.agents.searchRuns({ taskId, limit: 1 }).then((result) => result.runs),
  ]);
  const latestRun = runs[0] ?? null;
  const worker =
    latestRun === null
      ? null
      : ((await client.agents
          .search({ includeArchived: true })
          .then((result) => result.agents.find((agent) => agent.id === latestRun.agentId))
          .catch(() => undefined)) ?? null);
  return { key, task, events, latestRun, worker, error: null } satisfies DetailSnapshot;
}

/** One task with its history and latest worker run, reloaded when the change stream names it. */
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
          latestRun: previous?.key === key ? previous.latestRun : null,
          worker: previous?.key === key ? previous.worker : null,
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
    latestRun: current?.latestRun ?? null,
    worker: current?.worker ?? null,
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
