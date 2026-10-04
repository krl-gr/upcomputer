/**
 * Whether an environment serves the Tasks RPC groups. V1 read this from the
 * product manifest; on v2 the client asks the server once (see
 * `environmentApi.ts`), and the server's scopes still decide every call.
 */
export type TasksWebAvailability = "loading" | "unavailable" | "enabled";

export interface TasksWebAccess {
  readonly availability: TasksWebAvailability;
  readonly reason: string;
  readonly canReadTasks: boolean;
  readonly canMutateTasks: boolean;
  readonly canReadAgents: boolean;
  readonly canMutateAgents: boolean;
  readonly canReadAutomations: boolean;
  readonly canMutateAutomations: boolean;
}

export interface ResolveTasksWebAccessInput {
  readonly availability: TasksWebAvailability;
  readonly reason?: string;
}

const DEFAULT_REASONS: Record<TasksWebAvailability, string> = {
  loading: "Checking whether the server has Tasks.",
  unavailable: "The connected server does not serve Tasks.",
  enabled: "Tasks are available.",
};

export function resolveTasksWebAccess(input: ResolveTasksWebAccessInput): TasksWebAccess {
  const enabled = input.availability === "enabled";
  return {
    availability: input.availability,
    reason: input.reason ?? DEFAULT_REASONS[input.availability],
    canReadTasks: enabled,
    canMutateTasks: enabled,
    canReadAgents: enabled,
    canMutateAgents: enabled,
    canReadAutomations: enabled,
    canMutateAutomations: enabled,
  };
}

export class TasksWebCapabilityUnavailableError extends Error {
  override readonly name = "TasksWebCapabilityUnavailableError";

  constructor(
    readonly operation: string,
    readonly reason: string,
  ) {
    super(`Tasks operation '${operation}' is unavailable: ${reason}`);
  }
}
