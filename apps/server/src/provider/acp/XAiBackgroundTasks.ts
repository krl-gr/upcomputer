import {
  RuntimeTaskId,
  type ProviderRuntimeTaskStartedEvent,
  type ProviderRuntimeTaskProgressEvent,
  type ProviderRuntimeTaskCompletedEvent,
  type TurnId,
} from "@upcomputer/contracts";

type TaskEvent =
  | Pick<ProviderRuntimeTaskStartedEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskProgressEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskCompletedEvent, "type" | "payload" | "turnId">;

export interface GrokBackgroundTaskRecord {
  readonly taskId: RuntimeTaskId;
  readonly taskType: "monitor" | "shell";
  readonly description: string;
  readonly turnId: TurnId | undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function lifecycle(status: unknown, exitCode: unknown) {
  switch (text(status)?.toLowerCase()) {
    case "pending":
    case "running":
      return "running";
    case "completed":
    case "success":
    case "succeeded":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "stopped":
    case "killed":
    case "cancelled":
      return "stopped";
    default:
      return typeof exitCode === "number" && Number.isFinite(exitCode)
        ? exitCode === 0
          ? "completed"
          : "failed"
        : undefined;
  }
}

const attribution = (task: GrokBackgroundTaskRecord, turnId: TurnId | undefined) =>
  task.turnId !== undefined && task.turnId === turnId ? { turnId } : {};

/** Map Grok's discriminated tool results, including notifications after the turn ends. */
export function buildGrokBackgroundTaskEvents(input: {
  readonly tasks: Map<string, GrokBackgroundTaskRecord>;
  readonly toolCallId: string;
  readonly rawInput: unknown;
  readonly rawOutput: unknown;
  readonly toolCallStatus: string | undefined;
  readonly turnId?: TurnId | undefined;
}): TaskEvent[] {
  const { tasks, toolCallStatus, turnId } = input;
  const output = record(input.rawOutput);
  const events: TaskEvent[] = [];
  if (
    toolCallStatus !== "completed" &&
    toolCallStatus !== "failed" &&
    output.type !== "BackgroundTaskStarted"
  ) {
    return events;
  }
  const start = (
    id: string,
    taskType: "monitor" | "shell",
    description: string,
    startedByThisCall: boolean,
  ) => {
    const known = tasks.get(id);
    if (known) return known;
    const task: GrokBackgroundTaskRecord = {
      taskId: RuntimeTaskId.make(id),
      taskType,
      description,
      // Polls can rediscover older tasks without establishing their originating turn.
      turnId: startedByThisCall ? turnId : undefined,
    };
    tasks.set(id, task);
    events.push({
      type: "task.started",
      payload: { taskId: task.taskId, taskType, description },
      ...attribution(task, turnId),
    });
    return task;
  };
  const complete = (
    task: GrokBackgroundTaskRecord,
    status: "completed" | "failed" | "stopped",
    summary?: string,
  ) => {
    tasks.delete(task.taskId);
    events.push({
      type: "task.completed",
      payload: { taskId: task.taskId, status, ...(summary ? { summary } : {}) },
      ...attribution(task, turnId),
    });
  };

  if (output.type === "Monitor" && toolCallStatus === "completed") {
    const id = text(output.taskId);
    if (id) start(id, "monitor", text(record(input.rawInput).description) ?? "Monitor", true);
  } else if (output.type === "BackgroundTaskStarted") {
    const id = text(output.task_id) ?? text(output.taskId);
    const command = text(output.command);
    if (id && command) start(id, "shell", command.split("\n")[0]!.slice(0, 200), true);
  } else if (output.type === "TaskOutput" || output.type === "KillTask") {
    const results = record(output.MultiResult).results;
    for (const value of Array.isArray(results) ? results : [output.Result]) {
      const result = record(value);
      const id = text(result.task_id);
      if (!id) continue;
      if (output.type === "KillTask") {
        const task = tasks.get(id);
        if (task && toolCallStatus === "completed" && result.outcome === "killed")
          complete(task, "stopped");
        continue;
      }
      const command = text(result.command);
      const status = lifecycle(result.status, result.exit_code);
      if (!command || !status || command.startsWith("[subagent:")) continue;
      const task = start(id, /^\[monitor[:\]]/.test(command) ? "monitor" : "shell", command, false);
      const summary = text(result.output)
        ?.split("\n")
        .find((line) => line.trim())
        ?.trim();
      if (status === "running") {
        events.push({
          type: "task.progress",
          payload: {
            taskId: task.taskId,
            description: task.description,
            ...(summary ? { summary } : {}),
          },
          ...attribution(task, turnId),
        });
      } else {
        complete(task, status, summary);
      }
    }
  }
  return events;
}

/**
 * Stopping the session ends Grok's monitors and background shells with it, and
 * their completion would never be reported. Settle them as stopped.
 */
export function stopGrokBackgroundTasks(
  tasks: Map<string, GrokBackgroundTaskRecord>,
): ReadonlyArray<Pick<ProviderRuntimeTaskCompletedEvent, "type" | "payload">> {
  const events = Array.from(tasks.values(), (task) => ({
    type: "task.completed" as const,
    payload: { taskId: task.taskId, status: "stopped" as const },
  }));
  tasks.clear();
  return events;
}
