import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  TASK_PROMPT_FIELDS,
  TaskPromptSettings,
  TaskPromptSettingsChange,
  type TaskPromptChangeSource,
  type TaskPromptField,
  type TaskPromptSettingsUpdateInput,
} from "@upcomputer/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlError } from "effect/unstable/sql/SqlError";

import type { TaskRepositoryError } from "./Errors.ts";
import { toTaskPersistenceDecodeError, toTaskPersistenceSqlError } from "./Errors.ts";

export interface TaskPromptSettingsState {
  readonly settings: TaskPromptSettings;
  /** Bumped once for every recorded change. */
  readonly revision: number;
}

export interface TaskPromptChangeOrigin {
  readonly source: TaskPromptChangeSource;
  readonly threadId: string | null;
  readonly runId: string | null;
}

/** `change` is null when the text was already as requested; nothing is recorded then. */
export type TaskPromptFieldUpdateResult =
  | {
      readonly ok: true;
      readonly state: TaskPromptSettingsState;
      readonly change: TaskPromptSettingsChange | null;
    }
  | { readonly ok: false; readonly reason: "stale-revision"; readonly currentRevision: number };

export type TaskPromptRevertResult =
  | {
      readonly ok: true;
      readonly state: TaskPromptSettingsState;
      readonly reverted: TaskPromptSettingsChange;
      readonly change: TaskPromptSettingsChange | null;
    }
  | { readonly ok: false; readonly reason: "not-found" }
  | {
      readonly ok: false;
      readonly reason: "changed-since";
      readonly reverted: TaskPromptSettingsChange;
      readonly laterChanges: ReadonlyArray<TaskPromptSettingsChange>;
    };

