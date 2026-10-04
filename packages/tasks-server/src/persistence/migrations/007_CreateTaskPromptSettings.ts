import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Store environment-wide user guidance for task orchestration tools and agents. */
export const CreateTaskPromptSettingsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS task_prompt_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      task_creation TEXT NOT NULL,
      agent_creation TEXT NOT NULL,
      automation_creation TEXT NOT NULL,
      task_execution TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO task_prompt_settings (
      id,
      task_creation,
      agent_creation,
      automation_creation,
      task_execution
    ) VALUES (
      1,
      ${DEFAULT_TASK_PROMPT_SETTINGS.taskCreation},
      ${DEFAULT_TASK_PROMPT_SETTINGS.agentCreation},
      ${DEFAULT_TASK_PROMPT_SETTINGS.automationCreation},
      ${DEFAULT_TASK_PROMPT_SETTINGS.taskExecution}
    )
    ON CONFLICT (id) DO NOTHING
  `;
});
