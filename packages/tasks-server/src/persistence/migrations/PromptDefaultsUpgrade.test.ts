import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { PREVIOUS_DEFAULTS as BEFORE_25 } from "./025_UpdateDefaultQueuePrompts.ts";
import { PREVIOUS_DEFAULTS as BEFORE_26 } from "./026_UpdateDefaultRunStartPrompts.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

// The human-tasks migrations (20..24) shipped before the prompt-default
// updates (25..29); a database can be at either side of them.
const migrateThrough = (version: number) =>
  runExperimentalFeatureMigrations([
    {
      ...TASK_MIGRATION_CONTRIBUTION,
      migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
        (migration) => migration.version <= version,
      ),
    },
  ]);

const project = "project-upcomputer";
const editedAgentCreation = "My own agents.";

/** Settings as a user left them: some fields edited, empty project additions. */
const seed = (taskCreation: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE task_prompt_settings SET
        task_creation = ${taskCreation},
        agent_creation = ${editedAgentCreation},
        task_execution = ${BEFORE_26.taskExecution}
      WHERE id = 1
    `;
    yield* sql`
      INSERT INTO task_project_prompt_settings (project_id, revision) VALUES (${project}, 9)
    `;
  });

const state = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const history = yield* sql<{ readonly version: number; readonly name: string }>`
    SELECT version, name FROM feature_migration_history
    WHERE namespace = ${TASK_MIGRATION_CONTRIBUTION.namespace}
    ORDER BY version
  `;
  const [settings] = yield* sql<{
    readonly taskCreation: string;
    readonly agentCreation: string;
    readonly taskExecution: string;
    readonly automationCreation: string;
  }>`
    SELECT
      task_creation AS "taskCreation",
      agent_creation AS "agentCreation",
      task_execution AS "taskExecution",
      automation_creation AS "automationCreation"
    FROM task_prompt_settings WHERE id = 1
  `;
  const [projectSettings] = yield* sql<Record<string, string | number>>`
    SELECT task_creation, agent_creation, automation_creation, task_execution, revision
    FROM task_project_prompt_settings WHERE project_id = ${project}
  `;
  const changes = yield* sql<{ readonly id: string }>`
    SELECT id FROM task_prompt_settings_changes ORDER BY revision
  `;
  return {
    history,
    settings: settings!,
    projectSettings,
    changes: changes.map(({ id }) => id),
  };
});

const assertUpgraded = (upgraded: Effect.Success<typeof state>) => {
  assert.deepStrictEqual(
    upgraded.history.map(({ version }) => version),
    TASK_MIGRATION_CONTRIBUTION.migrations.map(({ version }) => version),
  );
  assert.deepStrictEqual(
    upgraded.history.slice(19).map(({ name }) => name),
    [
      "TaskAudienceAndKind",
      "TaskScheduleEntries",
      "TaskSettings",
      "TaskScheduleReminders",
      "TaskAutomationRank",
      "UpdateDefaultQueuePrompts",
      "UpdateDefaultRunStartPrompts",
      "UpdateDefaultBlockedReleasePrompts",
      "UpdateDefaultBatchCreatePrompts",
      "UpdateDefaultQueueStatePrompts",
    ],
  );
  // An edited text stays the user's; an unedited one gets the current default.
  assert.equal(upgraded.settings.agentCreation, editedAgentCreation);
  assert.equal(upgraded.settings.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
  assert.equal(
    upgraded.settings.automationCreation,
    DEFAULT_TASK_PROMPT_SETTINGS.automationCreation,
  );
  // Project additions are never defaults: empty stays empty.
  assert.deepStrictEqual(upgraded.projectSettings, {
    task_creation: "",
    agent_creation: "",
    automation_creation: "",
    task_execution: "",
    revision: 9,
  });
};

it.effect("a database at 19 runs 20..29 and keeps the user's edited texts", () =>
  Effect.gen(function* () {
    yield* migrateThrough(19);
    yield* seed(BEFORE_25.taskCreation);
    yield* migrateThrough(29);

    const upgraded = yield* state;
    assertUpgraded(upgraded);
    assert.equal(upgraded.settings.taskCreation, DEFAULT_TASK_PROMPT_SETTINGS.taskCreation);
    assert.deepStrictEqual(upgraded.changes, [
      "task-prompt-change-default-update-25-taskCreation",
      "task-prompt-change-default-update-26-taskExecution",
    ]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("a database already at 24 runs 25..29 only", () =>
  Effect.gen(function* () {
    yield* migrateThrough(24);
    const editedTaskCreation = "Development goes to the developer agent.";
    yield* seed(editedTaskCreation);
    const sql = yield* SqlClient.SqlClient;
    const [{ count: settingsRows }] = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM task_settings
    `;
    assert.equal(settingsRows, 1);
    yield* migrateThrough(29);

    const upgraded = yield* state;
    assertUpgraded(upgraded);
    assert.equal(upgraded.settings.taskCreation, editedTaskCreation);
    assert.deepStrictEqual(upgraded.changes, [
      "task-prompt-change-default-update-26-taskExecution",
    ]);
    // Running again changes nothing.
    yield* migrateThrough(29);
    assert.deepStrictEqual(yield* state, upgraded);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
