import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  TASK_AGENTS_RPC_METHODS,
  TASKS_RPC_METHODS,
  TaskAgentId,
  TaskAgentsRpcGroup,
  TasksRpcGroup,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import {
  AnalyticsService,
  runExperimentalFeatureMigrations,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { BotService } from "../bots/BotService.ts";
import { InboxProject } from "../inbox/InboxProject.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStore } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskScheduleService } from "../schedule/TaskScheduleService.ts";
import { TASK_RPC_CONTRIBUTIONS } from "./contributions.ts";

const project = ProjectId.make("project-1");
const milestones: Array<{ event: string; properties: unknown }> = [];

const rpcHandlers = TASK_RPC_CONTRIBUTIONS.map((contribution) =>
  contribution.handlers({ currentSessionId: "test" as never }),
);

const layer = Layer.mergeAll(
  TaskRepositoryLive.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    Layer.provideMerge(NodeServices.layer),
  ),
  Layer.succeed(InboxProject, { ensure: Effect.succeed(project) }),
  Layer.succeed(TaskAgentService, {
    scheduleTaskChanged: () => Effect.void,
    scheduleAgentChanged: () => Effect.void,
  } as never),
  Layer.succeed(TaskScheduleService, {} as never),
  Layer.succeed(TaskPromptSettingsStore, {} as never),
  Layer.mock(AnalyticsService)({
    enabled: true,
    sessionId: undefined,
    recordMilestone: (event, properties) =>
      Effect.sync(() => void milestones.push({ event, properties })),
  }),
  Layer.mock(BotService)({ nameChat: () => Effect.void }),
);

it.effect("a task or agent made in the app is a first use; editing an agent is not", () =>
  Effect.gen(function* () {
    const tasks = yield* RpcTest.makeClient(TasksRpcGroup);
    const agents = yield* RpcTest.makeClient(TaskAgentsRpcGroup);
    yield* tasks[TASKS_RPC_METHODS.create]({
      projectId: project,
      title: "Fix the login bug",
      description: "",
      status: "To Do",
    });
    const agent = {
      id: TaskAgentId.make("task-agent-1"),
      projectId: project,
      name: "Reviewer",
      config: {
        role: "Reviewer",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        instructions: "Review the task.",
      },
    };
    yield* agents[TASK_AGENTS_RPC_METHODS.upsert](agent);
    yield* agents[TASK_AGENTS_RPC_METHODS.upsert]({ ...agent, name: "Senior reviewer" });

    assert.deepStrictEqual(milestones, [
      { event: "app.first_task_created", properties: { via: "app" } },
      { event: "app.first_agent_created", properties: { via: "app" } },
    ]);
  }).pipe(
    Effect.provide(Layer.mergeAll(rpcHandlers[0]!, ...rpcHandlers.slice(1))),
    Effect.provide(layer),
    Effect.scoped,
  ),
);
