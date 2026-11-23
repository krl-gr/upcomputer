import {
  INSTRUCTION_UPDATES,
  InstructionUpdateDecider,
  InstructionUpdatesMode,
  InstructionUpdateState,
  isPendingInstructionUpdate,
  TaskPromptSettings,
  type InstructionUpdateEntry,
  type InstructionUpdates,
  type InstructionUpdateStatus,
  type InstructionUpdatesUpdateInput,
  type TaskListSettings,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";
import { IsoDateTime } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { toTaskPersistenceSqlError } from "../persistence/Errors.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import {
  TaskPromptSettingsStore,
  type InstructionsStoreError,
} from "../persistence/TaskPromptSettingsStore.ts";
import type { TaskRepositoryError } from "../persistence/Errors.ts";
import {
  appliedAtInstall,
  editedTextOf,
  renamedGroupKey,
  renamedStatuses,
  touchesEditedText,
  type EditedText,
  type UserTexts,
} from "./instructionUpdateRules.ts";

export type InstructionUpdatesError = InstructionsStoreError | TaskRepositoryError;

export interface InstructionUpdateDetails extends InstructionUpdateStatus {
  readonly entry: InstructionUpdateEntry;
  readonly edited: EditedText;
}

/** What a bot reads before it proposes anything: the entries and the settings they touch. */
export interface InstructionUpdatesDetails {
  readonly mode: InstructionUpdatesMode;
  readonly workflowVersion: TaskWorkflowVersion;
  readonly listSettings: TaskListSettings;
  readonly entries: ReadonlyArray<InstructionUpdateDetails>;
}

export interface InstructionUpdatesServiceShape {
  readonly get: Effect.Effect<InstructionUpdates, InstructionUpdatesError>;
  readonly details: Effect.Effect<InstructionUpdatesDetails, InstructionUpdatesError>;
  /** The person's writes from Settings and the bell; switching to "auto" applies what it can. */
  readonly update: (
    input: InstructionUpdatesUpdateInput,
  ) => Effect.Effect<InstructionUpdates, InstructionUpdatesError>;
  /** A chat closes or reopens an entry. None when the entry is unknown. */
  readonly decide: (input: {
    readonly id: string;
    readonly state: "pending" | "applied" | "kept";
    readonly decidedBy: InstructionUpdateDecider;
  }) => Effect.Effect<Option.Option<InstructionUpdateStatus>, InstructionUpdatesError>;
  /**
   * Gives entries a later build added their row, then, in "auto" mode,
   * applies every pending entry that would not change text the user edited.
   * Runs when the server starts.
   */
  readonly sync: Effect.Effect<ReadonlyArray<string>, InstructionUpdatesError>;
}

export class InstructionUpdatesService extends Context.Service<
  InstructionUpdatesService,
  InstructionUpdatesServiceShape
>()("upcomputer.tasks/InstructionUpdatesService") {}

