import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TASKS_RPC_METHODS, TaskId, TasksRpcGroup } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { afterEach } from "vite-plus/test";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
} from "../../../../apps/server/src/extensionApi.ts";
import { ProjectService } from "../../../../apps/server/src/project/ProjectService.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStore } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TASKS_RPC_CONTRIBUTION } from "../rpc/contributions.ts";
import { TaskScheduleService } from "../schedule/TaskScheduleService.ts";
import { INBOX_FOLDER, InboxProject, InboxProjectLive } from "./InboxProject.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

interface FakeProject {
  readonly id: ProjectId;
  title: string;
  readonly workspaceRoot: string;
  deleted: boolean;
}

/**
 * Core projects as the Inbox sees them: bootstrap finds the active project
 * on a folder or creates one, getShell sees active projects only.
 */
function harness() {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tasks-inbox-"));
  directories.push(home);
  const projects: FakeProject[] = [];
  let bootstraps = 0;
  const core = Layer.mergeAll(
    Layer.succeed(ServerConfig, { baseDir: home } as never),
    Layer.succeed(ProjectService, {
      bootstrap: (input: { projectId: ProjectId; title: string; workspaceRoot: string }) =>
        Effect.sync(() => {
          bootstraps += 1;
          const existing = projects.find(
            (project) => !project.deleted && project.workspaceRoot === input.workspaceRoot,
          );
          if (existing) return { project: existing, created: false };
          const project = { ...input, id: input.projectId, deleted: false };
          projects.push(project);
          return { project, created: true };
        }),
    } as never),
    Layer.succeed(ProjectStoreV2, {
      getShell: (id: ProjectId) =>
        Effect.sync(() =>
          Option.fromUndefinedOr(projects.find((project) => project.id === id && !project.deleted)),
        ),
    } as never),
  );
  const storage = TaskRepositoryLive.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  );
  const layer = InboxProjectLive.pipe(
    Layer.provideMerge(Layer.mergeAll(storage, core, NodeServices.layer)),
  );
  return { home, projects, bootstraps: () => bootstraps, layer };
}

it.effect("the Inbox is created once on its folder, reused, and recreated after deletion", () => {
  const { home, projects, bootstraps, layer } = harness();
  return Effect.gen(function* () {
    const inbox = yield* InboxProject;
    const [first, concurrent] = yield* Effect.all([inbox.ensure, inbox.ensure], {
      concurrency: "unbounded",
    });
    assert.equal(first, concurrent);
    assert.equal(projects.length, 1);
    assert.equal(projects[0]!.title, "Inbox");
    assert.equal(projects[0]!.workspaceRoot, NodePath.join(home, INBOX_FOLDER));
    assert.ok(NodeFS.statSync(NodePath.join(home, INBOX_FOLDER)).isDirectory());

    // Renaming it keeps it the Inbox: the stored id is used, core is not asked.
    projects[0]!.title = "Personal";
    const calls = bootstraps();
    assert.equal(yield* inbox.ensure, first);
    assert.equal(bootstraps(), calls);

    projects[0]!.deleted = true;
    const recreated = yield* inbox.ensure;
    assert.notEqual(recreated, first);
    assert.equal(yield* inbox.ensure, recreated);
    assert.deepStrictEqual(
      projects.map(({ deleted }) => deleted),
      [true, false],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("a task created over RPC without a project goes to the Inbox, at its placement", () => {
  const { layer } = harness();
  const services = Layer.mergeAll(
    Layer.succeed(TaskAgentService, { scheduleTaskChanged: () => Effect.void } as never),
    Layer.succeed(TaskScheduleService, {} as never),
    Layer.succeed(TaskPromptSettingsStore, {} as never),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(TasksRpcGroup);
    const base = { description: "", status: "To Do" } as const;
    const first = yield* client[TASKS_RPC_METHODS.create]({
      ...base,
      projectId: ProjectId.make("project-1"),
      title: "first",
    });
    const second = yield* client[TASKS_RPC_METHODS.create]({
      ...base,
      projectId: ProjectId.make("project-1"),
      title: "second",
    });
    const mine = yield* client[TASKS_RPC_METHODS.create]({
      ...base,
      title: "sign the contract",
      audience: "person",
      afterTaskId: second.id,
    });
    assert.equal(mine.projectId, yield* (yield* InboxProject).ensure);
    assert.deepStrictEqual([mine.audience, mine.kind], ["person", "task"]);
    const order = (yield* (yield* TaskRepository).page({})).tasks.map(({ title }) => title);
    assert.deepStrictEqual(order, ["second", "sign the contract", "first"]);

    // A routine must be a person task; the error says so.
    const refused = yield* Effect.flip(
      client[TASKS_RPC_METHODS.create]({ ...base, title: "gym", kind: "routine" }),
    );
    assert.include(refused.message, "routine is a person task");
    const moved = yield* client[TASKS_RPC_METHODS.update]({
      id: TaskId.make(first.id),
      projectId: mine.projectId,
      audience: "person",
    });
    assert.deepStrictEqual([moved.projectId, moved.audience], [mine.projectId, "person"]);
  }).pipe(
    Effect.provide(TASKS_RPC_CONTRIBUTION.handlers({ currentSessionId: "test" as never })),
    Effect.provide(Layer.merge(layer, services)),
    Effect.scoped,
  );
});
