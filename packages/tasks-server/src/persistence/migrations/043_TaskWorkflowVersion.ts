import {
  CURRENT_TASK_WORKFLOW_VERSION,
  DEFAULT_TASK_PROMPT_SETTINGS,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The install's workflow version (see TaskWorkflowVersion). Existing installs
 * stay on workflow 1. A new install is recognized by its instructions: the
 * create migration just stored the current default texts, which no older
 * build shipped, so it starts on the current workflow.
 */
export const TaskWorkflowVersionMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Workflow 1 is LEGACY_TASK_WORKFLOW_VERSION; DDL takes no bound parameters.
  yield* sql`ALTER TABLE task_settings ADD COLUMN workflow_version INTEGER NOT NULL DEFAULT 1`;
  const [texts] = yield* sql<{
    readonly taskCreation: string;
    readonly agentCreation: string;
    readonly automationCreation: string;
    readonly taskExecution: string;
  }>`
    SELECT
      task_creation AS "taskCreation",
      agent_creation AS "agentCreation",
      automation_creation AS "automationCreation",
      task_execution AS "taskExecution"
    FROM task_prompt_settings
    WHERE id = 1
  `;
  const isNewInstall =
    texts !== undefined &&
    texts.taskCreation === DEFAULT_TASK_PROMPT_SETTINGS.taskCreation &&
    texts.agentCreation === DEFAULT_TASK_PROMPT_SETTINGS.agentCreation &&
    texts.automationCreation === DEFAULT_TASK_PROMPT_SETTINGS.automationCreation &&
    texts.taskExecution === DEFAULT_TASK_PROMPT_SETTINGS.taskExecution;
  if (isNewInstall)
    yield* sql`UPDATE task_settings SET workflow_version = ${CURRENT_TASK_WORKFLOW_VERSION}`;
});
