// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { COMPUTER_USE_SERVER_FEATURE } from "@t3tools/computer-use-server/feature";
import { TASK_MIGRATION_CONTRIBUTION } from "@t3tools/tasks-server/persistence";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { CORE_FEATURE_MIGRATIONS } from "../persistence/CoreFeatureMigrations.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import Migration0033 from "../persistence/Migrations/033_ProjectionThreadsSettled.ts";
import Migration0034 from "../persistence/Migrations/034_ProjectionThreadsSnoozed.ts";
import Migration0044 from "../persistence/Migrations/044_ClearAutomaticProjectModelDefaults.ts";
import { runExperimentalFeatureMigrations } from "../product/FeatureMigrations.ts";
import { PUBLIC_SERVER_PRODUCT } from "../product/publicProduct.ts";
import { ServerProduct } from "../product/ServerProduct.ts";
import {
  cutoverV1OnServerStart,
  readV1CutoverState,
  runV1Cutover,
  runV1CutoverOnStart,
} from "./V1Cutover.ts";

const at = "2026-10-01T00:00:00.000Z";
const JsonText = Schema.fromJsonString(Schema.Unknown);
const toJson = Schema.encodeSync(JsonText);
const decodeJson = Schema.decodeUnknownSync(JsonText);
const fromJson = (text: string) => decodeJson(text) as Record<string, unknown>;

/** V1 computer-use settings a person narrowed; v2's settings schema does not know them. */
const restrictedComputerUse = {
  enabled: false,
  mode: "observe",
  requireActionApproval: true,
  allowedApps: ["Notes"],
};

