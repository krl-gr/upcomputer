import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  LEGACY_TASK_PROMPT_SETTINGS,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const migrateThrough = (version: number) =>
  runExperimentalFeatureMigrations([
    {
      ...TASK_MIGRATION_CONTRIBUTION,
      migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
        (migration) => migration.version <= version,
      ),
    },
  ]);

const state = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [settings] = yield* sql<{ readonly workflowVersion: number }>`
    SELECT workflow_version AS "workflowVersion" FROM task_settings WHERE id = 1
  `;
  const [texts] = yield* sql<{
    readonly taskCreation: string;
    readonly agentCreation: string;
    readonly taskExecution: string;
  }>`
    SELECT
      task_creation AS "taskCreation",
      agent_creation AS "agentCreation",
      task_execution AS "taskExecution"
    FROM task_prompt_settings WHERE id = 1
  `;
  return { workflowVersion: settings!.workflowVersion, texts: texts! };
});

/** An install from before this build, with the texts it was left with. */
const existingInstall = (texts: {
  readonly taskCreation: string;
  readonly agentCreation: string;
  readonly taskExecution: string;
}) =>
  Effect.gen(function* () {
    yield* migrateThrough(42);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE task_prompt_settings SET
        task_creation = ${texts.taskCreation},
        agent_creation = ${texts.agentCreation},
        task_execution = ${texts.taskExecution}
      WHERE id = 1
    `;
    yield* migrateThrough(43);
  });

it.effect("a new install starts on the current workflow with the current texts", () =>
  Effect.gen(function* () {
    yield* migrateThrough(43);
    const { workflowVersion, texts } = yield* state;
    assert.equal(workflowVersion, 2);
    assert.equal(texts.taskCreation, DEFAULT_TASK_PROMPT_SETTINGS.taskCreation);
    assert.equal(texts.agentCreation, DEFAULT_TASK_PROMPT_SETTINGS.agentCreation);
    assert.equal(texts.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("an existing install stays on workflow 1 and keeps its unedited texts", () =>
  Effect.gen(function* () {
    yield* existingInstall(LEGACY_TASK_PROMPT_SETTINGS);
    const { workflowVersion, texts } = yield* state;
    assert.equal(workflowVersion, 1);
    assert.equal(texts.taskCreation, LEGACY_TASK_PROMPT_SETTINGS.taskCreation);
    assert.equal(texts.agentCreation, LEGACY_TASK_PROMPT_SETTINGS.agentCreation);
    assert.equal(texts.taskExecution, LEGACY_TASK_PROMPT_SETTINGS.taskExecution);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("an existing install with edited texts stays on workflow 1 and keeps them", () =>
  Effect.gen(function* () {
    const edited = { ...LEGACY_TASK_PROMPT_SETTINGS, taskCreation: "My own tasks." };
    yield* existingInstall(edited);
    const { workflowVersion, texts } = yield* state;
    assert.equal(workflowVersion, 1);
    assert.equal(texts.taskCreation, "My own tasks.");
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
