import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import {
  PREVIOUS_DEFAULTS as BEFORE_26,
  UpdateDefaultRunStartPromptsMigration,
} from "./026_UpdateDefaultRunStartPrompts.ts";
import {
  PREVIOUS_DEFAULTS as BEFORE_27,
  UpdateDefaultBlockedReleasePromptsMigration,
} from "./027_UpdateDefaultBlockedReleasePrompts.ts";
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

const changes = (version: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly field: string }>`
      SELECT field FROM task_prompt_settings_changes
      WHERE id LIKE ${`task-prompt-change-default-update-${version}-%`}
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

it.layer(database)("UpdateDefaultBlockedReleasePrompts migration", (it) => {
  it.effect("updates the texts migration 26 left, once", () =>
    Effect.gen(function* () {
      yield* setTexts(BEFORE_27.agentCreation, BEFORE_27.taskExecution);
      const before = yield* settings;
      yield* UpdateDefaultBlockedReleasePromptsMigration;
      yield* UpdateDefaultBlockedReleasePromptsMigration;
      const after = yield* settings;
      assert.equal(after.agentCreation, DEFAULT_TASK_PROMPT_SETTINGS.agentCreation);
      assert.equal(after.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
      assert.include(after.taskExecution, "status Blocked");
      assert.equal(after.revision, before.revision + 2);
      assert.deepStrictEqual(yield* changes(27), ["agentCreation", "taskExecution"]);
    }),
  );

  it.effect("after 26 moved older texts to the current defaults, it changes nothing", () =>
    Effect.gen(function* () {
      yield* setTexts(BEFORE_26.agentCreation, BEFORE_26.taskExecution);
      yield* UpdateDefaultRunStartPromptsMigration;
      const between = yield* settings;
      yield* UpdateDefaultBlockedReleasePromptsMigration;
      assert.deepStrictEqual(yield* settings, between);
      assert.equal(between.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
      assert.deepStrictEqual(yield* changes(26), ["agentCreation", "taskExecution"]);
      assert.deepStrictEqual(yield* changes(27), []);
    }),
  );

  it.effect("keeps an edited text", () =>
    Effect.gen(function* () {
      yield* setTexts("My own agents.", BEFORE_27.taskExecution);
      yield* UpdateDefaultBlockedReleasePromptsMigration;
      const after = yield* settings;
      assert.equal(after.agentCreation, "My own agents.");
      assert.equal(after.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
      assert.deepStrictEqual(yield* changes(27), ["taskExecution"]);
    }),
  );
});
