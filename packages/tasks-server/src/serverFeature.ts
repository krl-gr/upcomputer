import {
  ORCHESTRATOR_PROPOSAL_READS_RPC_CAPABILITY,
  ORCHESTRATOR_PROPOSALS_RPC_CAPABILITY,
  TASK_AGENTS_RPC_CAPABILITY,
  TASK_AUTOMATIONS_RPC_CAPABILITY,
  TASKS_RPC_CAPABILITY,
} from "@upcomputer/tasks-contracts/v1/rpc";
import type { ExperimentalProductExtensionRegistration } from "@upcomputer/shared/product";
import * as Layer from "effect/Layer";

import {
  eraseExperimentalServerLayer,
  type ExperimentalServerFeatureContribution,
} from "../../../apps/server/src/extensionApi.ts";
import { TaskAgentResultConsumerLive } from "./agents/TaskAgentResultConsumer.ts";
import { TaskAgentServiceLive } from "./agents/TaskAgentService.ts";
import { TaskAutomationServiceLive } from "./automations/TaskAutomationService.ts";
import { TaskToolContextResolverLive } from "./context/TaskToolContextResolver.ts";
import { TASK_MCP_HTTP_CONTRIBUTION } from "./mcp/TaskMcpRoute.ts";
import {
  TASK_MIGRATION_CONTRIBUTION,
  TaskPromptSettingsStoreLive,
  TaskRepositoryLive,
} from "./persistence/index.ts";
import { ProposalApplicationServiceLive } from "./proposals/ProposalApplicationService.ts";
import { ProposalStoreLive } from "./proposals/ProposalStore.ts";
import { StructuredProposalConsumerLive } from "./proposals/StructuredProposalConsumer.ts";
import { ORCHESTRATOR_PROPOSAL_MIGRATION_CONTRIBUTION } from "./proposals/migrations.ts";
import { TASK_RPC_CONTRIBUTIONS } from "./rpc/contributions.ts";
import { TaskToolServiceLive } from "./tools/TaskToolService.ts";
import { TaskDynamicToolRegistrationLive } from "./tools/contribution.ts";

export const TASKS_FEATURE_ID = "upcomputer.tasks" as const;

export function makeTasksServerFeature(): ExperimentalServerFeatureContribution {
  const taskBaseServicesLive = Layer.mergeAll(
    TaskRepositoryLive,
    TaskPromptSettingsStoreLive,
    ProposalStoreLive,
  );
  const taskServicesWithAgentsLive = TaskAgentServiceLive.pipe(
    Layer.provideMerge(taskBaseServicesLive),
  );
  const taskServicesWithContextLive = TaskToolContextResolverLive.pipe(
    Layer.provideMerge(taskServicesWithAgentsLive),
  );
  const taskServicesWithToolsLive = TaskToolServiceLive.pipe(
    Layer.provideMerge(taskServicesWithContextLive),
  );
  const taskServicesLive = ProposalApplicationServiceLive.pipe(
    Layer.provideMerge(taskServicesWithToolsLive),
  );
  const taskBackgroundLive = Layer.mergeAll(
    StructuredProposalConsumerLive,
    TaskAgentResultConsumerLive,
    TaskAutomationServiceLive,
    TaskDynamicToolRegistrationLive,
  ).pipe(Layer.provide(taskServicesLive));

  return {
    id: TASKS_FEATURE_ID,
    version: 1,
    layers: [
      {
        id: "tasks-services",
        ownerId: TASKS_FEATURE_ID,
        version: 1,
        layer: eraseExperimentalServerLayer(taskServicesLive),
      },
      {
        id: "tasks-background",
        ownerId: TASKS_FEATURE_ID,
        version: 1,
        layer: eraseExperimentalServerLayer(taskBackgroundLive),
      },
    ],
    httpRoutes: [TASK_MCP_HTTP_CONTRIBUTION],
    rpc: TASK_RPC_CONTRIBUTIONS,
    migrations: [TASK_MIGRATION_CONTRIBUTION, ORCHESTRATOR_PROPOSAL_MIGRATION_CONTRIBUTION],
  };
}

export const TASKS_SERVER_FEATURE = makeTasksServerFeature();

/** Product-manifest entry advertising the Tasks RPC capabilities. */
export const TASKS_PRODUCT_EXTENSION = {
  id: TASKS_FEATURE_ID,
  displayName: "Tasks and Task Agents",
  description:
    "Durable tasks, delegated task agents, scheduled automations, and proposal application workflows.",
  version: "1.0.0",
  source: "core",
  availability: "free",
  enabled: true,
  capabilities: [
    TASKS_RPC_CAPABILITY,
    TASK_AGENTS_RPC_CAPABILITY,
    TASK_AUTOMATIONS_RPC_CAPABILITY,
    ORCHESTRATOR_PROPOSAL_READS_RPC_CAPABILITY,
    ORCHESTRATOR_PROPOSALS_RPC_CAPABILITY,
  ],
} as const satisfies ExperimentalProductExtensionRegistration;
