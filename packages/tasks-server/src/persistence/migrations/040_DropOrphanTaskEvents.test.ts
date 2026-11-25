import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

it.effect("drops events whose task no longer exists and keeps the rest", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runExperimentalFeatureMigrations([
      {
        ...TASK_MIGRATION_CONTRIBUTION,
        migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
          (migration) => migration.version < 40,
        ),
      },
    ]);
    const at = "2026-11-19T00:00:00.000Z";
    yield* sql`INSERT INTO tasks
      (id, project_id, title, description, status, created_by, metadata_json, rank, created_at, updated_at)
      VALUES ('kept', 'project', 'Kept', '', 'To Do', 'test', 'null', 'a', ${at}, ${at})`;
    yield* sql`INSERT INTO task_events (id, task_id, kind, payload_json, created_at) VALUES
      ('e1', 'kept', 'note', 'null', ${at}),
      ('e2', 'deleted', 'task.deleted', 'null', ${at}),
      ('e3', 'task-made-up', 'note', 'null', ${at})`;
    yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
    assert.deepStrictEqual(yield* sql`SELECT id FROM task_events ORDER BY id`, [{ id: "e1" }]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
