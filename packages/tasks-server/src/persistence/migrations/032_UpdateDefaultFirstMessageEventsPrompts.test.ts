import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import {
  PREVIOUS_DEFAULTS,
  UpdateDefaultFirstMessageEventsPromptsMigration,
} from "./032_UpdateDefaultFirstMessageEventsPrompts.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const settings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{
    readonly agentCreation: string;
    readonly taskExecution: string;
    readonly revision: number;
  }>`
    SELECT agent_creation AS "agentCreation", task_execution AS "taskExecution", revision
    FROM task_prompt_settings WHERE id = 1
  `;
  return row!;
});

const changes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly field: string }>`
    SELECT field FROM task_prompt_settings_changes
    WHERE id LIKE ${"task-prompt-change-default-update-32-%"}
    ORDER BY revision
  `;
  return rows.map(({ field }) => field);
});

const setTexts = (agentCreation: string, taskExecution: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM task_prompt_settings_changes`;
    yield* sql`
      UPDATE task_prompt_settings
      SET agent_creation = ${agentCreation}, task_execution = ${taskExecution}
      WHERE id = 1
    `;
  });

it.layer(database)("UpdateDefaultFirstMessageEventsPrompts migration", (it) => {
  it.effect("updates the texts migrations 27 and 30 left, once", () =>
    Effect.gen(function* () {
      yield* setTexts(PREVIOUS_DEFAULTS.agentCreation, PREVIOUS_DEFAULTS.taskExecution);
      const before = yield* settings;
      yield* UpdateDefaultFirstMessageEventsPromptsMigration;
      yield* UpdateDefaultFirstMessageEventsPromptsMigration;
      const after = yield* settings;
      assert.equal(after.agentCreation, DEFAULT_TASK_PROMPT_SETTINGS.agentCreation);
      assert.equal(after.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
      assert.include(after.agentCreation, "do not call task_get at the start");
      assert.include(after.taskExecution, "Do not call task_get at the start");
      assert.equal(after.revision, before.revision + 2);
      assert.deepStrictEqual(yield* changes, ["agentCreation", "taskExecution"]);
    }),
  );

  it.effect("keeps an edited text", () =>
    Effect.gen(function* () {
      yield* setTexts("My own agents.", PREVIOUS_DEFAULTS.taskExecution);
      yield* UpdateDefaultFirstMessageEventsPromptsMigration;
      const after = yield* settings;
      assert.equal(after.agentCreation, "My own agents.");
      assert.equal(after.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
      assert.deepStrictEqual(yield* changes, ["taskExecution"]);
    }),
  );
});