/** An UpComputer V1 home: its schema, a few threads, one in-flight task run. */
const seedV1 = (sessionFile: string, otherHomeSessionFile: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 32 });
    const v1Migrations = [
      [
        33,
        "ProjectionThreadContext",
        sql`CREATE TABLE projection_thread_context_bindings (
          binding_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, source_thread_id TEXT NOT NULL,
          source_project_id TEXT, source_thread_title TEXT NOT NULL, mode TEXT NOT NULL,
          cutoff_message_id TEXT, snapshot_text TEXT, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL)`,
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
    yield* runExperimentalFeatureMigrations([CORE_FEATURE_MIGRATIONS, TASK_MIGRATION_CONTRIBUTION]);
    // V1's own upcomputer.core migrations also gave threads these columns; v2 keeps links in JSON.
    yield* sql`ALTER TABLE projection_threads ADD COLUMN linked_project_ids_json TEXT NOT NULL DEFAULT '[]'`;
    yield* sql`ALTER TABLE projection_threads ADD COLUMN project_links_pinned INTEGER NOT NULL DEFAULT 0`;

    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('project-a', 'A', '/tmp/a', '[]', ${at}, ${at}), ('project-b', 'B', '/tmp/b', '[]', ${at}, ${at})`;
    const thread = (id: string, instanceId: string, mode: string, visible: number, links: string) =>
      sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, created_at, updated_at, sidebar_visible, linked_project_ids_json)
        VALUES (${id}, 'project-a', ${id}, ${toJson({ instanceId, model: "m" })}, 'full-access',
          ${mode}, ${at}, ${at}, ${visible}, ${links})`;
    yield* thread("thread-run", "codex", "default", 0, "[]");
    yield* thread("thread-chat", "claudeAgent", "ask", 1, '["project-b"]');
    yield* thread("thread-up", "up", "default", 1, "[]");
    yield* thread("thread-up-local-test", "up", "default", 1, "[]");
    yield* sql`UPDATE projection_threads SET settled_override = 'settled', settled_at = ${at}
      WHERE thread_id = 'thread-chat'`;
    const message = (id: string, threadId: string, role: string, createdAt: string) =>
      sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES (${id}, ${threadId}, ${role}, ${`Text of ${id}`}, 0, ${createdAt}, ${createdAt})`;
    yield* message("m-run-1", "thread-run", "user", "2026-10-01T01:00:00.000Z");
    yield* message("m-chat-1", "thread-chat", "user", "2026-10-01T01:00:00.000Z");
    yield* message("m-chat-2", "thread-chat", "assistant", "2026-10-01T02:00:00.000Z");
    yield* message("m-chat-3", "thread-chat", "user", "2026-10-01T03:00:00.000Z");
    yield* message("m-up-1", "thread-up", "user", "2026-10-01T01:00:00.000Z");
    yield* sql`INSERT INTO projection_thread_context_bindings (binding_id, thread_id, source_thread_id,
        source_thread_title, mode, snapshot_text, created_at, updated_at)
      VALUES ('ctx-1', 'thread-chat', 'thread-up', 'Up chat', 'snapshot', 'USER: hi',
        '2026-10-01T02:30:00.000Z', '2026-10-01T02:30:00.000Z'),
        ('ctx-2', 'thread-chat', 'thread-run', 'Never sent', 'snapshot', 'USER: late',
        '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z')`;
    yield* sql`INSERT INTO provider_session_runtime (thread_id, provider_name, adapter_key, provider_instance_id,
        runtime_mode, status, last_seen_at, resume_cursor_json)
      VALUES ('thread-up', 'up', 'up', 'up', 'full-access', 'stopped', ${at},
        ${toJson({ sessionFile, sessionId: "s" })}),
        ('thread-up-local-test', 'up', 'up', 'up', 'full-access', 'stopped', ${at},
        ${toJson({ sessionFile: otherHomeSessionFile, sessionId: "t" })})`;

    yield* sql`INSERT INTO tasks (id, rank, project_id, title, description, status, created_by, metadata_json,
        created_at, updated_at, trigger_changed_at, assignee_worker_id)
      VALUES ('task-1', '0000000000100000', 'project-a', 'In flight', 'Uses mcp__upcomputer_tasks__task_get.',
        'In Progress', 'agent', 'null', ${at}, ${at}, ${at}, 'run-1')`;
    yield* sql`INSERT INTO task_agents (id, project_id, name, enabled, start_statuses_json, start_tags_json,
        config_json, created_at, updated_at)
      VALUES ('agent-1', NULL, 'Developer', 1, '["To Do"]', '["dev"]',
        ${toJson({ role: "Dev", modelSelection: { instanceId: "up", model: "m" }, instructions: "Use task_get." })},
        ${at}, ${at})`;
    yield* sql`INSERT INTO task_agent_runs (id, task_id, agent_id, thread_id, model_selection_json, status, started_at)
      VALUES ('run-1', 'task-1', 'agent-1', 'thread-run', '{"instanceId":"up","model":"m"}', 'running', ${at})`;
  });

function dumpV1(path: string) {
  const database = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  try {
    return [
      "effect_sql_migrations",
      "projection_threads",
      "projection_thread_messages",
      "tasks",
      "task_agent_runs",
    ].map((table) => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
  } finally {
    database.close();
  }
}

it.effect("moves a V1 home onto v2 with a backup that restores it", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-cutover-"));
  // The data was copied out of a home that keeps an older userdata folder.
  const v1Home = NodePath.join(root, "v1-home");
  const home = NodePath.join(root, "home");
  const userdata = NodePath.join(home, "userdata");
  const sessionName = "2026-07-17_session.jsonl";
  const v1SessionFile = NodePath.join(
    v1Home,
    "userdata",
    "provider",
    "pi",
    "sessions",
    sessionName,
  );
  const olderSessions = NodePath.join(
    v1Home,
    "userdata.alpha-backup-20261003",
    "provider",
    "pi",
    "sessions",
  );
  return Effect.gen(function* () {
    NodeFS.mkdirSync(olderSessions, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(olderSessions, sessionName), '{"type":"session"}\n');
    // A thread started in another home (local test builds) keeps its file there.
    const otherHomeSession = NodePath.join(root, "other-home", "sessions", "other.jsonl");
    NodeFS.mkdirSync(NodePath.dirname(otherHomeSession), { recursive: true });
    NodeFS.writeFileSync(otherHomeSession, '{"type":"session"}\n');
    NodeFS.mkdirSync(NodePath.join(userdata, "secrets"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(userdata, "secrets", "key"), "secret");
    NodeFS.writeFileSync(NodePath.join(userdata, "environment-id"), "environment-1\n");
    const settings = toJson({
      customInstructions: "Start with mcp__upcomputer_tasks__task_context.",
      enableAssistantStreaming: true,
      providers: { cursor: { enabled: true } },
      browser: { alwaysUseChrome: true },
      computerUse: restrictedComputerUse,
    });
    NodeFS.writeFileSync(NodePath.join(userdata, "settings.json"), settings);
    const v1Path = NodePath.join(userdata, "state.sqlite");
    yield* seedV1(v1SessionFile, otherHomeSession).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: v1Path })),
    );
    const v1Bytes = NodeFS.readFileSync(v1Path);
    const v1Rows = dumpV1(v1Path);

    const { report, reportPath } = yield* runV1Cutover({
      homeDir: home,
      v1HomeDir: v1Home,
      featureMigrations: [TASK_MIGRATION_CONTRIBUTION],
      features: [COMPUTER_USE_SERVER_FEATURE],
      now: DateTime.makeUnsafe("2026-10-06T08:00:00.000Z"),
      log: () => Effect.void,
    });

    assert.deepStrictEqual(
      report.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(report.after.threads.hiddenLiveThreads, 1);
    assert.equal(report.before.threads.askLiveThreads, 1);
    assert.equal(report.after.threads.linkedLiveThreads, 1);
    assert.equal(report.before.threads.settledLiveThreads, 1);
    assert.equal(report.after.threads.settledLiveThreads, 0);
    assert.deepStrictEqual(report.contextBindings, { mapped: 1, skipped: 1, messages: 1 });
    assert.deepStrictEqual(report.piSessions, { inPlace: 0, recovered: 2, missing: [] });
    assert.equal(report.after.threads.resumablePiThreads, 2);
    assert.isTrue(
      NodeFS.existsSync(NodePath.join(userdata, "provider", "pi", "sessions", "other.jsonl")),
    );
    assert.deepStrictEqual(NodeFS.readdirSync(NodePath.dirname(otherHomeSession)), ["other.jsonl"]);
    assert.deepStrictEqual(
      report.tasks.interruptedRuns.map((run) => run.runId),
      ["run-1"],
    );
    assert.deepStrictEqual(report.settings.droppedByV2, [
      "browser",
      "computerUse",
      "enableAssistantStreaming",
    ]);
    // Computer use keeps its V1 restrictions in its own file, which core's saves never touch.
    const computerUsePath = NodePath.join(userdata, "computer-use.json");
    assert.deepStrictEqual(fromJson(NodeFS.readFileSync(computerUsePath, "utf8")), {
      browser: { alwaysUseChrome: true },
      computerUse: restrictedComputerUse,
    });
    assert.include(NodeFS.readFileSync(reportPath, "utf8"), "moved browser, computerUse");
    assert.isTrue(NodeFS.existsSync(reportPath));
    assert.isTrue(NodeFS.existsSync(reportPath.replace(/\.md$/, ".json")));

    // The session file is back where the thread's cursor points, in the new home.
    const recoveredSession = NodePath.join(userdata, "provider", "pi", "sessions", sessionName);
    assert.isTrue(NodeFS.existsSync(recoveredSession));
    assert.isFalse(NodeFS.existsSync(v1SessionFile));
    // All-chats instructions were rewritten in place, keeping the other keys.
    const settingsAfter = fromJson(
      NodeFS.readFileSync(NodePath.join(userdata, "settings.json"), "utf8"),
    );
    assert.equal(settingsAfter.customInstructions, "Start with mcp__t3-code__task_context.");
    assert.equal(settingsAfter.enableAssistantStreaming, true);
    // V1's own database was never written.
    assert.isTrue(NodeFS.readFileSync(v1Path).equals(v1Bytes));
    // The finished cutover is recorded, and only the published database is left.
    assert.equal(readV1CutoverState(userdata)?.status, "completed");
    assert.equal(readV1CutoverState(userdata)?.reportPath, reportPath);
    assert.isFalse(NodeFS.readdirSync(userdata).some((file) => file.includes(".cutover")));

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const up = yield* sql<{ readonly nativeId: string }>`
        SELECT json_extract(provider.payload_json, '$.nativeThreadRef.nativeId') AS "nativeId"
        FROM orchestration_v2_projection_threads AS thread
        JOIN orchestration_v2_projection_provider_threads AS provider
          ON provider.provider_thread_id = thread.active_provider_thread_id
        WHERE thread.thread_id = 'thread-up'
      `;
      assert.equal(up[0]?.nativeId, recoveredSession);
      const reference = yield* sql<{ readonly text: string; readonly threadId: string }>`
        SELECT
          json_extract(payload_json, '$.text') AS "text",
          json_extract(payload_json, '$.context.records[0].threadId') AS "threadId"
        FROM orchestration_v2_projection_messages WHERE message_id = 'm-chat-3'
      `;
      assert.equal(reference[0]?.threadId, "thread-up");
      assert.include(reference[0]?.text ?? "", "[Up chat](t3-context://v1/thread/v1-ctx-1)");
    }).pipe(
      Effect.provide(
        NodeSqliteClient.layer({ filename: NodePath.join(userdata, "statev2.sqlite") }),
      ),
    );

    // A second run refuses: v2's database exists now.
    const again = yield* runV1Cutover({
      homeDir: home,
      featureMigrations: [],
      now: DateTime.makeUnsafe("2026-10-06T09:00:00.000Z"),
      log: () => Effect.void,
    }).pipe(Effect.flip);
    assert.include(again.message, "already exists");

    // The restore script brings V1's files back and keeps v2's database aside.
    NodeFS.writeFileSync(NodePath.join(userdata, "settings.json"), "{}");
    NodeFS.rmSync(NodePath.join(userdata, "secrets"), { recursive: true });
    NodeChildProcess.execFileSync("sh", [NodePath.join(report.backupDir, "restore.sh")]);
    assert.equal(NodeFS.readFileSync(NodePath.join(userdata, "settings.json"), "utf8"), settings);
    assert.equal(NodeFS.readFileSync(NodePath.join(userdata, "secrets", "key"), "utf8"), "secret");
    assert.isFalse(NodeFS.existsSync(NodePath.join(userdata, "statev2.sqlite")));
    assert.isTrue(
      NodeFS.readdirSync(report.backupDir).some((file) =>
        file.startsWith("statev2.sqlite.after-v2-"),
      ),
    );
    // The backup API copies pages, not bytes: compare what V1 reads.
    assert.deepStrictEqual(dumpV1(v1Path), v1Rows);
    assert.isNull(readV1CutoverState(userdata));

    // Updating again moves the restored home once more and keeps the earlier
    // backup, with the v2 database the restore set aside. V1's computer-use
    // settings replace the file the earlier v2 period left.
    NodeFS.writeFileSync(computerUsePath, toJson({ computerUse: { enabled: true } }));
    const second = yield* runV1Cutover({
      homeDir: home,
      v1HomeDir: v1Home,
      featureMigrations: [TASK_MIGRATION_CONTRIBUTION],
      features: [COMPUTER_USE_SERVER_FEATURE],
      now: DateTime.makeUnsafe("2026-10-06T10:00:00.000Z"),
      log: () => Effect.void,
    });
    assert.deepStrictEqual(
      fromJson(NodeFS.readFileSync(computerUsePath, "utf8")).computerUse,
      restrictedComputerUse,
    );
    assert.notEqual(second.report.backupDir, report.backupDir);
    assert.isTrue(
      NodeFS.readdirSync(report.backupDir).some((file) =>
        file.startsWith("statev2.sqlite.after-v2-"),
      ),
    );
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true }))),
  );
});

it.effect("refuses while the app is running", () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-cutover-running-"));
  const userdata = NodePath.join(home, "userdata");
  return Effect.gen(function* () {
    NodeFS.mkdirSync(userdata, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(userdata, "state.sqlite"), "");
    NodeFS.writeFileSync(
      NodePath.join(userdata, "server-runtime.json"),
      toJson({ pid: process.pid }),
    );
    const error = yield* runV1Cutover({
      homeDir: home,
      featureMigrations: [],
      now: DateTime.makeUnsafe("2026-10-06T08:00:00.000Z"),
      log: () => Effect.void,
    }).pipe(Effect.flip);
    assert.include(error.message, "Up.computer is running");
    assert.deepStrictEqual(NodeFS.readdirSync(userdata).toSorted(), [
      "server-runtime.json",
      "state.sqlite",
      "v1-cutover.lock",
    ]);
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true }))),
  );
});

/** A V1 home of the seeded fixture; its Pi session files are missing, which the cutover allows. */
function makeV1Home(prefix: string) {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  const userdata = NodePath.join(home, "userdata");
  const v1Path = NodePath.join(userdata, "state.sqlite");
  NodeFS.mkdirSync(userdata, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(userdata, "environment-id"), "environment-1\n");
  return {
    home,
    userdata,
    v1Path,
    v2Path: NodePath.join(userdata, "statev2.sqlite"),
    seed: seedV1(
      NodePath.join(home, "missing-a.jsonl"),
      NodePath.join(home, "missing-b.jsonl"),
    ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: v1Path }))),
    backups: () =>
      NodeFS.readdirSync(userdata).filter((file) => file.startsWith("v1-cutover-backup-")),
    cleanup: Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
  };
}

const onStart = (
  home: ReturnType<typeof makeV1Home>,
  now: string,
  options: {
    readonly featureMigrations?: Parameters<typeof runV1Cutover>[0]["featureMigrations"];
    readonly log?: (line: string) => Effect.Effect<void>;
  } = {},
) =>
  runV1CutoverOnStart({
    baseDir: home.home,
    dbPath: home.v2Path,
    featureMigrations: options.featureMigrations ?? [TASK_MIGRATION_CONTRIBUTION],
    now: DateTime.makeUnsafe(now),
    log: options.log ?? (() => Effect.void),
  });

it.effect("runs on the first server start on a V1 home, and only then", () => {
  const home = makeV1Home("upcomputer-cutover-start-");
  return Effect.gen(function* () {
    yield* home.seed;
    assert.equal(yield* onStart(home, "2026-10-06T08:00:00.000Z"), "completed");
    assert.isTrue(NodeFS.existsSync(home.v2Path));
    assert.equal(readV1CutoverState(home.userdata)?.status, "completed");

    // A restart finds v2's database and leaves the home alone.
    assert.equal(yield* onStart(home, "2026-10-06T09:00:00.000Z"), "not-needed");
    assert.equal(home.backups().length, 1);
  }).pipe(Effect.provide(NodeServices.layer), Effect.ensuring(home.cleanup));
});

it.effect("a failing check keeps V1 as it was and the server down until a retry", () => {
  const home = makeV1Home("upcomputer-cutover-fail-");
  // A broken step: the copy loses a message, so the message count differs.
  const losesAMessage = {
    ownerId: "test",
    namespace: "test-break",
    migrations: [
      {
        version: 1,
        name: "LoseAMessage",
        run: Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM projection_thread_messages WHERE message_id = 'm-up-1'`;
        }),
      },
    ],
  };
  return Effect.gen(function* () {
    yield* home.seed;
    const v1Rows = dumpV1(home.v1Path);
    const error = yield* onStart(home, "2026-10-06T08:00:00.000Z", {
      featureMigrations: [TASK_MIGRATION_CONTRIBUTION, losesAMessage],
    }).pipe(Effect.flip);
    assert.include(error.message, "1 check(s) differ (messages)");
    assert.include(error.message, "Your V1 data was not changed.");

    const state = readV1CutoverState(home.userdata);
    assert.equal(state?.status, "failed");
    assert.include(error.message, `Report: ${state?.reportPath}`);
    assert.include(error.message, `Backup: ${state?.backupDir}`);
    assert.include(
      NodeFS.readFileSync(state?.reportPath ?? "", "utf8"),
      "| messages | 5 | 4 | NO |",
    );
    // No v2 database, published or half built; V1 reads exactly what it had.
    assert.isFalse(NodeFS.existsSync(home.v2Path));
    assert.isFalse(NodeFS.readdirSync(home.userdata).some((file) => file.includes(".cutover")));
    assert.deepStrictEqual(dumpV1(home.v1Path), v1Rows);

    // The next start reports the same failure without running again.
    const again = yield* onStart(home, "2026-10-06T09:00:00.000Z").pipe(Effect.flip);
    assert.equal(again.message, error.message);
    assert.equal(home.backups().length, 1);

    // A retry by hand (or the desktop's Try Again) runs it afresh.
    const retried = yield* runV1Cutover({
      homeDir: home.home,
      featureMigrations: [TASK_MIGRATION_CONTRIBUTION],
      now: DateTime.makeUnsafe("2026-10-06T10:00:00.000Z"),
      log: () => Effect.void,
    });
    assert.deepStrictEqual(
      retried.report.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(readV1CutoverState(home.userdata)?.status, "completed");
    assert.isTrue(NodeFS.existsSync(home.v2Path));
  }).pipe(Effect.provide(NodeServices.layer), Effect.ensuring(home.cleanup));
});

