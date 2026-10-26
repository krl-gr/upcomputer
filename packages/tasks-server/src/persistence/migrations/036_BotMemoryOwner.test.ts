import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

it.effect("memory owner migration gives existing entries the user wrote to the user", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runExperimentalFeatureMigrations([
      {
        ...TASK_MIGRATION_CONTRIBUTION,
        migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
          (migration) => migration.version < 36,
        ),
      },
    ]);
    yield* sql`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json, start_tags_json, config_json, created_at, updated_at)
    VALUES ('bot', NULL, 'Bot', 0, '[]', '[]', '{}', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z')`;
    yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json)
    VALUES ('bot', 'bot-chat', 'project', '["project"]')`;
    const at = "2026-10-18T00:00:00Z";
    yield* sql`INSERT INTO bot_memories (agent_id, id, project_id, text, source, created_at, updated_at, status, target_id) VALUES
    ('bot', 'settings', NULL, 'Added in settings', 'user', ${at}, ${at}, 'active', NULL),
    ('bot', 'message:1', NULL, 'Remember prefix', 'chat:bot-chat/message:1', ${at}, ${at}, 'active', NULL),
    ('bot', 'accepted', NULL, 'Accepted suggestion', 'task:t/run:r', ${at}, ${at}, 'active', NULL),
    ('bot', 'model', NULL, 'Saved by the bot', 'chat:bot-chat', ${at}, ${at}, 'active', NULL),
    ('bot', 'proposal:r:x', NULL, 'Waiting suggestion', 'task:t/run:r', ${at}, ${at}, 'proposed', 'x')`;
    yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
    assert.deepStrictEqual(yield* sql`SELECT id, owner FROM bot_memories ORDER BY id`, [
      { id: "accepted", owner: "user" },
      { id: "message:1", owner: "user" },
      { id: "model", owner: "bot" },
      { id: "proposal:r:x", owner: "bot" },
      { id: "settings", owner: "user" },
    ]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