const Row = Schema.Struct({
  id: Schema.String,
  state: InstructionUpdateState,
  decidedAt: Schema.NullOr(IsoDateTime),
  decidedBy: Schema.NullOr(Schema.fromJsonString(InstructionUpdateDecider)),
});
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const decodeMode = Schema.decodeUnknownOption(InstructionUpdatesMode);
const decodePrompts = Schema.decodeUnknownEffect(TaskPromptSettings);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repository = yield* TaskRepository;
  const prompts = yield* TaskPromptSettingsStore;
  const agents = yield* TaskAgentService;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const sqlError = (operation: string) =>
    Effect.mapError(toTaskPersistenceSqlError(`InstructionUpdatesService.${operation}`));

  const readRows = sql`
    SELECT entry_id AS id, state, decided_at AS "decidedAt", decided_by_json AS "decidedBy"
    FROM task_instruction_updates
  `.pipe(
    Effect.flatMap(decodeRows),
    Effect.map((rows) => new Map(rows.map((row) => [row.id, row]))),
    sqlError("rows"),
  );

  const readMode = sql<{ mode: string }>`
    SELECT instruction_updates_mode AS mode FROM task_settings WHERE id = 1
  `.pipe(
    Effect.map(([row]) => Option.getOrElse(decodeMode(row?.mode), () => "ask" as const)),
    sqlError("mode"),
  );

  const writeRow = Effect.fn("InstructionUpdatesService.writeRow")(function* (
    id: string,
    state: InstructionUpdateState,
    decidedBy: InstructionUpdateDecider | null,
  ) {
    const decidedAt = decidedBy === null ? null : yield* nowIso;
    yield* sql`
        INSERT INTO task_instruction_updates (entry_id, state, decided_at, decided_by_json)
        VALUES (${id}, ${state}, ${decidedAt}, ${decidedBy === null ? null : JSON.stringify(decidedBy)})
        ON CONFLICT (entry_id) DO UPDATE SET
          state = excluded.state,
          decided_at = excluded.decided_at,
          decided_by_json = excluded.decided_by_json
      `;
  }, sqlError("write"));

  const userTexts = Effect.gen(function* () {
    const state = yield* prompts.getState;
    const projectRows = yield* sql<{ id: string }>`
      SELECT
        project_id AS id,
        task_creation AS "taskCreation",
        agent_creation AS "agentCreation",
        automation_creation AS "automationCreation",
        task_execution AS "taskExecution"
      FROM task_project_prompt_settings
    `.pipe(sqlError("projects"));
    const projects = yield* Effect.forEach(projectRows, (row) =>
      decodePrompts(row).pipe(
        Effect.map((settings) => ({ id: row.id, settings })),
        Effect.orElseSucceed(() => null),
      ),
    );
    const workers = (yield* repository.listAllAgents()).filter(
      (agent) => agent.archivedAt === null,
    );
    return {
      prompts: state.settings,
      allChats: state.allChats,
      projects: projects.filter((project) => project !== null),
      workers: workers.map((agent) => ({
        id: agent.id,
        name: agent.name,
        instructions: agent.config.instructions,
      })),
    } satisfies UserTexts;
  });

  const details: InstructionUpdatesServiceShape["details"] = Effect.gen(function* () {
    const rows = yield* readRows;
    const texts = yield* userTexts;
    const listSettings = yield* repository.listSettings();
    return {
      mode: yield* readMode,
      workflowVersion: listSettings.workflowVersion ?? 1,
      listSettings,
      entries: INSTRUCTION_UPDATES.flatMap((entry) => {
        const row = rows.get(entry.id);
        if (row === undefined) return [];
        const edited = editedTextOf(entry, texts);
        return [
          {
            id: entry.id,
            state: row.state,
            decidedAt: row.decidedAt,
            decidedBy: row.decidedBy,
            touchesEditedText: touchesEditedText(edited),
            entry,
            edited,
          },
        ];
      }),
    };
  });

  const get: InstructionUpdatesServiceShape["get"] = Effect.map(details, (current) => ({
    mode: current.mode,
    entries: current.entries.map(({ entry: _entry, edited: _edited, ...status }) => status),
  }));

  const statusOf = (id: string) =>
    Effect.map(details, (current) => {
      const found = current.entries.find((entry) => entry.id === id);
      if (found === undefined) return Option.none<InstructionUpdateStatus>();
      const { entry: _entry, edited: _edited, ...status } = found;
      return Option.some(status);
    });

  /** Applies an entry's changes as shipped: only reached when it changes nothing the user edited. */
  const applyAsShipped = Effect.fn("InstructionUpdatesService.applyAsShipped")(function* (
    entry: InstructionUpdateEntry,
  ) {
    for (const change of entry.changes) {
      if (change.kind !== "prompt") continue;
      const state = yield* prompts.getState;
      if (state.settings[change.field] !== change.before) continue;
      yield* prompts.updateField({
        projectId: null,
        field: change.field,
        text: change.after,
        reason: `Instruction update "${entry.title}", applied automatically`,
        expectedRevision: state.revision,
        origin: { source: "unknown", threadId: null, runId: null },
        dryRun: false,
      });
    }
    const renames = entry.statusRenames ?? {};
    if (Object.keys(renames).length > 0) {
      for (const [from, to] of Object.entries(renames)) {
        yield* repository.renameTaskStatus({
          from,
          to,
          automationTemplates: true,
          actor: { type: "server" },
        });
      }
      for (const agent of yield* repository.listAllAgents()) {
        const startStatuses = renamedStatuses(agent.startStatuses, renames);
        if (startStatuses.join("\n") === agent.startStatuses.join("\n")) continue;
        const saved = yield* repository.upsertAgent({
          ...agent,
          startStatuses,
          updatedAt: yield* nowIso,
        });
        yield* agents.scheduleAgentChanged({ agent: saved, reason: "upserted" });
      }
      const list = yield* repository.listSettings();
      const order = list.statusGroupOrder.map((key) => renamedGroupKey(key, renames));
      const open = Object.fromEntries(
        Object.entries(list.statusGroupOpen).map(([key, value]) => [
          renamedGroupKey(key, renames),
          value,
        ]),
      );
      if (
        order.some((key, index) => key !== list.statusGroupOrder[index]) ||
        Object.keys(open).some((key) => !(key in list.statusGroupOpen))
      )
        yield* repository.updateListSettings({ statusGroupOrder: order, statusGroupOpen: open });
    }
    if (entry.workflowVersion !== undefined)
      yield* repository.setWorkflowVersion({ version: entry.workflowVersion });
    yield* writeRow(entry.id, "applied", { kind: "auto", name: null });
  });

  const applyAutomatically = Effect.gen(function* () {
    const current = yield* details;
    if (current.mode !== "auto") return [];
    const applied: string[] = [];
    for (const item of current.entries) {
      if (!isPendingInstructionUpdate(item.state) || item.touchesEditedText) continue;
      // One entry that cannot apply leaves it pending for the user, not the others.
      const done = yield* applyAsShipped(item.entry).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.logWarning("Instruction update did not apply automatically", {
            entry: item.id,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );
      if (done) applied.push(item.id);
    }
    return applied;
  });

  const sync: InstructionUpdatesServiceShape["sync"] = Effect.gen(function* () {
    const rows = yield* readRows;
    const workflowVersion = yield* repository.workflowVersion();
    const missing = INSTRUCTION_UPDATES.filter((entry) => !rows.has(entry.id));
    for (const entry of missing) {
      yield* writeRow(
        entry.id,
        appliedAtInstall(entry, workflowVersion) ? "applied" : "pending",
        null,
      );
    }
    const applied = yield* applyAutomatically;
    if (missing.length > 0 || applied.length > 0)
      yield* repository.announceInstructionUpdatesChanged();
    return applied;
  });

  const update: InstructionUpdatesServiceShape["update"] = Effect.fn(
    "InstructionUpdatesService.update",
  )(function* (input) {
    if (input.mode !== undefined)
      yield* sql`UPDATE task_settings SET instruction_updates_mode = ${input.mode} WHERE id = 1`.pipe(
        sqlError("setMode"),
      );
    const rows = yield* readRows;
    for (const change of input.entries ?? []) {
      const row = rows.get(change.id);
      // Applied is final from here: only a chat that applied it can reopen it.
      if (row === undefined || row.state === "applied" || row.state === change.state) continue;
      yield* writeRow(
        change.id,
        change.state,
        change.state === "kept" ? { kind: "person", name: null } : null,
      );
    }
    yield* applyAutomatically;
    yield* repository.announceInstructionUpdatesChanged();
    return yield* get;
  });

  const decide: InstructionUpdatesServiceShape["decide"] = Effect.fn(
    "InstructionUpdatesService.decide",
  )(function* (input) {
    const rows = yield* readRows;
    if (!rows.has(input.id)) return Option.none();
    yield* writeRow(input.id, input.state, input.state === "pending" ? null : input.decidedBy);
    yield* repository.announceInstructionUpdatesChanged();
    return yield* statusOf(input.id);
  });

  return { get, details, update, decide, sync } satisfies InstructionUpdatesServiceShape;
});

export const InstructionUpdatesServiceLive = Layer.effect(InstructionUpdatesService, make);
