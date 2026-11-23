import {
  CURRENT_TASK_WORKFLOW_VERSION,
  DEFAULT_TASK_PROMPT_SETTINGS,
  INSTRUCTION_UPDATES,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { appliedAtInstall } from "../../instructionUpdates/instructionUpdateRules.ts";

/**
 * Each install's decision on every instruction update, and its mode. A new
 * install (the current texts and workflow just stored) already has every
 * entry, so it starts with all of them applied; later entries get rows at start.
 */
export const InstructionUpdatesMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE task_instruction_updates (
      entry_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      decided_at TEXT,
      decided_by_json TEXT
    )
  `;
  yield* sql`ALTER TABLE task_settings ADD COLUMN instruction_updates_mode TEXT NOT NULL DEFAULT 'ask'`;
  const [install] = yield* sql<{
    readonly workflowVersion: number;
    readonly taskCreation: string;
    readonly agentCreation: string;
    readonly automationCreation: string;
    readonly taskExecution: string;
  }>`
    SELECT
      s.workflow_version AS "workflowVersion",
      p.task_creation AS "taskCreation",
      p.agent_creation AS "agentCreation",
      p.automation_creation AS "automationCreation",
      p.task_execution AS "taskExecution"
    FROM task_settings s, task_prompt_settings p
    WHERE s.id = 1 AND p.id = 1
  `;
  if (install === undefined) return;
  const isNewInstall =
    install.workflowVersion === CURRENT_TASK_WORKFLOW_VERSION &&
    install.taskCreation === DEFAULT_TASK_PROMPT_SETTINGS.taskCreation &&
    install.agentCreation === DEFAULT_TASK_PROMPT_SETTINGS.agentCreation &&
    install.automationCreation === DEFAULT_TASK_PROMPT_SETTINGS.automationCreation &&
    install.taskExecution === DEFAULT_TASK_PROMPT_SETTINGS.taskExecution;
  for (const entry of INSTRUCTION_UPDATES) {
    const state =
      isNewInstall || appliedAtInstall(entry, install.workflowVersion) ? "applied" : "pending";
    yield* sql`INSERT INTO task_instruction_updates (entry_id, state) VALUES (${entry.id}, ${state})`;
  }
});
