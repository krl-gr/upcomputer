import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAutomationId, type TaskAutomation } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import { afterEach } from "vite-plus/test";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

const automation = (id: string, updatedAt: string): TaskAutomation => ({
  id: TaskAutomationId.make(id),
  projectId: ProjectId.make("project-1"),
  name: id,
  status: "draft",
  schedule: { cron: "0 9 * * *", timezone: "UTC" },
  template: { title: id, description: "", status: "new", priority: null, tags: [] },
  catchUpPolicy: "fire-once",
  skipIfOpen: true,
  createdBy: "user",
  sourceThreadId: null,
  nextRunAt: null,
  lastFiredAt: null,
  lastFiredSlot: null,
  lastTaskId: null,
  lastError: null,
  failureCount: 0,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt,
});

it.effect("existing automations get the page's order; new ones go first; reorder moves one", () =>
  Effect.gen(function* () {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tasks-automation-rank-"));
    directories.push(directory);
    const filename = NodePath.join(directory, "tasks.sqlite");
    const sql = NodeSqliteClient.layer({ filename });
    const before = {
      ...TASK_MIGRATION_CONTRIBUTION,
      migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(({ version }) => version <= 23),
    };
    yield* runExperimentalFeatureMigrations([before]).pipe(Effect.provide(sql));
    // Rows as the previous schema stored them; the Automations page listed the latest update first.
    const legacy = new NodeSqlite.DatabaseSync(filename);
    const legacyRows: ReadonlyArray<readonly [string, string]> = [
      ["older", "2026-10-02T10:00:00.000Z"],
      ["newest", "2026-10-04T10:00:00.000Z"],
      ["middle", "2026-10-03T10:00:00.000Z"],
    ];
    for (const [id, updatedAt] of legacyRows)
      legacy
        .prepare(`INSERT INTO task_automations (id, project_id, name, status, schedule_json,
          template_json, catch_up_policy, skip_if_open, created_by, created_at, updated_at)
          VALUES (?, 'project-1', ?, 'draft', '{"cron":"0 9 * * *","timezone":"UTC"}',
            '{"title":"t","description":"","status":"new","priority":null,"tags":[]}',
            'fire-once', 1, 'user', '2026-10-01T10:00:00.000Z', ?)`)
        .run(id, id, updatedAt);
    legacy.close();

    yield* Effect.gen(function* () {
      yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
      const repository = yield* TaskRepository;
      const order = () =>
        repository
          .searchAutomations({})
          .pipe(Effect.map((automations) => automations.map(({ id }) => id as string)));
      assert.deepStrictEqual(yield* order(), ["newest", "middle", "older"]);

      // A new automation goes first, from the RPC upsert and the tool insert alike.
      yield* repository.upsertAutomation(automation("created", "2026-09-01T10:00:00.000Z"));
      yield* repository.insertAutomation(automation("proposed", "2026-09-01T10:00:00.000Z"));
      assert.deepStrictEqual(yield* order(), ["proposed", "created", "newest", "middle", "older"]);
      // Edits keep the place; updatedAt no longer orders the list.
      const edited = yield* repository.upsertAutomation(
        automation("older", "2026-10-09T10:00:00.000Z"),
      );
      assert.equal(edited.name, "older");
      assert.deepStrictEqual(yield* order(), ["proposed", "created", "newest", "middle", "older"]);

      const id = (value: string) => TaskAutomationId.make(value);
      yield* repository.reorderAutomation({ id: id("older"), afterAutomationId: id("proposed") });
      assert.deepStrictEqual(yield* order(), ["proposed", "older", "created", "newest", "middle"]);
      yield* repository.reorderAutomation({ id: id("middle"), beforeAutomationId: id("created") });
      assert.deepStrictEqual(yield* order(), ["proposed", "older", "middle", "created", "newest"]);
      yield* repository.reorderAutomation({ id: id("newest") });
      assert.deepStrictEqual(
        yield* order(),
        ["newest", "proposed", "older", "middle", "created"],
        "first without a neighbor",
      );
      const ownNeighbor = yield* Effect.flip(
        repository.reorderAutomation({ id: id("older"), afterAutomationId: id("older") }),
      );
      assert.equal(ownNeighbor._tag, "TaskPersistenceSqlError");
      yield* Effect.flip(repository.reorderAutomation({ id: id("missing") }));
      yield* Effect.flip(
        repository.reorderAutomation({ id: id("older"), beforeAutomationId: id("missing") }),
      );
      assert.deepStrictEqual(yield* order(), ["newest", "proposed", "older", "middle", "created"]);

      // Repeated moves into the same gap exhaust it; the order is rebalanced, not broken.
      for (let round = 0; round < 40; round += 1) {
        const current = yield* order();
        const moving = current.at(-1)!;
        yield* repository.reorderAutomation({
          id: id(moving),
          afterAutomationId: id(current[0]!),
        });
      }
      assert.equal(new Set(yield* order()).size, 5);
    }).pipe(Effect.provide(TaskRepositoryLive), Effect.provide(sql));

    const db = new NodeSqlite.DatabaseSync(filename);
    try {
      assert.throws(
        () =>
          db
            .prepare(`INSERT INTO task_automations (id, project_id, name, status, schedule_json,
              template_json, catch_up_policy, skip_if_open, created_by, created_at, updated_at)
              VALUES ('no-rank', 'p', 'n', 'draft', '{}', '{}', 'skip', 1, 'user', 'x', 'x')`)
            .run(),
        /rank is required/,
      );
    } finally {
      db.close();
    }
  }),
);