export interface TaskPromptSettingsStoreShape {
  readonly get: Effect.Effect<TaskPromptSettings, TaskRepositoryError>;
  readonly getState: Effect.Effect<TaskPromptSettingsState, TaskRepositoryError>;
  /** The settings page save: records each field that changed as a settings-page change. */
  readonly update: (
    input: TaskPromptSettingsUpdateInput,
  ) => Effect.Effect<TaskPromptSettings, TaskRepositoryError>;
  /** Replaces one field when `expectedRevision` is current. A dry run checks and previews only. */
  readonly updateField: (input: {
    readonly field: TaskPromptField;
    readonly text: string;
    readonly reason: string;
    readonly expectedRevision: number;
    readonly origin: TaskPromptChangeOrigin;
    readonly dryRun: boolean;
  }) => Effect.Effect<TaskPromptFieldUpdateResult, TaskRepositoryError>;
  /**
   * Restores the field's text from before a change, recorded as a new change.
   * Refused when the field changed after it, so later edits are never undone silently.
   */
  readonly revert: (input: {
    readonly changeId: string;
    readonly reason: string | null;
    readonly origin: TaskPromptChangeOrigin;
    readonly dryRun: boolean;
  }) => Effect.Effect<TaskPromptRevertResult, TaskRepositoryError>;
  /** Newest first. */
  readonly history: (input: {
    readonly field?: TaskPromptField | undefined;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<TaskPromptSettingsChange>, TaskRepositoryError>;
}

export class TaskPromptSettingsStore extends Context.Service<
  TaskPromptSettingsStore,
  TaskPromptSettingsStoreShape
>()("upcomputer.tasks/TaskPromptSettingsStore") {}

const SETTINGS_PAGE_ORIGIN: TaskPromptChangeOrigin = {
  source: "settings-page",
  threadId: null,
  runId: null,
};

const StateRow = Schema.Struct({ ...TaskPromptSettings.fields, revision: Schema.Number });
const decodeStateRow = Schema.decodeUnknownEffect(StateRow);
const decodeChanges = Schema.decodeUnknownEffect(Schema.Array(TaskPromptSettingsChange));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const changeColumns = sql`
    id,
    revision,
    field,
    previous_text AS "previousText",
    new_text AS "newText",
    reason,
    source,
    thread_id AS "threadId",
    run_id AS "runId",
    reverts_change_id AS "revertsChangeId",
    created_at AS "createdAt"
  `;

  const decodedChanges = (operation: string) => (rows: ReadonlyArray<unknown>) =>
    decodeChanges(rows).pipe(Effect.mapError(toTaskPersistenceDecodeError(operation)));

  const getState: TaskPromptSettingsStoreShape["getState"] = sql`
    SELECT
      task_creation AS "taskCreation",
      agent_creation AS "agentCreation",
      automation_creation AS "automationCreation",
      task_execution AS "taskExecution",
      revision
    FROM task_prompt_settings
    WHERE id = 1
  `.pipe(
    Effect.mapError(toTaskPersistenceSqlError("get task prompt settings")),
    Effect.flatMap((rows) => {
      const row = rows[0];
      return row === undefined
        ? Effect.succeed({ settings: DEFAULT_TASK_PROMPT_SETTINGS, revision: 0 })
        : decodeStateRow(row).pipe(
            Effect.mapError(toTaskPersistenceDecodeError("decode task prompt settings")),
            Effect.map(({ revision, ...settings }) => ({ settings, revision })),
          );
    }),
  );

  const get: TaskPromptSettingsStoreShape["get"] = Effect.map(getState, (state) => state.settings);

  const writeState = (state: TaskPromptSettingsState) =>
    sql`
      INSERT INTO task_prompt_settings (
        id,
        task_creation,
        agent_creation,
        automation_creation,
        task_execution,
        revision
      ) VALUES (
        1,
        ${state.settings.taskCreation},
        ${state.settings.agentCreation},
        ${state.settings.automationCreation},
        ${state.settings.taskExecution},
        ${state.revision}
      )
      ON CONFLICT (id) DO UPDATE SET
        task_creation = excluded.task_creation,
        agent_creation = excluded.agent_creation,
        automation_creation = excluded.automation_creation,
        task_execution = excluded.task_execution,
        revision = excluded.revision
    `.pipe(Effect.mapError(toTaskPersistenceSqlError("update task prompt settings")));

  const insertChange = (change: TaskPromptSettingsChange) =>
    sql`
      INSERT INTO task_prompt_settings_changes (
        id, revision, field, previous_text, new_text, reason,
        source, thread_id, run_id, reverts_change_id, created_at
      ) VALUES (
        ${change.id}, ${change.revision}, ${change.field}, ${change.previousText},
        ${change.newText}, ${change.reason}, ${change.source}, ${change.threadId},
        ${change.runId}, ${change.revertsChangeId}, ${change.createdAt}
      )
    `.pipe(Effect.mapError(toTaskPersistenceSqlError("record task prompt settings change")));

  const getChange = (id: string) =>
    sql`SELECT ${changeColumns} FROM task_prompt_settings_changes WHERE id = ${id}`.pipe(
      Effect.mapError(toTaskPersistenceSqlError("get task prompt settings change")),
      Effect.flatMap(decodedChanges("decode task prompt settings change")),
      Effect.map((changes) => Option.fromNullishOr(changes[0])),
    );

  const changesAfter = (field: TaskPromptField, revision: number) =>
    sql`
      SELECT ${changeColumns} FROM task_prompt_settings_changes
      WHERE field = ${field} AND revision > ${revision}
      ORDER BY revision DESC
    `.pipe(
      Effect.mapError(toTaskPersistenceSqlError("list later task prompt settings changes")),
      Effect.flatMap(decodedChanges("decode task prompt settings changes")),
    );

  const history: TaskPromptSettingsStoreShape["history"] = (input) =>
    sql`
      SELECT ${changeColumns} FROM task_prompt_settings_changes
      WHERE (${input.field ?? null} IS NULL OR field = ${input.field ?? null})
      ORDER BY revision DESC
      LIMIT ${input.limit}
    `.pipe(
      Effect.mapError(toTaskPersistenceSqlError("list task prompt settings history")),
      Effect.flatMap(decodedChanges("decode task prompt settings history")),
    );

  const newChange = (input: {
    readonly revision: number;
    readonly field: TaskPromptField;
    readonly previousText: string;
    readonly newText: string;
    readonly reason: string | null;
    readonly origin: TaskPromptChangeOrigin;
    readonly revertsChangeId: string | null;
  }) =>
    Effect.gen(function* () {
      const change: TaskPromptSettingsChange = {
        // A failing random source is a defect, not a storage error.
        id: `task-prompt-change-${yield* Effect.orDie(crypto.randomUUIDv4)}`,
        revision: input.revision,
        field: input.field,
        previousText: input.previousText,
        newText: input.newText,
        reason: input.reason,
        source: input.origin.source,
        threadId: input.origin.threadId,
        runId: input.origin.runId,
        revertsChangeId: input.revertsChangeId,
        createdAt: DateTime.formatIso(yield* DateTime.now),
      };
      return change;
    });

  // Read, compare and write in one transaction, so a revision check cannot
  // race another writer.
  const transaction = <A>(effect: Effect.Effect<A, TaskRepositoryError>) =>
    sql
      .withTransaction(effect)
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof SqlError
            ? toTaskPersistenceSqlError("task prompt settings transaction")(cause)
            : cause,
        ),
      );

  /** Applies one field change on top of `state`; writes nothing on a dry run. */
  const applyFieldChange = (input: {
    readonly state: TaskPromptSettingsState;
    readonly field: TaskPromptField;
    readonly text: string;
    readonly reason: string | null;
    readonly origin: TaskPromptChangeOrigin;
    readonly revertsChangeId: string | null;
    readonly dryRun: boolean;
  }) =>
    Effect.gen(function* () {
      const change = yield* newChange({
        revision: input.state.revision + 1,
        field: input.field,
        previousText: input.state.settings[input.field],
        newText: input.text,
        reason: input.reason,
        origin: input.origin,
        revertsChangeId: input.revertsChangeId,
      });
      const state: TaskPromptSettingsState = {
        settings: { ...input.state.settings, [input.field]: input.text },
        revision: change.revision,
      };
      // A dry run reports the current state with the change it would record.
      if (input.dryRun) return { state: input.state, change };
      yield* writeState(state);
      yield* insertChange(change);
      return { state, change };
    });

  const update: TaskPromptSettingsStoreShape["update"] = (input) =>
    transaction(
      Effect.gen(function* () {
        let state = yield* getState;
        for (const field of TASK_PROMPT_FIELDS) {
          if (state.settings[field] === input[field]) continue;
          state = (yield* applyFieldChange({
            state,
            field,
            text: input[field],
            reason: null,
            origin: SETTINGS_PAGE_ORIGIN,
            revertsChangeId: null,
            dryRun: false,
          })).state;
        }
        return state.settings;
      }),
    );

  const updateField: TaskPromptSettingsStoreShape["updateField"] = (input) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* getState;
        if (state.revision !== input.expectedRevision)
          return {
            ok: false,
            reason: "stale-revision",
            currentRevision: state.revision,
          } as const;
        if (state.settings[input.field] === input.text)
          return { ok: true, state, change: null } as const;
        const applied = yield* applyFieldChange({ ...input, state, revertsChangeId: null });
        return { ok: true, ...applied } as const;
      }),
    );

  const revert: TaskPromptSettingsStoreShape["revert"] = (input) =>
    transaction(
      Effect.gen(function* (): Effect.fn.Return<TaskPromptRevertResult, TaskRepositoryError> {
        const reverted = yield* getChange(input.changeId);
        if (Option.isNone(reverted)) return { ok: false, reason: "not-found" };
        const target = reverted.value;
        const state = yield* getState;
        const current = state.settings[target.field];
        if (current === target.previousText)
          return { ok: true, state, reverted: target, change: null };
        if (current !== target.newText)
          return {
            ok: false,
            reason: "changed-since",
            reverted: target,
            laterChanges: yield* changesAfter(target.field, target.revision),
          };
        const applied = yield* applyFieldChange({
          state,
          field: target.field,
          text: target.previousText,
          reason: input.reason ?? `Revert ${target.id}`,
          origin: input.origin,
          revertsChangeId: target.id,
          dryRun: input.dryRun,
        });
        return { ok: true, reverted: target, ...applied };
      }),
    );

  return {
    get,
    getState,
    update,
    updateField,
    revert,
    history,
  } satisfies TaskPromptSettingsStoreShape;
});

export const TaskPromptSettingsStoreLive = Layer.effect(TaskPromptSettingsStore, make);
