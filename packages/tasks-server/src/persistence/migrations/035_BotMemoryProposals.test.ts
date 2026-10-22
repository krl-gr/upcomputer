import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

it.effect("memory proposals migration keeps existing bot memories active", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runExperimentalFeatureMigrations([
      {
        ...TASK_MIGRATION_CONTRIBUTION,
        migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
          (migration) => migration.version < 35,
        ),
      },
    ]);
    yield* sql`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json, start_tags_json, config_json, created_at, updated_at)
    VALUES ('bot', NULL, 'Bot', 0, '[]', '[]', '{}', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z')`;
    yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json)
    VALUES ('bot', 'bot-chat', 'project', '["project"]')`;
    yield* sql`INSERT INTO bot_memories (agent_id, id, project_id, text, source, created_at, updated_at, deleted_at) VALUES
    ('bot', 'kept', NULL, 'Kept fact', 'user', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z', NULL),
    ('bot', 'gone', NULL, 'Deleted fact', 'user', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z', '2026-10-18T01:00:00Z')`;
    yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
    assert.deepStrictEqual(
      yield* sql`SELECT id, status, target_id, deleted_at FROM bot_memories ORDER BY id`,
      [
        { id: "gone", status: "active", target_id: null, deleted_at: "2026-10-18T01:00:00Z" },
        { id: "kept", status: "active", target_id: null, deleted_at: null },
      ],
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
