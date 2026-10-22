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
  "appearance migration preserves old bots and persists per-bot choices across database reopen",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "bot-appearance-"))),
        (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true, force: true })),
      );
      const filename = NodePath.join(directory, "state.sqlite");
      const appearance = JSON.stringify({ shape: "bean", color: "coral", accessory: "winter" });
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runExperimentalFeatureMigrations([
          {
            ...TASK_MIGRATION_CONTRIBUTION,
            migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
              (migration) => migration.version < 34,
            ),
          },
        ]);
        yield* sql`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json, start_tags_json, config_json, created_at, updated_at)
        VALUES ('legacy', NULL, 'Legacy', 0, '[]', '[]', '{"runtimeMode":"approval-required"}', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z'),
        ('custom', NULL, 'Custom', 0, '[]', '[]', '{}', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z')`;
        yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json) VALUES
        ('legacy', 'legacy-chat', 'project', '["project"]'), ('custom', 'custom-chat', 'project', '["project"]')`;
        yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
        assert.deepStrictEqual(
          (yield* sql`SELECT appearance_json FROM bots`).map((row) => row.appearance_json),
          [null, null],
        );
        yield* sql`UPDATE bots SET appearance_json = ${appearance} WHERE agent_id = 'custom'`;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
        assert.deepStrictEqual(
          yield* sql`SELECT agent_id, thread_id, appearance_json FROM bots ORDER BY agent_id`,
          [
            { agent_id: "custom", thread_id: "custom-chat", appearance_json: appearance },
            { agent_id: "legacy", thread_id: "legacy-chat", appearance_json: null },
          ],
        );
        assert.equal(
          (yield* sql`SELECT config_json FROM task_agents WHERE id = 'legacy'`)[0]?.config_json,
          '{"runtimeMode":"approval-required"}',
        );
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
    }).pipe(Effect.scoped),
);
