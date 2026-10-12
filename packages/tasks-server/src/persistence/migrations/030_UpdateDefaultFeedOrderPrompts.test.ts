import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import {
  PREVIOUS_DEFAULTS,
  UpdateDefaultFeedOrderPromptsMigration,
} from "./030_UpdateDefaultFeedOrderPrompts.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const settings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{
    readonly taskCreation: string;
    readonly agentCreation: string;
    readonly revision: number;
  }>`
    SELECT task_creation AS "taskCreation", agent_creation AS "agentCreation", revision
    FROM task_prompt_settings WHERE id = 1
  `;
  return row!;
});

const changes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly field: string }>`
    SELECT field FROM task_prompt_settings_changes
    WHERE id LIKE ${"task-prompt-change-default-update-30-%"}
    ORDER BY revision
  `;
  return rows.map(({ field }) => field);
});

const setTexts = (taskCreation: string, agentCreation: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM task_prompt_settings_changes`;
    yield* sql`
      UPDATE task_prompt_settings
      SET task_creation = ${taskCreation}, agent_creation = ${agentCreation}
      WHERE id = 1
    `;
  });

it.layer(database)("UpdateDefaultFeedOrderPrompts migration", (it) => {
  it.effect("updates the texts migrations 27 and 29 left, once", () =>
    Effect.gen(function* () {
      yield* setTexts(PREVIOUS_DEFAULTS.taskCreation, PREVIOUS_DEFAULTS.agentCreation);
      const before = yield* settings;
      yield* UpdateDefaultFeedOrderPromptsMigration;
      yield* UpdateDefaultFeedOrderPromptsMigration;
      const after = yield* settings;
      assert.equal(after.taskCreation, DEFAULT_TASK_PROMPT_SETTINGS.taskCreation);
      assert.equal(after.agentCreation, DEFAULT_TASK_PROMPT_SETTINGS.agentCreation);
      assert.include(after.taskCreation, "new tasks go to the top of the list");
      assert.include(after.agentCreation, 'from "bottom"');
      assert.equal(after.revision, before.revision + 2);
      assert.deepStrictEqual(yield* changes, ["taskCreation", "agentCreation"]);
    }),
  );

  it.effect("keeps an edited text", () =>
    Effect.gen(function* () {
      yield* setTexts(PREVIOUS_DEFAULTS.taskCreation, "My own agents.");
      yield* UpdateDefaultFeedOrderPromptsMigration;
      const after = yield* settings;
      assert.equal(after.taskCreation, DEFAULT_TASK_PROMPT_SETTINGS.taskCreation);
      assert.equal(after.agentCreation, "My own agents.");
      assert.deepStrictEqual(yield* changes, ["taskCreation"]);
    }),
  );
});
