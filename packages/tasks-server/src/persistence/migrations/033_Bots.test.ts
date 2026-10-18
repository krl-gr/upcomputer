import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

it.effect(
  "bots upgrade an existing task database and retain unique identities and memory across reopen",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "bots-migration-"))),
        (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true, force: true })),
      );
      const filename = NodePath.join(directory, "state.sqlite");
      const old = {
        ...TASK_MIGRATION_CONTRIBUTION,
        migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
          (migration) => migration.version < 33,
        ),
      };
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runExperimentalFeatureMigrations([old]);
        yield* sql`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json, start_tags_json, config_json, created_at, updated_at)
      VALUES ('existing-agent', NULL, 'Keep existing agent', 0, '[]', '[]', '{"untouched":true}', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z')`;
        yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
        assert.deepStrictEqual(
          (yield* sql<{
            config: string;
            name: string;
          }>`SELECT config_json AS config, name FROM task_agents`)[0],
          { config: '{"untouched":true}', name: "Keep existing agent" },
        );
        assert.equal(
          (yield* sql`SELECT * FROM bots`).length,
          0,
          "existing agents are not automatically converted",
        );
        yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json) VALUES ('existing-agent', 'permanent-chat', 'project-1', '["project-1"]')`;
        yield* sql`INSERT INTO bot_memories (agent_id, id, project_id, text, source, created_at, updated_at)
      VALUES ('existing-agent', 'fact', NULL, 'Persistent fact', 'user', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z')`;
        assert.equal(
          (yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json) VALUES ('existing-agent', 'another-chat', 'project-1', '[]')`.pipe(
            Effect.result,
          ))._tag,
          "Failure",
        );
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
        assert.equal(
          (yield* sql<{ threadId: string }>`SELECT thread_id AS "threadId" FROM bots`)[0]?.threadId,
          "permanent-chat",
        );
        assert.equal(
          (yield* sql<{ text: string }>`SELECT text FROM bot_memories`)[0]?.text,
          "Persistent fact",
        );
        yield* sql`UPDATE bot_memories SET deleted_at = '2026-10-18T01:00:00Z' WHERE id = 'fact'`;
        assert.equal((yield* sql`SELECT * FROM bot_memories WHERE deleted_at IS NULL`).length, 0);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
    }).pipe(Effect.scoped),
);
