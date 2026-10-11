import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import {
  PREVIOUS_TASK_CREATION,
  UpdateDefaultBatchCreatePromptsMigration,
} from "./028_UpdateDefaultBatchCreatePrompts.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const settings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly taskCreation: string; readonly revision: number }>`
    SELECT task_creation AS "taskCreation", revision FROM task_prompt_settings WHERE id = 1
  `;
  return row!;
});

const changes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly field: string }>`
    SELECT field FROM task_prompt_settings_changes
    WHERE id LIKE ${"task-prompt-change-default-update-28-%"}
  `;
  return rows.map(({ field }) => field);
});

const setText = (taskCreation: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM task_prompt_settings_changes`;
    yield* sql`UPDATE task_prompt_settings SET task_creation = ${taskCreation} WHERE id = 1`;
  });

it.layer(database)("UpdateDefaultBatchCreatePrompts migration", (it) => {
  it.effect("updates the text migration 25 left, once", () =>
    Effect.gen(function* () {
      yield* setText(PREVIOUS_TASK_CREATION);
      const before = yield* settings;
      yield* UpdateDefaultBatchCreatePromptsMigration;
      yield* UpdateDefaultBatchCreatePromptsMigration;
      const after = yield* settings;
      assert.equal(after.taskCreation, DEFAULT_TASK_PROMPT_SETTINGS.taskCreation);
      assert.include(after.taskCreation, "one task_create call");
      assert.equal(after.revision, before.revision + 1);
      assert.deepStrictEqual(yield* changes, ["taskCreation"]);
    }),
  );

  it.effect("keeps an edited text", () =>
    Effect.gen(function* () {
      yield* setText("My own tasks.");
      const before = yield* settings;
      yield* UpdateDefaultBatchCreatePromptsMigration;
      assert.deepStrictEqual(yield* settings, before);
      assert.deepStrictEqual(yield* changes, []);
    }),
  );
});