it.effect("a cutover cut short starts over on the next start", () => {
  const home = makeV1Home("upcomputer-cutover-crash-");
  return Effect.gen(function* () {
    yield* home.seed;
    // The app closes while threads are imported.
    const exit = yield* onStart(home, "2026-10-06T08:00:00.000Z", {
      log: (line) => (line === "Importing thread shells" ? Effect.interrupt : Effect.void),
    }).pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
    const cutShort = readV1CutoverState(home.userdata);
    assert.equal(cutShort?.status, "running");
    assert.deepStrictEqual(cutShort?.owner?.pid, process.pid);
    assert.isTrue(
      NodeFS.existsSync(
        NodePath.join(home.userdata, `statev2.sqlite.cutover-${cutShort?.runId ?? ""}`),
      ),
    );
    assert.isFalse(NodeFS.existsSync(home.v2Path));

    assert.equal(yield* onStart(home, "2026-10-06T08:05:00.000Z"), "completed");
    // The partial backup and staging copy are gone; the new run's backup is the only one.
    assert.deepStrictEqual(home.backups(), ["v1-cutover-backup-20261006T080500Z"]);
    assert.isFalse(NodeFS.existsSync(cutShort?.backupDir ?? ""));
    assert.isFalse(NodeFS.readdirSync(home.userdata).some((file) => file.includes(".cutover")));
    assert.equal(readV1CutoverState(home.userdata)?.status, "completed");
  }).pipe(Effect.provide(NodeServices.layer), Effect.ensuring(home.cleanup));
});

