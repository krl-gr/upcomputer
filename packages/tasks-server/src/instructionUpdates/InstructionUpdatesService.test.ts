import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  LEGACY_TASK_PROMPT_SETTINGS,
  TaskAgentId,
  TaskId,
  type TaskAgent,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { AllChatsInstructions } from "../persistence/AllChatsInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskPromptSettingsStoreLive } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository, type PersistTaskInput } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import {
  InstructionUpdatesService,
  InstructionUpdatesServiceLive,
} from "./InstructionUpdatesService.ts";

const ENTRY = "task-statuses-v2";
const timestamp = "2026-11-20T10:00:00.000Z";

const migrateThrough = (version: number) =>
  runExperimentalFeatureMigrations([
    {
      ...TASK_MIGRATION_CONTRIBUTION,
      migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
        (migration) => migration.version <= version,
      ),
    },
  ]);

const layer = () => {
  let allChats = "";
  return InstructionUpdatesServiceLive.pipe(
    Layer.provideMerge(Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive)),
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(AllChatsInstructions, {
          get: Effect.sync(() => allChats),
          set: (text) => Effect.sync(() => void (allChats = text)),
        }),
        Layer.succeed(TaskAgentService, { scheduleAgentChanged: () => Effect.void } as never),
        NodeCrypto.layer,
      ),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  );
};

