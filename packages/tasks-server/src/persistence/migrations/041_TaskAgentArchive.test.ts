import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import { TaskAgentId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TaskRepository } from "../TaskRepository.ts";
import { TaskRepositoryLive } from "../TaskRepositoryLive.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

it.effect("an agent stored before the archive stays unarchived and in default searches", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runExperimentalFeatureMigrations([
      {
        ...TASK_MIGRATION_CONTRIBUTION,
        migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
          (migration) => migration.version < 41,
        ),
      },
    ]);
    const at = "2026-11-21T00:00:00.000Z";
    const config = { role: "Dev", modelSelection: { instanceId: "codex", model: "gpt-5.4" } };
    yield* sql`INSERT INTO task_agents (
      id, project_id, name, enabled, start_statuses_json, start_tags_json, config_json,
      start_run_statuses_json, created_at, updated_at
    ) VALUES (
      'paused', NULL, 'Paused', 0, '[]', '[]', ${JSON.stringify({ ...config, instructions: "Work." })},
      '[]', ${at}, ${at}
    )`;
    yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
    const repository = yield* TaskRepository;
    const agent = Option.getOrThrow(
      yield* repository.getAgentById({ id: TaskAgentId.make("paused") }),
    );
    assert.strictEqual(agent.archivedAt, null);
    assert.strictEqual(agent.enabled, false);
    assert.deepStrictEqual(
      (yield* repository.searchAgents({})).map(({ id }) => id),
      ["paused"],
    );
  }).pipe(
    Effect.provide(
      TaskRepositoryLive.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
    ),
  ),
);
