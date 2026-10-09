import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { UpdateDefaultQueuePromptsMigration } from "./020_UpdateDefaultQueuePrompts.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const previousTaskCreation = DEFAULT_TASK_PROMPT_SETTINGS.taskCreation.replace(
  " New tasks join the end of the list, so create queued tasks in the order they should run; no reorder is needed.",
  "",
);

it.layer(database)("UpdateDefaultQueuePrompts migration", (it) => {
  it.effect("updates an unedited default and keeps an edited one", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE task_prompt_settings
        SET task_creation = ${previousTaskCreation}, agent_creation = ${"My own agents."}
        WHERE id = 1
      `;
      const [before] = yield* sql<{ readonly revision: number }>`
        SELECT revision FROM task_prompt_settings WHERE id = 1
      `;
      yield* UpdateDefaultQueuePromptsMigration;

      const [row] = yield* sql<{
        readonly taskCreation: string;
        readonly agentCreation: string;
        readonly revision: number;
      }>`
        SELECT task_creation AS "taskCreation", agent_creation AS "agentCreation", revision
        FROM task_prompt_settings WHERE id = 1
      `;
      assert.equal(row?.taskCreation, DEFAULT_TASK_PROMPT_SETTINGS.taskCreation);
      assert.equal(row?.agentCreation, "My own agents.");
      assert.equal(row?.revision, before!.revision + 1);
      const changes = yield* sql<{ readonly field: string }>`
        SELECT field FROM task_prompt_settings_changes
        WHERE id LIKE 'task-prompt-change-default-update-20-%'
      `;
      assert.deepStrictEqual(
        changes.map(({ field }) => field),
        ["taskCreation"],
      );
    }),
  );
});
