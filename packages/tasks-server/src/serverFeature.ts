import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  defineExperimentalServerFeature,
  eraseExperimentalServerLayer,
  forkParked,
} from "../../../apps/server/src/extensionApi.ts";
import { TaskAgentService, TaskAgentServiceLive } from "./agents/TaskAgentService.ts";
import { TaskAutomationServiceLive } from "./automations/TaskAutomationService.ts";
import { TaskToolContextResolverLive } from "./context/TaskToolContextResolver.ts";
import { TaskMcpToolsLive } from "./mcp/TaskMcpTools.ts";
import {
  AllChatsInstructionsUnavailableLive,
  TASK_MIGRATION_CONTRIBUTION,
  TaskPromptSettingsStoreLive,
  TaskRepositoryLive,
} from "./persistence/index.ts";
import { retryOperational } from "./retryOperational.ts";
import { TASK_RPC_CONTRIBUTIONS } from "./rpc/contributions.ts";
import { TaskToolServiceLive } from "./tools/TaskToolService.ts";

const TASKS_FEATURE_ID = "upcomputer.tasks";

const taskAgentsLive = TaskAgentServiceLive.pipe(
  Layer.provideMerge(Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive)),
  Layer.provide(AllChatsInstructionsUnavailableLive),
);

export const TaskServicesLive = TaskToolServiceLive.pipe(
  Layer.provideMerge(Layer.mergeAll(TaskToolContextResolverLive, TaskAutomationServiceLive)),
  Layer.provideMerge(taskAgentsLive),
);

/** After activation, settles runs that ended while the server was down and starts due agents. */
const TaskRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* TaskAgentService;
    yield* forkParked(retryOperational(agents.recover, { operation: "recover-task-agents" }));
  }),
);

/** Tasks, task agents, automations and instructions: the first UpComputer product feature. */
export const TASKS_SERVER_FEATURE = defineExperimentalServerFeature({
  id: TASKS_FEATURE_ID,
  version: 1,
  migrations: [TASK_MIGRATION_CONTRIBUTION],
  layers: [
    {
      id: "tasks-services",
      ownerId: TASKS_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(
        TaskRecoveryLive.pipe(Layer.provideMerge(TaskServicesLive)),
      ),
    },
  ],
  mcpTools: [
    {
      id: "task-tools",
      ownerId: TASKS_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(TaskMcpToolsLive),
    },
  ],
  rpc: TASK_RPC_CONTRIBUTIONS,
});