/** An install from before instruction updates, on workflow 1 with these texts. */
const existingInstall = (texts = LEGACY_TASK_PROMPT_SETTINGS) =>
  Effect.gen(function* () {
    yield* migrateThrough(42);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE task_prompt_settings SET
        task_creation = ${texts.taskCreation},
        agent_creation = ${texts.agentCreation},
        automation_creation = ${texts.automationCreation},
        task_execution = ${texts.taskExecution}
      WHERE id = 1
    `;
    yield* migrateThrough(44);
  });

const task = (id: string, status: string): PersistTaskInput => ({
  id: TaskId.make(id),
  projectId: ProjectId.make("project-1"),
  title: id,
  description: "",
  output: null,
  status,
  priority: null,
  createdBy: "test",
  assigneeAgentRunId: null,
  sourceThreadId: null,
  sourceRunId: null,
  metadata: null,
  tags: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
});

const worker = (instructions: string): TaskAgent => ({
  id: TaskAgentId.make("agent-reviewer"),
  projectId: null,
  name: "Reviewer",
  enabled: true,
  startStatuses: ["Needs Review", "In Review"],
  startTags: [],
  startRunStatuses: [],
  config: {
    role: "reviewer",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-test" },
    instructions,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
});

const entryOf = Effect.gen(function* () {
  const { entries } = yield* (yield* InstructionUpdatesService).get;
  return entries.find((entry) => entry.id === ENTRY);
});

it.effect("a new install starts with every entry applied, so nothing waits", () =>
  Effect.gen(function* () {
    yield* migrateThrough(44);
    const entry = yield* entryOf;
    assert.strictEqual(entry?.state, "applied");
    // Applied at install: no decision to show.
    assert.strictEqual(entry?.decidedAt, null);
    assert.strictEqual((yield* (yield* InstructionUpdatesService).get).mode, "ask");
  }).pipe(Effect.provide(layer())),
);

it.effect("an existing install on workflow 1 gets the entry pending", () =>
  Effect.gen(function* () {
    yield* existingInstall();
    const entry = yield* entryOf;
    assert.strictEqual(entry?.state, "pending");
    assert.isFalse(entry?.touchesEditedText);
  }).pipe(Effect.provide(layer())),
);

it.effect("sync gives an entry a later build added its row, applied when the install has it", () =>
  Effect.gen(function* () {
    yield* existingInstall();
    const sql = yield* SqlClient.SqlClient;
    const updates = yield* InstructionUpdatesService;
    yield* sql`DELETE FROM task_instruction_updates`;
    assert.strictEqual(yield* entryOf, undefined);
    yield* updates.sync;
    assert.strictEqual((yield* entryOf)?.state, "pending");

    yield* sql`DELETE FROM task_instruction_updates`;
    yield* (yield* TaskRepository).setWorkflowVersion({ version: 2 });
    yield* updates.sync;
    assert.strictEqual((yield* entryOf)?.state, "applied");
  }).pipe(Effect.provide(layer())),
);

it.effect("Apply automatically applies an untouched install as shipped, starting nothing", () =>
  Effect.gen(function* () {
    yield* existingInstall();
    const repository = yield* TaskRepository;
    const updates = yield* InstructionUpdatesService;
    yield* repository.upsert(task("queued", "Backlog"));
    yield* repository.upsert(task("question", "Needs Input"));
    yield* repository.upsertAgent(worker("Review the diff and report findings."));
    yield* repository.updateListSettings({
      statusGroupOrder: ["needs input", "backlog", "to do"],
      statusGroupOpen: { backlog: false },
    });
    const before = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("queued") }));

    yield* updates.update({ mode: "auto" });

    const entry = yield* entryOf;
    assert.strictEqual(entry?.state, "applied");
    assert.deepStrictEqual(entry?.decidedBy, { kind: "auto", name: null });
    const queued = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("queued") }));
    assert.strictEqual(queued.status, "Queued");
    assert.strictEqual(queued.triggerChangedAt, before.triggerChangedAt);
    const question = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("question") }));
    assert.strictEqual(question.status, "Needs You");
    const agent = Option.getOrThrow(yield* repository.getAgentById({ id: worker("").id }));
    assert.deepStrictEqual(agent.startStatuses, ["To Verify", "In Review"]);
    const list = yield* repository.listSettings();
    assert.deepStrictEqual(list.statusGroupOrder, ["needs you", "failed", "queued", "to do"]);
    assert.strictEqual(list.statusGroupOpen.queued, false);
    assert.strictEqual(list.workflowVersion, 2);
    const details = yield* updates.details;
    assert.strictEqual(details.workflowVersion, 2);
    const sql = yield* SqlClient.SqlClient;
    const [prompts] = yield* sql<{ taskExecution: string }>`
      SELECT task_execution AS "taskExecution" FROM task_prompt_settings WHERE id = 1`;
    assert.strictEqual(prompts?.taskExecution, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
  }).pipe(Effect.provide(layer())),
);

it.effect("Apply automatically never overwrites edited text: the entry waits and says why", () =>
  Effect.gen(function* () {
    const edited = { ...LEGACY_TASK_PROMPT_SETTINGS, taskCreation: "My own task rules." };
    yield* existingInstall(edited);
    const repository = yield* TaskRepository;
    const updates = yield* InstructionUpdatesService;
    yield* repository.upsert(task("queued", "Backlog"));

    yield* updates.update({ mode: "auto" });
    yield* updates.sync;

    const entry = yield* entryOf;
    assert.strictEqual(entry?.state, "pending");
    assert.isTrue(entry?.touchesEditedText);
    const details = yield* updates.details;
    assert.deepStrictEqual(details.entries[0]?.edited.editedFields, ["taskCreation"]);
    assert.strictEqual(details.workflowVersion, 1);
    const queued = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("queued") }));
    assert.strictEqual(queued.status, "Backlog");
  }).pipe(Effect.provide(layer())),
);

it.effect("a worker's own instructions that name an old status count as edited text", () =>
  Effect.gen(function* () {
    yield* existingInstall();
    const repository = yield* TaskRepository;
    const updates = yield* InstructionUpdatesService;
    yield* repository.upsertAgent(worker("Hand off the bottom Backlog task when done."));

    yield* updates.update({ mode: "auto" });

    assert.strictEqual((yield* entryOf)?.state, "pending");
    const details = yield* updates.details;
    assert.deepStrictEqual(details.entries[0]?.edited.mentions, [
      { where: "worker", id: "agent-reviewer", name: "Reviewer", statuses: ["Backlog"] },
    ]);
    const agent = Option.getOrThrow(yield* repository.getAgentById({ id: worker("").id }));
    assert.deepStrictEqual(agent.startStatuses, ["Needs Review", "In Review"]);
  }).pipe(Effect.provide(layer())),
);

it.effect("a person dismisses, keeps and reopens; only a chat changes an applied entry", () =>
  Effect.gen(function* () {
    yield* existingInstall();
    const updates = yield* InstructionUpdatesService;

    yield* updates.update({ entries: [{ id: ENTRY, state: "dismissed" }] });
    assert.strictEqual((yield* entryOf)?.state, "dismissed");
    yield* updates.update({ entries: [{ id: ENTRY, state: "kept" }] });
    assert.deepStrictEqual((yield* entryOf)?.decidedBy, { kind: "person", name: null });
    yield* updates.update({ entries: [{ id: ENTRY, state: "pending" }] });
    assert.strictEqual((yield* entryOf)?.state, "pending");

    const decided = yield* updates.decide({
      id: ENTRY,
      state: "applied",
      decidedBy: { kind: "chat", name: "Penny" },
    });
    assert.strictEqual(Option.getOrThrow(decided).state, "applied");
    yield* updates.update({ entries: [{ id: ENTRY, state: "kept" }] });
    assert.deepStrictEqual((yield* entryOf)?.decidedBy, { kind: "chat", name: "Penny" });
    assert.isTrue(
      Option.isNone(
        yield* updates.decide({
          id: "unknown",
          state: "kept",
          decidedBy: { kind: "chat", name: null },
        }),
      ),
    );
  }).pipe(Effect.provide(layer())),
);
