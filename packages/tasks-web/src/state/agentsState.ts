import type {
  TaskAgent,
  TaskAgentRun,
  TaskAgentRunSearchInput,
  TaskAgentSearchInput,
} from "@upcomputer/tasks-contracts/v1";
import type { EnvironmentId, ProjectId } from "@upcomputer/contracts";

import type { TasksWebAccess, TasksWebRpcClient } from "../rpc/index.ts";

export type ScopedTaskAgent = TaskAgent & {
  readonly environmentId: EnvironmentId;
  readonly projectName: string | null;
};

export type ScopedTaskAgentRun = TaskAgentRun & {
  readonly environmentId: EnvironmentId;
};

export type EnvironmentAgentsState =
  | {
      readonly status: "loading";
      readonly agents: ReadonlyArray<ScopedTaskAgent>;
      readonly runs: ReadonlyArray<ScopedTaskAgentRun>;
    }
  | {
      readonly status: "ready";
      readonly agents: ReadonlyArray<ScopedTaskAgent>;
      readonly runs: ReadonlyArray<ScopedTaskAgentRun>;
    }
  | {
      readonly status: "unavailable";
      readonly agents: ReadonlyArray<ScopedTaskAgent>;
      readonly runs: ReadonlyArray<ScopedTaskAgentRun>;
      readonly message: string;
    }
  | {
      readonly status: "error";
      readonly agents: ReadonlyArray<ScopedTaskAgent>;
      readonly runs: ReadonlyArray<ScopedTaskAgentRun>;
      readonly message: string;
    };

export interface AgentsDataState {
  readonly byEnvironment: Readonly<Record<string, EnvironmentAgentsState>>;
  readonly agents: ReadonlyArray<ScopedTaskAgent>;
  readonly runs: ReadonlyArray<ScopedTaskAgentRun>;
}

export interface AgentsStateTarget {
  readonly environmentId: EnvironmentId;
  readonly client: TasksWebRpcClient;
  readonly access: TasksWebAccess;
  readonly agentSearch?: TaskAgentSearchInput;
  readonly runSearch?: TaskAgentRunSearchInput;
  readonly projectNameById?: ReadonlyMap<ProjectId, string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Failed to load task agents.";
}

export async function loadAgentsState(
  targets: ReadonlyArray<AgentsStateTarget>,
  previous?: AgentsDataState,
): Promise<AgentsDataState> {
  const entries = await Promise.all(
    targets.map(async (target): Promise<readonly [string, EnvironmentAgentsState]> => {
      const prior = previous?.byEnvironment[target.environmentId];
      const previousAgents = prior?.agents ?? [];
      const previousRuns = prior?.runs ?? [];
      if (!target.access.canReadAgents) {
        return [
          target.environmentId,
          {
            status: "unavailable",
            agents: previousAgents,
            runs: previousRuns,
            message: target.access.reason,
          },
        ];
      }
      const [agentsResult, runsResult] = await Promise.allSettled([
        target.client.agents.search(target.agentSearch ?? { limit: 200 }),
        target.client.agents.searchRuns(target.runSearch ?? { limit: 500 }),
      ]);
      const agents =
        agentsResult.status === "fulfilled"
          ? agentsResult.value.agents.map((agent) => ({
              ...agent,
              environmentId: target.environmentId,
              projectName:
                agent.projectId === null
                  ? null
                  : (target.projectNameById?.get(agent.projectId) ?? null),
            }))
          : previousAgents;
      const runs =
        runsResult.status === "fulfilled"
          ? runsResult.value.runs.map((run) => ({
              ...run,
              environmentId: target.environmentId,
            }))
          : previousRuns;
      if (agentsResult.status === "fulfilled" || runsResult.status === "fulfilled") {
        return [target.environmentId, { status: "ready", agents, runs }];
      }
      return [
        target.environmentId,
        {
          status: "error",
          agents,
          runs,
          message: errorMessage(
            agentsResult.status === "rejected"
              ? agentsResult.reason
              : runsResult.status === "rejected"
                ? runsResult.reason
                : undefined,
          ),
        },
      ];
    }),
  );
  const byEnvironment = Object.fromEntries(entries);
  const agents = entries
    .flatMap(([, state]) => state.agents)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const runs = entries
    .flatMap(([, state]) => state.runs)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  return { byEnvironment, agents, runs };
}
