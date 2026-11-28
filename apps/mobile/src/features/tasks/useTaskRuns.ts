import type { EnvironmentId } from "@t3tools/contracts";
import type { TasksWebAccess } from "@t3tools/tasks-client/rpc";
import { fetchTaskRuns, mergeTaskRuns } from "@t3tools/tasks-client/runs/taskRuns";
import type { TaskAgent, TaskAgentRun, TaskId } from "@t3tools/tasks-contracts/v1";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { readTasksClient } from "./tasksRpc";

export interface TaskRunsData {
  readonly runs: readonly TaskAgentRun[];
  /** unavailable: this computer's grant (or an older server) can't read worker runs. */
  readonly status: "loading" | "ready" | "error" | "unavailable";
  readonly hasMore: boolean;
  /** The task's workers by id, archived ones too, to name each run's worker. */
  readonly workers: ReadonlyMap<string, TaskAgent>;
  readonly loadMore: () => void;
  readonly refresh: () => void;
}

interface RunsSnapshot {
  readonly key: string;
  readonly runs: readonly TaskAgentRun[];
  readonly status: "loading" | "ready" | "error";
  readonly hasMore: boolean;
}

/**
 * A task's worker runs, newest first, as the desktop's Runs section loads them: a page at a time,
 * filtered to a run-count status, and reloaded (every page shown) when the change stream says the
 * task's runs changed.
 */
export function useTaskRuns(
  environmentId: EnvironmentId,
  taskId: TaskId,
  access: TasksWebAccess | null,
  status: string | null,
): TaskRunsData {
  const enabled = access?.availability === "enabled" && access.canReadAgents;
  const key = `${environmentId}:${taskId}:${status ?? ""}`;
  const [snapshot, setSnapshot] = useState<RunsSnapshot | null>(null);
  const [workers, setWorkers] = useState<{
    readonly environmentId: EnvironmentId;
    readonly byId: ReadonlyMap<string, TaskAgent>;
  } | null>(null);
  const request = useRef(0);
  const pages = useRef(1);
  const runsRef = useRef<readonly TaskAgentRun[]>([]);

  const load = (append: boolean, filter: string | null = status) => {
    const current = ++request.current;
    const after = append ? runsRef.current[runsRef.current.length - 1] : undefined;
    void fetchTaskRuns(readTasksClient(environmentId), {
      taskId,
      status: filter,
      after,
      pages: append ? 1 : pages.current,
      isCurrent: () => request.current === current,
    }).then(
      (result) => {
        if (request.current !== current) return;
        if (append) pages.current += 1;
        const runs = mergeTaskRuns(runsRef.current, result.runs, append);
        runsRef.current = runs;
        setSnapshot({ key, runs, status: "ready", hasMore: result.hasMore });
      },
      () => {
        if (request.current !== current) return;
        setSnapshot((previous) =>
          previous?.key === key
            ? { ...previous, status: "error" }
            : { key, runs: [], status: "error", hasMore: false },
        );
      },
    );
  };
  const reload = useEffectEvent((filter: string | null) => load(false, filter));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the change stream for this task's runs
  useEffect(() => {
    if (!enabled) return;
    pages.current = 1;
    runsRef.current = [];
    reload(status);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = readTasksClient(environmentId).tasks.subscribe(
      (change) => {
        if (change.kind !== "sync" && !(change.runsChanged && change.taskIds.includes(taskId)))
          return;
        clearTimeout(timer);
        timer = setTimeout(() => reload(status), 150);
      },
      () => undefined,
    );
    return () => {
      request.current += 1;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, environmentId, taskId, status]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the computer's workers once, to name each run's worker
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    readTasksClient(environmentId)
      .agents.search({ includeArchived: true })
      .then(
        (result) => {
          if (!cancelled)
            setWorkers({
              environmentId,
              byId: new Map(result.agents.map((agent) => [String(agent.id), agent])),
            });
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
    };
  }, [enabled, environmentId]);

  const current = snapshot !== null && snapshot.key === key ? snapshot : null;
  const unavailable = !enabled && access !== null && access.availability !== "loading";
  return {
    runs: current?.runs ?? [],
    status: unavailable ? "unavailable" : (current?.status ?? "loading"),
    hasMore: current?.hasMore ?? false,
    workers:
      workers !== null && workers.environmentId === environmentId ? workers.byId : NO_WORKERS,
    loadMore: () => load(true),
    refresh: () => load(false),
  };
}

const NO_WORKERS: ReadonlyMap<string, TaskAgent> = new Map();