it.effect("leaves homes without UpComputer V1 data to the server", () => {
  const home = makeV1Home("upcomputer-cutover-skip-");
  return Effect.gen(function* () {
    // No V1 database at all.
    assert.equal(yield* onStart(home, "2026-10-06T08:00:00.000Z"), "not-needed");
    // A T3 Code V1 database, which upstream's own import handles.
    yield* runMigrations({ toMigrationInclusive: 32 }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: home.v1Path })),
    );
    assert.equal(yield* onStart(home, "2026-10-06T08:00:00.000Z"), "not-needed");
    assert.deepStrictEqual(home.backups(), []);
    assert.isNull(readV1CutoverState(home.userdata));
  }).pipe(Effect.provide(NodeServices.layer), Effect.ensuring(home.cleanup));
});

it.effect(
  "moves feature settings out of settings.json on every start, before core writes it",
  () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-feature-home-"));
    return Effect.gen(function* () {
      const { settingsPath } = yield* ServerConfig.ServerConfig;
      const computerUsePath = NodePath.join(NodePath.dirname(settingsPath), "computer-use.json");
      // A home the cutover never ran on: no V1 database, V1 sections in settings.json.
      NodeFS.writeFileSync(settingsPath, toJson({ computerUse: restrictedComputerUse }));
      yield* cutoverV1OnServerStart;
      assert.deepStrictEqual(fromJson(NodeFS.readFileSync(computerUsePath, "utf8")), {
        computerUse: restrictedComputerUse,
      });
      // Later starts keep the feature's own file, whatever settings.json says.
      NodeFS.writeFileSync(settingsPath, toJson({ computerUse: { enabled: true } }));
      yield* cutoverV1OnServerStart;
      assert.deepStrictEqual(
        fromJson(NodeFS.readFileSync(computerUsePath, "utf8")).computerUse,
        restrictedComputerUse,
      );
    }).pipe(
      Effect.provide(ServerConfig.layerTest(home, home)),
      Effect.provideService(ServerProduct, PUBLIC_SERVER_PRODUCT),
      Effect.provide(NodeServices.layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true }))),
    );
  },
);

