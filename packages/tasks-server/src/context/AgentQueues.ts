import type { ProjectId } from "@t3tools/contracts";
import type { Task, TaskAgent, TaskAgentRun } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { agentMayTakeTask } from "../agents/TaskAgentService.ts";
import type { TaskRepositoryShape } from "../persistence/TaskRepository.ts";

const IN_PROGRESS = "In Progress";
/** Enough for any real setup; more are counted in agentsOmitted. */
const MAX_AGENTS = 30;
/** Per status; a longer queue reads as this many. */
const MAX_TASKS_PER_STATUS = 500;

/**
 * An enabled agent that can start on the project's tasks, as task_context
 * lists it. queue counts the unarchived tasks that carry all of its startTags
 * and that it may take (`agentMayTakeTask`), per start status and In Progress; inProgress names the In Progress ones. An
 * agent with startRunStatuses starts on failed runs, not on a queue. active
 * names the tasks its active runs hold in any status, so a run that started
 * on a To Do task of a tag-only agent shows it busy before In Progress.
 */
export interface AgentQueue {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly model: string;
  readonly startStatuses: ReadonlyArray<string>;
  readonly startTags: ReadonlyArray<string>;
  readonly startRunStatuses?: ReadonlyArray<string>;
  readonly queue?: Readonly<Record<string, number>>;
  readonly inProgress?: ReadonlyArray<string>;
  readonly active?: ReadonlyArray<string>;
}

/** The statuses whose tasks agentQueues needs. */
export function queueStatuses(agents: ReadonlyArray<TaskAgent>): ReadonlyArray<string> {
  return [...new Set([...agents.flatMap((agent) => agent.startStatuses), IN_PROGRESS])];
}

export function agentQueues(
  agents: ReadonlyArray<TaskAgent>,
  tasks: ReadonlyArray<Task>,
  activeRuns: ReadonlyArray<Pick<TaskAgentRun, "agentId" | "taskId">>,
): ReadonlyArray<AgentQueue> {
  return agents.map((agent) => {
    const active = [
      ...new Set(activeRuns.filter((run) => run.agentId === agent.id).map((run) => run.taskId)),
    ];
    const base = {
      id: agent.id,
      name: agent.name,
      role: agent.config.role,
      model: `${agent.config.modelSelection.instanceId}/${agent.config.modelSelection.model}`,
      startStatuses: agent.startStatuses,
      startTags: agent.startTags,
    };
    const activeField = active.length > 0 ? { active } : {};
    if (agent.startRunStatuses.length > 0) {
      return { ...base, startRunStatuses: agent.startRunStatuses, ...activeField };
    }
    // A person's own task is in no agent's queue unless its tags hand it over.
    const mine = tasks.filter(
      (task) =>
        agentMayTakeTask(agent, task) && agent.startTags.every((tag) => task.tags.includes(tag)),
    );
    const queue = Object.fromEntries(
      [...agent.startStatuses.filter((status) => status !== IN_PROGRESS), IN_PROGRESS].map(
        (status) => [status, mine.filter((task) => task.status === status).length],
      ),
    );
    const inProgress = mine.filter((task) => task.status === IN_PROGRESS).map((task) => task.id);
    return { ...base, queue, ...(inProgress.length > 0 ? { inProgress } : {}), ...activeField };
  });
}

/**
 * The project's enabled agents (its own and global ones) with their queues, so
 * a chat can route and queue a task without task_search or agent_get.
 */
export const projectAgentQueues = (repository: TaskRepositoryShape, projectId: ProjectId) =>
  Effect.gen(function* () {
    const enabled = yield* repository.searchAgents({ projectId, enabled: true, limit: 500 });
    const agents = enabled.slice(0, MAX_AGENTS);
    const queued = agents.filter((agent) => agent.startRunStatuses.length === 0);
    const tasks = yield* Effect.forEach(
      queued.length === 0 ? [] : queueStatuses(queued),
      (status) => repository.search({ projectId, status, limit: MAX_TASKS_PER_STATUS }),
    );
    const agentIds = new Set(agents.map((agent) => agent.id));
    const runs = (yield* repository.listAllActiveAgentRuns()).filter((run) =>
      agentIds.has(run.agentId),
    );
    // Global agents also run in other projects; only this project's tasks show.
    const held = yield* Effect.forEach(new Set(runs.map((run) => run.taskId)), (id) =>
      repository.getById({ id }),
    );
    const projectTaskIds = new Set(
      held.flatMap((task) =>
        Option.isSome(task) && task.value.projectId === projectId ? [task.value.id] : [],
      ),
    );
    return {
      agents: agentQueues(
        agents,
        tasks.flat(),
        runs.filter((run) => projectTaskIds.has(run.taskId)),
      ),
      ...(enabled.length > agents.length ? { agentsOmitted: enabled.length - agents.length } : {}),
    };
  });
