import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import {
  PREVIOUS_DEFAULTS,
  UpdateDefaultBotCreationPromptsMigration,
} from "./041_UpdateDefaultBotCreationPrompts.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const settings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly agentCreation: string; readonly revision: number }>`
    SELECT agent_creation AS "agentCreation", revision FROM task_prompt_settings WHERE id = 1
  `;
  return row!;
});

const changes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly field: string }>`
    SELECT field FROM task_prompt_settings_changes
    WHERE id LIKE ${"task-prompt-change-default-update-41-%"}
  `;
  return rows.map(({ field }) => field);
});

const setAgentCreation = (agentCreation: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM task_prompt_settings_changes`;
    yield* sql`UPDATE task_prompt_settings SET agent_creation = ${agentCreation} WHERE id = 1`;
  });

it.layer(database)("UpdateDefaultBotCreationPrompts migration", (it) => {
  it.effect("updates the text migration 32 left, once", () =>
    Effect.gen(function* () {
      yield* setAgentCreation(PREVIOUS_DEFAULTS.agentCreation);
      const before = yield* settings;
      yield* UpdateDefaultBotCreationPromptsMigration;
      yield* UpdateDefaultBotCreationPromptsMigration;
      const after = yield* settings;
      assert.equal(after.agentCreation, DEFAULT_TASK_PROMPT_SETTINGS.agentCreation);
      assert.include(after.agentCreation, "When the user asks for a bot, use bot_create.");
      assert.equal(after.revision, before.revision + 1);
      assert.deepStrictEqual(yield* changes, ["agentCreation"]);
    }),
  );

  it.effect("keeps an edited text", () =>
    Effect.gen(function* () {
      yield* setAgentCreation("My own agents.");
      yield* UpdateDefaultBotCreationPromptsMigration;
      assert.equal((yield* settings).agentCreation, "My own agents.");
      assert.deepStrictEqual(yield* changes, []);
    }),
  );
});
