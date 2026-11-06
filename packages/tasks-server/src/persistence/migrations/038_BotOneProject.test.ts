import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

it.effect(
  "one project migration narrows bots to their project and rejects waiting suggestions",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runExperimentalFeatureMigrations([
        {
          ...TASK_MIGRATION_CONTRIBUTION,
          migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
            (migration) => migration.version < 38,
          ),
        },
      ]);
      const at = "2026-11-01T00:00:00Z";
      yield* sql`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json, start_tags_json, config_json, created_at, updated_at) VALUES
    ('wide', NULL, 'Wide', 0, '[]', '[]', '{}', ${at}, ${at}),
    ('narrow', NULL, 'Narrow', 0, '[]', '[]', '{}', ${at}, ${at})`;
      yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json) VALUES
    ('wide', 'wide-chat', 'a', '["b","a"]'),
    ('narrow', 'narrow-chat', 'c', '["c"]')`;
      yield* sql`INSERT INTO bot_memories (agent_id, id, project_id, text, source, created_at, updated_at, status, target_id) VALUES
    ('wide', 'fact', NULL, 'Kept', 'user', ${at}, ${at}, 'active', NULL),
    ('wide', 'proposal:r:x', NULL, 'Waiting', 'task:t/run:r', ${at}, ${at}, 'proposed', 'x'),
    ('wide', 'proposal:r:y', NULL, 'Taken', 'task:t/run:r', ${at}, ${at}, 'accepted', 'y')`;
      yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
      assert.deepStrictEqual(
        yield* sql`SELECT agent_id AS "agentId", allowed_projects_json AS allowed FROM bots ORDER BY agent_id`,
        [
          { agentId: "narrow", allowed: '["c"]' },
          { agentId: "wide", allowed: '["a"]' },
        ],
      );
      assert.deepStrictEqual(yield* sql`SELECT id, status FROM bot_memories ORDER BY id`, [
        { id: "fact", status: "active" },
        { id: "proposal:r:x", status: "rejected" },
        { id: "proposal:r:y", status: "accepted" },
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
