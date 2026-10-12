import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TASKS_RPC_METHODS, TaskId, TasksRpcGroup } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { InboxProject } from "../inbox/InboxProject.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStore } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskScheduleService } from "../schedule/TaskScheduleService.ts";
import { TASKS_RPC_CONTRIBUTION } from "./contributions.ts";

const project = ProjectId.make("project-1");

const layer = Layer.mergeAll(
  TaskRepositoryLive.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    Layer.provideMerge(NodeServices.layer),
  ),
  Layer.succeed(InboxProject, { ensure: Effect.succeed(project) }),
  Layer.succeed(TaskAgentService, { scheduleTaskChanged: () => Effect.void } as never),
  Layer.succeed(TaskScheduleService, {} as never),
  Layer.succeed(TaskPromptSettingsStore, {} as never),
);

it.effect("over RPC a person task is To Do or Done, and a task handed back reopens", () =>
  Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(TasksRpcGroup);
    const create = (title: string, status: string, audience: "agent" | "person") =>
      client[TASKS_RPC_METHODS.create]({
        projectId: project,
        title,
        description: "",
        status,
        audience,
      });

    const refused = yield* Effect.flip(create("deferred", "Backlog", "person"));
    assert.include(refused.message, 'not "Backlog"');
    const mine = yield* create("call the bank", "To Do", "person");
    const blocked = yield* Effect.flip(
      client[TASKS_RPC_METHODS.update]({ id: TaskId.make(mine.id), status: "Blocked" }),
    );
    assert.include(blocked.message, "leave it unscheduled or set notBefore");

    // Agent statuses stay the agents' own.
    const working = yield* create("build", "In Progress", "agent");
    const finished = yield* create("ship", "Done", "agent");
    assert.equal(working.status, "In Progress");
    const reopened = yield* client[TASKS_RPC_METHODS.update]({
      id: TaskId.make(working.id),
      audience: "person",
    });
    const stillDone = yield* client[TASKS_RPC_METHODS.update]({
      id: TaskId.make(finished.id),
      audience: "person",
    });
    assert.deepStrictEqual([reopened.status, stillDone.status], ["To Do", "Done"]);
    // Back to agents, the status stays as the person left it.
    const toAgents = yield* client[TASKS_RPC_METHODS.update]({
      id: TaskId.make(reopened.id),
      audience: "agent",
    });
    assert.equal(toAgents.status, "To Do");
  }).pipe(
    Effect.provide(TASKS_RPC_CONTRIBUTION.handlers({ currentSessionId: "test" as never })),
    Effect.provide(layer),
    Effect.scoped,
  ),
);
