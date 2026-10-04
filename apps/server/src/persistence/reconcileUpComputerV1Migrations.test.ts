// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TASK_MIGRATION_CONTRIBUTION } from "@t3tools/tasks-server/persistence";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { runExperimentalFeatureMigrations } from "../product/FeatureMigrations.ts";
import * as SqlitePersistence from "./Layers/Sqlite.ts";
import { runMigrations } from "./Migrations.ts";
import Migration0033 from "./Migrations/033_ProjectionThreadsSettled.ts";
import Migration0034 from "./Migrations/034_ProjectionThreadsSnoozed.ts";
import Migration0044 from "./Migrations/044_ClearAutomaticProjectModelDefaults.ts";

const threadId = ThreadId.make("v1-task-run-thread");

/**
 * The UpComputer V1 schema as the owner's database has it: upstream through
 * 32, then V1's own 33-37, where three of upstream's migrations sit under
 * other ids, plus the task feature on its own ledger.
 */
const seedUpComputerV1 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 32 });
  const v1Migrations = [
    [
      33,
      "ProjectionThreadContext",
      Effect.gen(function* () {
        yield* sql`CREATE TABLE projection_thread_context_bindings (binding_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL)`;
        yield* sql`ALTER TABLE projection_turns ADD COLUMN context_blocks_json TEXT NOT NULL DEFAULT '[]'`;
      }),
    ],
    [34, "ProjectionThreadsSettled", Migration0033],
    [35, "ProjectionThreadsSnoozed", Migration0034],
    [
      36,
      "ProjectionThreadsSidebarVisibility",
      sql`ALTER TABLE projection_threads ADD COLUMN sidebar_visible INTEGER NOT NULL DEFAULT 1`,
    ],
    [37, "ClearAutomaticProjectModelDefaults", Migration0044],
  ] as const;
  for (const [id, name, migration] of v1Migrations) {
    yield* migration;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
  }
  yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);

  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('project', 'Project', '/tmp/project', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
  yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at, sidebar_visible)
    VALUES (${threadId}, 'project', 'Task run', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`;
  for (let index = 0; index < 4; index++) {
    yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
      VALUES (${`message-${index}`}, ${threadId}, ${index % 2 ? "assistant" : "user"}, ${`Text ${index}`}, 0, ${`2026-01-0${index + 1}T00:00:00.000Z`}, ${`2026-01-0${index + 1}T00:00:00.000Z`})`;
  }
  yield* sql`INSERT INTO tasks (id, rank, project_id, title, description, status, created_by, metadata_json, created_at, updated_at)
    VALUES ('task-1', '0000000000100000', 'project', 'Kept task', '', 'To Do', 'user', 'null', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
});

it.effect(
  "opens a copied UpComputer V1 database on upstream's schema and imports its threads",
  () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-v1-v2-"));
    const sourcePath = NodePath.join(directory, "state.sqlite");
    const destinationPath = NodePath.join(directory, "statev2.sqlite");
    return Effect.gen(function* () {
      yield* seedUpComputerV1.pipe(
        Effect.provide(NodeSqliteClient.layer({ filename: sourcePath })),
      );
      const original = NodeFS.readFileSync(sourcePath);
      const config = yield* ServerConfig.ServerConfig;
      // initializeV2Database copies V1, then the migrations run on the copy.
      const databaseLayer = SqlitePersistence.layerConfig.pipe(
        Layer.provide(ServerConfig.layer({ ...config, dbPath: destinationPath })),
      );
      const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
        Layer.provideMerge(databaseLayer),
      );
      const importer = LegacyV1ThreadImporter.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(stores, EventSink.layer.pipe(Layer.provide(stores)))),
      );
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE migration_id BETWEEN 33 AND 37 ORDER BY migration_id
      `;
        assert.deepEqual(
          ledger.map((row) => `${row.migration_id}:${row.name}`),
          [
            "33:ProjectionThreadsSettled",
            "34:ProjectionThreadsSnoozed",
            "35:ProjectionThreadTitleRegeneration",
            "36:ProjectionThreadsPinned",
            "37:ProjectionTurnsKeysetIndex",
          ],
        );
        const latest = yield* sql<{ readonly id: number }>`
        SELECT MAX(migration_id) AS id FROM effect_sql_migrations
      `;
        assert.equal(latest[0]?.id, 56);

        const legacy = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
        yield* legacy.reconcileShells;
        yield* legacy.ensureTranscript(threadId);
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const transcript = yield* projections.getThreadProjection(threadId);
        assert.deepEqual(
          transcript.messages.map((message) => message.text),
          ["Text 0", "Text 1", "Text 2", "Text 3"],
        );

        // The task feature finds its ledger current and its rows untouched.
        assert.deepEqual(
          yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
          [],
        );
        const tasks = yield* sql<{ readonly id: string; readonly title: string }>`
        SELECT id, title FROM tasks
      `;
        assert.deepEqual(tasks, [{ id: "task-1", title: "Kept task" }]);
        // V1's own columns stay for the importer extensions that read them later.
        const hidden = yield* sql<{ readonly sidebar_visible: number }>`
        SELECT sidebar_visible FROM projection_threads WHERE thread_id = ${threadId}
      `;
        assert.equal(hidden[0]?.sidebar_visible, 0);
      }).pipe(Effect.provide(importer));

      assert.deepEqual(NodeFS.readFileSync(sourcePath), original);
      const v1 = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
      try {
        assert.equal(
          v1.prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 33").get()?.name,
          "ProjectionThreadContext",
        );
      } finally {
        v1.close();
      }
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(directory, directory).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
      Effect.ensuring(
        Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      ),
    );
  },
);

it.effect("refuses an UpComputer V1 ledger it does not recognize", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 32 });
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (33, 'ProjectionThreadContext')`;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (34, 'SomethingNewInV1')`;
    const error = yield* runMigrations().pipe(Effect.flip);
    assert.equal(error._tag, "MigrationError");
    assert.include(error.message, "34:SomethingNewInV1");
    const ledger = yield* sql<{ readonly name: string }>`
      SELECT name FROM effect_sql_migrations WHERE migration_id = 33
    `;
    assert.equal(ledger[0]?.name, "ProjectionThreadContext");
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
