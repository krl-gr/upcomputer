import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { afterEach } from "vite-plus/test";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const timestamp = "2026-10-07T10:00:00.000Z";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

it.effect("existing tasks become agent tasks, and routines must stay person tasks", () =>
  Effect.gen(function* () {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tasks-audience-"));
    directories.push(directory);
    const filename = NodePath.join(directory, "tasks.sqlite");
    const sql = NodeSqliteClient.layer({ filename });
    const before = {
      ...TASK_MIGRATION_CONTRIBUTION,
      migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(({ version }) => version <= 19),
    };
    yield* runExperimentalFeatureMigrations([before]).pipe(Effect.provide(sql));
    // A row as the previous schema stored it.
    const legacy = new NodeSqlite.DatabaseSync(filename);
    legacy
      .prepare(`INSERT INTO tasks (id, rank, project_id, title, description, status, created_by,
        metadata_json, created_at, updated_at, trigger_changed_at)
        VALUES ('old', '0000000100000000', 'project-1', 'old', '', 'To Do', 'test', 'null', ?, ?, ?)`)
      .run(timestamp, timestamp, timestamp);
    legacy.close();

    yield* Effect.gen(function* () {
      yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
      const repository = yield* TaskRepository;
      const old = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("old") }));
      assert.deepStrictEqual([old.audience, old.kind], ["agent", "task"]);
      assert.equal(old.triggerChangedAt, timestamp, "the upgrade is not a trigger change");
    }).pipe(Effect.provide(TaskRepositoryLive), Effect.provide(sql));

    const db = new NodeSqlite.DatabaseSync(filename);
    try {
      const revision = () =>
        (
          db.prepare("SELECT revision FROM task_list_revision WHERE id = 1").get() as {
            revision: number;
          }
        ).revision;
      const insert = (id: string, rank: string, audience: string, kind: string) =>
        db
          .prepare(`INSERT INTO tasks (id, rank, project_id, title, description, status,
            created_by, metadata_json, created_at, updated_at, trigger_changed_at, audience, kind)
            VALUES (?, ?, 'project-1', ?, '', 'To Do', 'test', 'null', ?, ?, ?, ?, ?)`)
          .run(id, rank, id, timestamp, timestamp, timestamp, audience, kind);
      assert.throws(
        () => insert("bad", "0000000200000000", "agent", "routine"),
        /routines are person tasks/,
      );
      assert.throws(() => insert("bad", "0000000200000000", "robot", "task"), /CHECK/);
      insert("routine", "0000000300000000", "person", "routine");
      assert.throws(
        () => db.prepare("UPDATE tasks SET audience = 'agent' WHERE id = 'routine'").run(),
        /routines are person tasks/,
      );
      assert.throws(
        () => db.prepare("UPDATE tasks SET kind = 'routine' WHERE id = 'old'").run(),
        /routines are person tasks/,
      );

      // Audience and kind decide list membership, so a page cursor must not survive them.
      const start = revision();
      db.prepare("UPDATE tasks SET audience = 'person' WHERE id = 'old'").run();
      assert.equal(revision(), start + 1);
      db.prepare("UPDATE tasks SET kind = 'routine' WHERE id = 'old'").run();
      assert.equal(revision(), start + 2);
      db.prepare("UPDATE tasks SET output = 'cosmetic' WHERE id = 'old'").run();
      assert.equal(revision(), start + 2);
    } finally {
      db.close();
    }
  }),
);