/** Starts a cutover on the home and pauses it while it imports threads. */
const startPaused = (home: ReturnType<typeof makeV1Home>, now: string) =>
  Effect.gen(function* () {
    const paused = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const fiber = yield* onStart(home, now, {
      log: (line) =>
        line === "Importing thread shells"
          ? Deferred.succeed(paused, undefined).pipe(Effect.andThen(Deferred.await(resume)))
          : Effect.void,
    }).pipe(Effect.forkChild);
    yield* Deferred.await(paused);
    return { fiber, resume: Deferred.succeed(resume, undefined) };
  });

it.effect("a second starter is refused while a cutover runs, and leaves its files alone", () => {
  const home = makeV1Home("upcomputer-cutover-concurrent-");
  return Effect.gen(function* () {
    yield* home.seed;
    const first = yield* startPaused(home, "2026-10-06T08:00:00.000Z");
    const running = readV1CutoverState(home.userdata);
    assert.equal(running?.status, "running");
    const staging = NodePath.join(home.userdata, `statev2.sqlite.cutover-${running?.runId ?? ""}`);
    assert.isTrue(NodeFS.existsSync(staging));

    // The server starting again, and the cutover by hand, while the first one runs.
    const onStartError = yield* onStart(home, "2026-10-06T08:01:00.000Z").pipe(Effect.flip);
    const manualError = yield* runV1Cutover({
      homeDir: home.home,
      featureMigrations: [TASK_MIGRATION_CONTRIBUTION],
      now: DateTime.makeUnsafe("2026-10-06T08:02:00.000Z"),
      log: () => Effect.void,
    }).pipe(Effect.flip);
    for (const error of [onStartError, manualError]) {
      assert.include(error.message, "Another V1 data cutover is running on this home");
      assert.include(error.message, `pid ${process.pid}`);
    }
    // Nothing of the first run was touched.
    assert.deepStrictEqual(readV1CutoverState(home.userdata), running);
    assert.isTrue(NodeFS.existsSync(running?.backupDir ?? ""));
    assert.isTrue(NodeFS.existsSync(staging));
    assert.deepStrictEqual(home.backups(), ["v1-cutover-backup-20261006T080000Z"]);

    yield* first.resume;
    assert.equal(yield* Fiber.join(first.fiber), "completed");
    const done = readV1CutoverState(home.userdata);
    assert.equal(done?.status, "completed");
    assert.equal(done?.runId, running?.runId);
    assert.isTrue(NodeFS.existsSync(home.v2Path));
    assert.isTrue(NodeFS.existsSync(running?.backupDir ?? ""));
  }).pipe(Effect.provide(NodeServices.layer), Effect.ensuring(home.cleanup));
});

it.effect("a run records its outcome only over its own state", () => {
  const home = makeV1Home("upcomputer-cutover-own-state-");
  return Effect.gen(function* () {
    yield* home.seed;
    const first = yield* startPaused(home, "2026-10-06T08:00:00.000Z");
    const newer = {
      status: "running",
      runId: "20261006T090000Z-1",
      owner: { pid: 1, startedAt: "2026-10-06T09:00:00.000Z" },
      startedAt: "2026-10-06T09:00:00.000Z",
      backupDir: NodePath.join(home.userdata, "v1-cutover-backup-20261006T090000Z"),
    } as const;
    NodeFS.writeFileSync(NodePath.join(home.userdata, "v1-cutover.json"), toJson(newer));
    yield* first.resume;
    yield* Fiber.join(first.fiber);
    assert.deepStrictEqual(readV1CutoverState(home.userdata), newer);
  }).pipe(Effect.provide(NodeServices.layer), Effect.ensuring(home.cleanup));
});
