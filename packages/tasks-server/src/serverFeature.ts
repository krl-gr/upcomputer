import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  defineExperimentalServerFeature,
  eraseExperimentalServerLayer,
  forkParked,
} from "../../../apps/server/src/extensionApi.ts";
import { TaskAgentOrchestrationInstructionsLive } from "./agents/TaskAgentOrchestrationInstructions.ts";
import { TaskChatToolHintsLive } from "./tools/TaskChatToolHints.ts";
import { TaskAgentService, TaskAgentServiceLive } from "./agents/TaskAgentService.ts";
import { TaskSourceWakeLive } from "./agents/TaskSourceWake.ts";
import { TaskAutomationServiceLive } from "./automations/TaskAutomationService.ts";
import { TaskToolContextResolverLive } from "./context/TaskToolContextResolver.ts";
import { InboxProjectLive } from "./inbox/InboxProject.ts";
import { TaskMcpToolsLive } from "./mcp/TaskMcpTools.ts";
import {
  AllChatsInstructionsLive,
  TASK_MIGRATION_CONTRIBUTION,
  TaskPromptSettingsStoreLive,
  TaskRepositoryLive,
} from "./persistence/index.ts";
import { retryOperational } from "./retryOperational.ts";
import { TASK_RPC_CONTRIBUTIONS } from "./rpc/contributions.ts";
import { TaskReminderSweeperLive } from "./schedule/TaskReminderSweeper.ts";
import { TaskScheduleServiceLive } from "./schedule/TaskScheduleService.ts";
import { TaskToolServiceLive } from "./tools/TaskToolService.ts";
import { TaskFeatureCountsLive } from "./telemetry/featureCounts.ts";
import * as Bots from "./bots/BotService.ts";
import { BotContextLive, BOTS_RPC_CONTRIBUTION } from "./bots/contributions.ts";
import { BotMcpToolsLive } from "./bots/BotMcpTools.ts";

const TASKS_FEATURE_ID = "upcomputer.tasks";

const taskAgentsLive = TaskAgentServiceLive.pipe(
  Layer.provideMerge(Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive)),
  Layer.provide(AllChatsInstructionsLive),
);

export const TaskServicesLive = TaskToolServiceLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      TaskToolContextResolverLive,
      TaskAutomationServiceLive,
      TaskSourceWakeLive,
      InboxProjectLive,
      TaskScheduleServiceLive,
      Bots.layer,
    ),
  ),
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
        Layer.mergeAll(
          TaskRecoveryLive,
          TaskReminderSweeperLive,
          TaskAgentOrchestrationInstructionsLive,
          TaskChatToolHintsLive,
          BotContextLive,
          TaskFeatureCountsLive,
        ).pipe(Layer.provideMerge(TaskServicesLive)),
      ),
    },
  ],
  mcpTools: [
    {
      id: "task-tools",
      ownerId: TASKS_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(Layer.merge(TaskMcpToolsLive, BotMcpToolsLive)),
    },
  ],
  rpc: [...TASK_RPC_CONTRIBUTIONS, BOTS_RPC_CONTRIBUTION],
});
