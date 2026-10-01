import type {
  TaskAutomation,
  TaskAutomationRun,
  TaskAutomationRunSearchInput,
  TaskAutomationSearchInput,
} from "@upcomputer/tasks-contracts/v1";
import type { EnvironmentId, ProjectId } from "@upcomputer/contracts";

import type { TasksWebAccess, TasksWebRpcClient } from "../rpc/index.ts";

export type ScopedTaskAutomation = TaskAutomation & {
  readonly environmentId: EnvironmentId;
  readonly projectName: string | null;
};

export type ScopedTaskAutomationRun = TaskAutomationRun & {
  readonly environmentId: EnvironmentId;
};

export type EnvironmentAutomationsState =
  | {
      readonly status: "loading" | "ready";
      readonly automations: ReadonlyArray<ScopedTaskAutomation>;
      readonly runs: ReadonlyArray<ScopedTaskAutomationRun>;
    }
  | {
      readonly status: "unavailable" | "error";
      readonly automations: ReadonlyArray<ScopedTaskAutomation>;
      readonly runs: ReadonlyArray<ScopedTaskAutomationRun>;
      readonly message: string;
    };

export interface AutomationsDataState {
  readonly byEnvironment: Readonly<Record<string, EnvironmentAutomationsState>>;
  readonly automations: ReadonlyArray<ScopedTaskAutomation>;
  readonly runs: ReadonlyArray<ScopedTaskAutomationRun>;
}

export interface AutomationsStateTarget {
  readonly environmentId: EnvironmentId;
  readonly client: TasksWebRpcClient;
  readonly access: TasksWebAccess;
  readonly automationSearch?: TaskAutomationSearchInput;
  readonly runSearch?: TaskAutomationRunSearchInput;
  readonly projectNameById?: ReadonlyMap<ProjectId, string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Failed to load automations.";
}

export async function loadAutomationsState(
  targets: ReadonlyArray<AutomationsStateTarget>,
  previous?: AutomationsDataState,
): Promise<AutomationsDataState> {
  const entries = await Promise.all(
    targets.map(async (target): Promise<readonly [string, EnvironmentAutomationsState]> => {
      const prior = previous?.byEnvironment[target.environmentId];
      const previousAutomations = prior?.automations ?? [];
      const previousRuns = prior?.runs ?? [];
      if (!target.access.canReadAutomations) {
        return [
          target.environmentId,
          {
            status: "unavailable",
            automations: previousAutomations,
            runs: previousRuns,
            message: target.access.reason,
          },
        ];
      }
      const [automationsResult, runsResult] = await Promise.allSettled([
        target.client.automations.search(target.automationSearch ?? { limit: 200 }),
        target.client.automations.searchRuns(target.runSearch ?? { limit: 200 }),
      ]);
      const automations =
        automationsResult.status === "fulfilled"
          ? automationsResult.value.automations.map((automation) => ({
              ...automation,
              environmentId: target.environmentId,
              projectName: target.projectNameById?.get(automation.projectId) ?? null,
            }))
          : previousAutomations;
      const runs =
        runsResult.status === "fulfilled"
          ? runsResult.value.runs.map((run) => ({ ...run, environmentId: target.environmentId }))
          : previousRuns;
      if (automationsResult.status === "fulfilled" || runsResult.status === "fulfilled") {
        return [target.environmentId, { status: "ready", automations, runs }];
      }
      return [
        target.environmentId,
        {
          status: "error",
          automations,
          runs,
          message: errorMessage(
            automationsResult.status === "rejected" ? automationsResult.reason : runsResult.reason,
          ),
        },
      ];
    }),
  );
  const byEnvironment = Object.fromEntries(entries);
  const automations = entries
    .flatMap(([, state]) => state.automations)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const runs = entries
    .flatMap(([, state]) => state.runs)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { byEnvironment, automations, runs };
}
