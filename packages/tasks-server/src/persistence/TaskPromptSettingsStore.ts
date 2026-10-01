import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  TaskPromptSettings,
  type TaskPromptSettingsUpdateInput,
} from "@upcomputer/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { TaskRepositoryError } from "./Errors.ts";
import { toTaskPersistenceDecodeError, toTaskPersistenceSqlError } from "./Errors.ts";

export interface TaskPromptSettingsStoreShape {
  readonly get: Effect.Effect<TaskPromptSettings, TaskRepositoryError>;
  readonly update: (
    input: TaskPromptSettingsUpdateInput,
  ) => Effect.Effect<TaskPromptSettings, TaskRepositoryError>;
}

export class TaskPromptSettingsStore extends Context.Service<
  TaskPromptSettingsStore,
  TaskPromptSettingsStoreShape
>()("upcomputer.tasks/TaskPromptSettingsStore") {}

const decodeSettings = Schema.decodeUnknownEffect(TaskPromptSettings);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const get: TaskPromptSettingsStoreShape["get"] = sql<TaskPromptSettings>`
    SELECT
      task_creation AS "taskCreation",
      agent_creation AS "agentCreation",
      automation_creation AS "automationCreation",
      task_execution AS "taskExecution"
    FROM task_prompt_settings
    WHERE id = 1
  `.pipe(
    Effect.mapError(toTaskPersistenceSqlError("get task prompt settings")),
    Effect.flatMap((rows) => {
      const row = rows[0];
      return row === undefined
        ? Effect.succeed(DEFAULT_TASK_PROMPT_SETTINGS)
        : decodeSettings(row).pipe(
            Effect.mapError(toTaskPersistenceDecodeError("decode task prompt settings")),
          );
    }),
  );

  const update: TaskPromptSettingsStoreShape["update"] = (input) =>
    sql<TaskPromptSettings>`
      INSERT INTO task_prompt_settings (
        id,
        task_creation,
        agent_creation,
        automation_creation,
        task_execution
      ) VALUES (
        1,
        ${input.taskCreation},
        ${input.agentCreation},
        ${input.automationCreation},
        ${input.taskExecution}
      )
      ON CONFLICT (id) DO UPDATE SET
        task_creation = excluded.task_creation,
        agent_creation = excluded.agent_creation,
        automation_creation = excluded.automation_creation,
        task_execution = excluded.task_execution
      RETURNING
        task_creation AS "taskCreation",
        agent_creation AS "agentCreation",
        automation_creation AS "automationCreation",
        task_execution AS "taskExecution"
    `.pipe(
      Effect.mapError(toTaskPersistenceSqlError("update task prompt settings")),
      Effect.flatMap((rows) =>
        decodeSettings(rows[0]).pipe(
          Effect.mapError(toTaskPersistenceDecodeError("decode updated task prompt settings")),
        ),
      ),
    );

  return { get, update } satisfies TaskPromptSettingsStoreShape;
});

export const TaskPromptSettingsStoreLive = Layer.effect(TaskPromptSettingsStore, make);
