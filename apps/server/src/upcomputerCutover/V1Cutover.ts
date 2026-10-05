// @effect-diagnostics nodeBuiltinImport:off - a one-off offline command: backups, session files and a restore script
/**
 * The one-time move of an UpComputer V1 home onto v2, run by `t3 cutover-v1`
 * while the app is closed. v2 keeps its database next to V1's (`statev2.sqlite`
 * beside `state.sqlite`) and never writes the V1 file, so this:
 *
 * 1. backs up `state.sqlite`, the top-level settings files and `secrets/`, and
 *    writes a restore script next to them;
 * 2. copies V1 into `statev2.sqlite` the way the server does on first start;
 * 3. puts back the Pi session files V1 threads resume from, and turns V1's
 *    attached chats into v2 thread references, on the copy only;
 * 4. migrates, imports every thread and transcript, and runs the task step;
 * 5. writes a report with counts before and after.
 *
 * Everything else V1 had (hidden task runs, links, Ask threads) is mapped by
 * the legacy importer, so a plain first start would carry it too.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import {
  ComposerContextId,
  EnvironmentId,
  OrchestrationMessageContext,
  ServerSettings,
  ThreadId,
  type ThreadContextRecord,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import {
  countTaskSystem,
  runTaskV1Cutover,
  type TaskSystemCounts,
  type TaskV1CutoverReport,
} from "@t3tools/tasks-server/cutover";
import {
  AllChatsInstructions,
  TaskPromptSettingsStoreLive,
  TaskRepositoryLive,
} from "@t3tools/tasks-server/persistence";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { initializeV2Database } from "../persistence/initializeV2Database.ts";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import {
  type ExperimentalFeatureMigrationContribution,
  runExperimentalFeatureMigrations,
} from "../product/FeatureMigrations.ts";

export class V1CutoverError extends Schema.TaggedError<V1CutoverError>()("V1CutoverError", {
  message: Schema.String,
}) {}

const fail = (message: string) => Effect.fail(new V1CutoverError({ message }));

/** Settings and runtime files outlive the build reading them: every key is kept as written. */
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const decodeJsonObject = Schema.decodeUnknownSync(fromLenientJson(JsonObject));
const encodeJsonObject = Schema.encodeSync(fromJsonStringPretty(JsonObject));
const encodeReport = Schema.encodeSync(fromJsonStringPretty(Schema.Unknown));
const encodeMessageContext = Schema.encodeSync(Schema.fromJsonString(OrchestrationMessageContext));

function readJsonObject(path: string): Record<string, unknown> {
  return NodeFS.existsSync(path) ? decodeJsonObject(NodeFS.readFileSync(path, "utf8")) : {};
}

export interface V1CutoverInput {
  /** The home whose `userdata` holds V1's `state.sqlite`. */
  readonly homeDir: string;
  /**
   * The home V1's stored paths name, when the data was copied elsewhere (a dry
   * run). Session files are looked up under it and copied into `homeDir`.
   */
  readonly v1HomeDir?: string | undefined;
  readonly featureMigrations: ReadonlyArray<ExperimentalFeatureMigrationContribution<Error>>;
  readonly now: DateTime.Utc;
  readonly log: (line: string) => Effect.Effect<void>;
}

interface V1Counts {
  readonly projects: number;
  readonly liveProjects: number;
  readonly projectsWithLinks: number;
  readonly threads: number;
  readonly liveThreads: number;
  readonly hiddenLiveThreads: number;
  readonly askLiveThreads: number;
  readonly linkedLiveThreads: number;
  readonly messages: number;
  readonly contextBindings: number;
  readonly piSessionThreads: number;
}

interface V2Counts {
  readonly projects: number;
  readonly liveProjects: number;
  readonly projectsWithLinks: number;
  readonly threads: number;
  readonly liveThreads: number;
  readonly hiddenLiveThreads: number;
  readonly askLiveThreads: number;
  readonly linkedLiveThreads: number;
  readonly messages: number;
  readonly threadReferences: number;
  readonly resumablePiThreads: number;
  readonly transcriptsImported: number;
  readonly importErrors: number;
}

export interface V1CutoverReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly homeDir: string;
  readonly backupDir: string;
  readonly restoreCommand: string;
  readonly before: { readonly threads: V1Counts; readonly tasks: TaskSystemCounts };
  readonly after: { readonly threads: V2Counts; readonly tasks: TaskSystemCounts };
  readonly piSessions: {
    readonly inPlace: number;
    readonly recovered: number;
    readonly missing: ReadonlyArray<{ readonly threadId: string; readonly sessionFile: string }>;
  };
  readonly contextBindings: {
    readonly mapped: number;
    /** No message was sent after the chat was attached, so V1 never used it. */
    readonly skipped: number;
    /** User messages that now carry the references. */
    readonly messages: number;
  };
  readonly tasks: TaskV1CutoverReport;
  readonly settings: {
    readonly keys: ReadonlyArray<string>;
    /** Keys v2 does not know; v2 drops them on its next settings save. */
    readonly droppedByV2: ReadonlyArray<string>;
  };
  readonly checks: ReadonlyArray<{
    readonly name: string;
    readonly before: number | string;
    readonly after: number | string;
    readonly ok: boolean;
  }>;
}

const SQLITE_SIDE_FILES = ["-wal", "-shm", "-journal"];

function stamp(date: DateTime.Utc): string {
  return DateTime.formatIso(date)
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Whether V1 or v2 is still running on this home, from the runtime file the server keeps. */
function runningServerPid(userdata: string): number | null {
  const runtimeFile = NodePath.join(userdata, "server-runtime.json");
  if (!NodeFS.existsSync(runtimeFile)) return null;
  let pid: unknown;
  try {
    pid = readJsonObject(runtimeFile).pid;
  } catch {
    return null;
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM" ? pid : null;
  }
}

/** Backs up what v2 may rewrite, and writes the script that puts it back. */
const backUp = Effect.fn("V1Cutover.backUp")(function* (userdata: string, backupDir: string) {
  const v1Path = NodePath.join(userdata, "state.sqlite");
  const files = NodeFS.readdirSync(userdata, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith("state.sqlite") &&
        !entry.name.startsWith("statev2.sqlite"),
    )
    .map((entry) => entry.name)
    .toSorted();
  NodeFS.mkdirSync(NodePath.join(backupDir, "files"), { recursive: true, mode: 0o700 });
  yield* Effect.tryPromise({
    try: async () => {
      const database = new NodeSqlite.DatabaseSync(v1Path, { readOnly: true });
      try {
        await NodeSqlite.backup(database, NodePath.join(backupDir, "state.sqlite"));
      } finally {
        database.close();
      }
    },
    catch: (cause) => new V1CutoverError({ message: `Could not back up ${v1Path}: ${cause}` }),
  });
  for (const file of files) {
    NodeFS.copyFileSync(NodePath.join(userdata, file), NodePath.join(backupDir, "files", file));
  }
  const secrets = NodePath.join(userdata, "secrets");
  const hasSecrets = NodeFS.existsSync(secrets);
  if (hasSecrets) {
    NodeFS.cpSync(secrets, NodePath.join(backupDir, "secrets"), {
      recursive: true,
      preserveTimestamps: true,
    });
  }
  const restore = [
    "#!/bin/sh",
    "# Puts the UpComputer V1 data back as it was before the cutover.",
    "# Quit Up.computer first. The v2 database is kept in this folder, not deleted.",
    "set -eu",
    `U=${shellQuote(userdata)}`,
    `B=${shellQuote(backupDir)}`,
    "STAMP=$(date +%Y%m%dT%H%M%S)",
    "for f in statev2.sqlite statev2.sqlite-wal statev2.sqlite-shm; do",
    '  if [ -e "$U/$f" ]; then mv "$U/$f" "$B/$f.after-v2-$STAMP"; fi',
    "done",
    'rm -f "$U/state.sqlite-wal" "$U/state.sqlite-shm"',
    'cp -p "$B/state.sqlite" "$U/state.sqlite"',
    ...files.map((file) => `cp -p "$B/files/"${shellQuote(file)} "$U/"${shellQuote(file)}`),
    ...(hasSecrets ? ['rm -rf "$U/secrets"', 'cp -Rp "$B/secrets" "$U/secrets"'] : []),
    'echo "Restored the V1 data from $B."',
    "",
  ].join("\n");
  const restorePath = NodePath.join(backupDir, "restore.sh");
  NodeFS.writeFileSync(restorePath, restore, { mode: 0o700 });
  return { restoreCommand: `sh ${shellQuote(restorePath)}`, files, hasSecrets };
});

const countV1 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<V1Counts>`
    SELECT
      (SELECT COUNT(*) FROM projection_projects) AS "projects",
      (SELECT COUNT(*) FROM projection_projects WHERE deleted_at IS NULL) AS "liveProjects",
      (SELECT COUNT(*) FROM projection_projects
        WHERE json_valid(linked_project_ids_json)
          AND json_array_length(linked_project_ids_json) > 0) AS "projectsWithLinks",
      (SELECT COUNT(*) FROM projection_threads) AS "threads",
      (SELECT COUNT(*) FROM projection_threads WHERE deleted_at IS NULL) AS "liveThreads",
      (SELECT COUNT(*) FROM projection_threads
        WHERE deleted_at IS NULL AND sidebar_visible = 0) AS "hiddenLiveThreads",
      (SELECT COUNT(*) FROM projection_threads
        WHERE deleted_at IS NULL AND interaction_mode = 'ask') AS "askLiveThreads",
      (SELECT COUNT(*) FROM projection_threads
        WHERE deleted_at IS NULL AND json_valid(linked_project_ids_json)
          AND json_array_length(linked_project_ids_json) > 0) AS "linkedLiveThreads",
      (SELECT COUNT(*) FROM projection_thread_messages
        WHERE role IN ('user', 'assistant')) AS "messages",
      (SELECT COUNT(*) FROM projection_thread_context_bindings) AS "contextBindings",
      (SELECT COUNT(*) FROM projection_threads AS thread
        JOIN provider_session_runtime AS runtime ON runtime.thread_id = thread.thread_id
        WHERE thread.deleted_at IS NULL
          AND json_valid(thread.model_selection_json)
          AND runtime.provider_instance_id =
            json_extract(thread.model_selection_json, '$.instanceId')
          AND json_valid(runtime.resume_cursor_json)
          AND json_type(runtime.resume_cursor_json, '$.sessionFile') = 'text') AS "piSessionThreads"
  `;
  return rows[0]!;
});

const countV2 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<V2Counts>`
    SELECT
      (SELECT COUNT(*) FROM projection_projects) AS "projects",
      (SELECT COUNT(*) FROM projection_projects WHERE deleted_at IS NULL) AS "liveProjects",
      (SELECT COUNT(*) FROM projection_projects
        WHERE json_valid(linked_project_ids_json)
          AND json_array_length(linked_project_ids_json) > 0) AS "projectsWithLinks",
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads) AS "threads",
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads
        WHERE json_type(payload_json, '$.deletedAt') IS NOT 'text') AS "liveThreads",
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads
        WHERE json_type(payload_json, '$.deletedAt') IS NOT 'text'
          AND json_extract(payload_json, '$.sidebarHidden') = 1) AS "hiddenLiveThreads",
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads
        WHERE json_type(payload_json, '$.deletedAt') IS NOT 'text'
          AND json_extract(payload_json, '$.interactionMode') = 'ask') AS "askLiveThreads",
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads
        WHERE json_type(payload_json, '$.deletedAt') IS NOT 'text'
          AND json_array_length(payload_json, '$.linkedProjectIds') > 0) AS "linkedLiveThreads",
      (SELECT COUNT(*) FROM orchestration_v2_projection_messages) AS "messages",
      (SELECT COUNT(*) FROM orchestration_v2_projection_messages
        WHERE json_extract(payload_json, '$.context.records[0].kind') = 'thread') AS "threadReferences",
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads AS thread
        JOIN orchestration_v2_projection_provider_threads AS provider
          ON provider.provider_thread_id = thread.active_provider_thread_id
        WHERE json_type(thread.payload_json, '$.deletedAt') IS NOT 'text'
          AND json_extract(provider.payload_json, '$.nativeThreadRef.strength') = 'strong'
          AND json_extract(provider.payload_json, '$.lastRunOrdinal') IS NULL) AS "resumablePiThreads",
      (SELECT COUNT(*) FROM orchestration_v2_legacy_imports
        WHERE transcript_imported_at IS NOT NULL) AS "transcriptsImported",
      (SELECT COUNT(*) FROM orchestration_v2_legacy_imports
        WHERE last_error IS NOT NULL) AS "importErrors"
  `;
  return rows[0]!;
});

interface PiSessionCursor {
  readonly threadId: string;
  readonly sessionFile: string;
}

const listPiSessionCursors = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<PiSessionCursor>`
    SELECT
      thread.thread_id AS "threadId",
      json_extract(runtime.resume_cursor_json, '$.sessionFile') AS "sessionFile"
    FROM projection_threads AS thread
    JOIN provider_session_runtime AS runtime ON runtime.thread_id = thread.thread_id
    WHERE thread.deleted_at IS NULL
      AND json_valid(thread.model_selection_json)
      AND runtime.provider_instance_id = json_extract(thread.model_selection_json, '$.instanceId')
      AND json_valid(runtime.resume_cursor_json)
      AND json_type(runtime.resume_cursor_json, '$.sessionFile') = 'text'
    ORDER BY thread.thread_id
  `;
});

/**
 * Where each Pi session file lives for v2. V1 stored absolute paths; a file
 * missing there is looked up by name in the V1 home's `userdata*` folders
 * (earlier backups keep them) and copied back to the path its thread names.
 */
function resolvePiSessions(input: {
  readonly cursors: ReadonlyArray<PiSessionCursor>;
  readonly homeDir: string;
  readonly v1HomeDir: string;
}) {
  const v1Userdata = NodePath.join(input.v1HomeDir, "userdata") + NodePath.sep;
  const searchDirs = NodeFS.existsSync(input.v1HomeDir)
    ? NodeFS.readdirSync(input.v1HomeDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("userdata"))
        .map((entry) => NodePath.join(input.v1HomeDir, entry.name, "provider", "pi", "sessions"))
        .toSorted()
    : [];
  const rewrites: Array<{ readonly threadId: string; readonly sessionFile: string }> = [];
  const missing: Array<PiSessionCursor> = [];
  let inPlace = 0;
  let recovered = 0;
  for (const cursor of input.cursors) {
    const target = cursor.sessionFile.startsWith(v1Userdata)
      ? NodePath.join(input.homeDir, "userdata", cursor.sessionFile.slice(v1Userdata.length))
      : cursor.sessionFile;
    if (target !== cursor.sessionFile) {
      rewrites.push({ threadId: cursor.threadId, sessionFile: target });
    }
    if (NodeFS.existsSync(target)) {
      inPlace += 1;
      continue;
    }
    const source = searchDirs
      .map((directory) => NodePath.join(directory, NodePath.basename(cursor.sessionFile)))
      .find((candidate) => NodeFS.existsSync(candidate));
    if (source === undefined) {
      missing.push(cursor);
      continue;
    }
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.copyFileSync(source, target, NodeFS.constants.COPYFILE_EXCL);
    recovered += 1;
  }
  return { rewrites, inPlace, recovered, missing };
}

/**
 * V1 re-sent an attached chat's snapshot with every turn. v2's form of that is
 * a thread reference on a user message: the chat shows the chip, and agents
 * read the source with t3_thread_read. Each binding goes on the first message
 * sent after it was attached, on the copied V1 rows the importer reads.
 */
const mapContextBindings = Effect.fn("V1Cutover.mapContextBindings")(function* (
  environmentId: EnvironmentId,
) {
  const sql = yield* SqlClient.SqlClient;
  const bindings = yield* sql<{
    readonly bindingId: string;
    readonly threadId: string;
    readonly sourceThreadId: string;
    readonly sourceThreadTitle: string;
    readonly messageId: string | null;
  }>`
    SELECT
      binding.binding_id AS "bindingId",
      binding.thread_id AS "threadId",
      binding.source_thread_id AS "sourceThreadId",
      binding.source_thread_title AS "sourceThreadTitle",
      (
        SELECT message.message_id FROM projection_thread_messages AS message
        WHERE message.thread_id = binding.thread_id
          AND message.role = 'user'
          AND message.created_at >= binding.created_at
        ORDER BY message.created_at ASC, message.message_id ASC
        LIMIT 1
      ) AS "messageId"
    FROM projection_thread_context_bindings AS binding
    ORDER BY binding.created_at ASC, binding.binding_id ASC
  `;
  const byMessage = new Map<string, Array<(typeof bindings)[number]>>();
  for (const binding of bindings) {
    if (binding.messageId === null) continue;
    byMessage.set(binding.messageId, [...(byMessage.get(binding.messageId) ?? []), binding]);
  }
  for (const [messageId, attached] of byMessage) {
    const records = attached.map((binding): ThreadContextRecord => ({
      version: 1,
      kind: "thread",
      contextId: ComposerContextId.make(
        `v1-${binding.bindingId}`.replace(/[^a-z0-9_-]/gi, "-").slice(0, 128),
      ),
      label: binding.sourceThreadTitle.slice(0, 200),
      environmentId,
      threadId: ThreadId.make(binding.sourceThreadId),
      title: binding.sourceThreadTitle.slice(0, 200),
    }));
    const links = records
      .map((record) =>
        formatComposerContextReference({
          kind: "thread",
          contextId: record.contextId,
          label: record.title,
        }),
      )
      .join(" ");
    yield* sql`
      UPDATE projection_thread_messages
      SET
        text = text || ${`\n\n${links}`},
        context_json = ${encodeMessageContext({ version: 1, records })}
      WHERE message_id = ${messageId}
    `;
  }
  const skipped = bindings.filter((binding) => binding.messageId === null).length;
  return { mapped: bindings.length - skipped, skipped, messages: byMessage.size };
});

/** The all-chats text lives in `settings.json`; edits keep every other key as written. */
const settingsFileAllChats = (settingsPath: string) =>
  Layer.succeed(AllChatsInstructions, {
    get: Effect.sync(() => {
      const text = readJsonObject(settingsPath).customInstructions;
      return typeof text === "string" ? text : "";
    }),
    set: (text) =>
      Effect.sync(() => {
        const settings = readJsonObject(settingsPath);
        const temporary = `${settingsPath}.cutover-${process.pid}`;
        NodeFS.writeFileSync(
          temporary,
          `${encodeJsonObject({ ...settings, customInstructions: text })}\n`,
        );
        NodeFS.renameSync(temporary, settingsPath);
      }),
  });

function settingsKeys(settingsPath: string) {
  const settings = readJsonObject(settingsPath);
  const known = new Set(Object.keys(ServerSettings.fields));
  const keys = Object.keys(settings).toSorted();
  return { keys, droppedByV2: keys.filter((key) => !known.has(key)) };
}

export const runV1Cutover = Effect.fn("runV1Cutover")(function* (input: V1CutoverInput) {
  const startedAt = DateTime.formatIso(input.now);
  const homeDir = NodePath.resolve(input.homeDir);
  const v1HomeDir = NodePath.resolve(input.v1HomeDir ?? homeDir);
  const userdata = NodePath.join(homeDir, "userdata");
  const v1Path = NodePath.join(userdata, "state.sqlite");
  const v2Path = NodePath.join(userdata, "statev2.sqlite");
  const settingsPath = NodePath.join(userdata, "settings.json");

  if (!NodeFS.existsSync(v1Path)) return yield* fail(`No V1 database at ${v1Path}.`);
  if (SQLITE_SIDE_FILES.some((suffix) => NodeFS.existsSync(`${v2Path}${suffix}`))) {
    return yield* fail(`${v2Path} is in use or was not closed cleanly.`);
  }
  if (NodeFS.existsSync(v2Path)) {
    return yield* fail(
      `${v2Path} already exists, so v2 has started on this home or the cutover already ran. ` +
        "Move it aside to run the cutover again.",
    );
  }
  const pid = runningServerPid(userdata);
  if (pid !== null) {
    return yield* fail(
      `Up.computer is running (server pid ${pid}). Quit it, then run the cutover again. ` +
        `If it is not running, delete ${NodePath.join(userdata, "server-runtime.json")}.`,
    );
  }
  const ledger = yield* Effect.try({
    try: () => {
      const database = new NodeSqlite.DatabaseSync(v1Path, { readOnly: true });
      try {
        return database
          .prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 33")
          .get() as { name?: string } | undefined;
      } finally {
        database.close();
      }
    },
    catch: (cause) => new V1CutoverError({ message: `Could not read ${v1Path}: ${cause}` }),
  });
  if (ledger?.name !== "ProjectionThreadContext") {
    return yield* fail(`${v1Path} is not an UpComputer V1 database.`);
  }

  const backupDir = NodePath.join(userdata, `v1-cutover-backup-${stamp(input.now)}`);
  yield* input.log(`Backing up V1 data to ${backupDir}`);
  const backup = yield* backUp(userdata, backupDir);
  yield* input.log(`Backup done. To undo the cutover later: ${backup.restoreCommand}`);

  const before = yield* Effect.all({ threads: countV1, tasks: countTaskSystem }).pipe(
    Effect.provide(NodeSqliteClient.layer({ filename: v1Path, readonly: true })),
  );
  const cursors = yield* listPiSessionCursors.pipe(
    Effect.provide(NodeSqliteClient.layer({ filename: v1Path, readonly: true })),
  );

  yield* input.log("Copying the V1 database for v2");
  yield* initializeV2Database(v2Path);

  const piSessions = resolvePiSessions({ cursors, homeDir, v1HomeDir });
  yield* input.log(
    `Pi sessions: ${piSessions.inPlace} in place, ${piSessions.recovered} recovered, ${piSessions.missing.length} missing`,
  );

  const environmentIdPath = NodePath.join(userdata, "environment-id");
  const environmentId = NodeFS.existsSync(environmentIdPath)
    ? EnvironmentId.make(NodeFS.readFileSync(environmentIdPath, "utf8").trim())
    : null;

  const database = makeSqlitePersistenceLive(v2Path);
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(database),
  );
  const importer = LegacyV1ThreadImporter.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(stores, EventSink.layer.pipe(Layer.provide(stores)))),
  );
  const tasks = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
    Layer.provide(settingsFileAllChats(settingsPath)),
    Layer.provideMerge(database),
  );

  const migrated = yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* input.log("Migrated the copy; running feature migrations");
    yield* runExperimentalFeatureMigrations(input.featureMigrations);
    for (const rewrite of piSessions.rewrites) {
      yield* sql`
        UPDATE provider_session_runtime
        SET resume_cursor_json = json_set(resume_cursor_json, '$.sessionFile', ${rewrite.sessionFile})
        WHERE thread_id = ${rewrite.threadId}
      `;
    }
    const contextBindings =
      environmentId === null
        ? { mapped: 0, skipped: 0, messages: 0 }
        : yield* mapContextBindings(environmentId);

    const legacy = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
    yield* input.log("Importing thread shells");
    const shells = yield* legacy.reconcileShells;
    yield* input.log(`Imported ${shells.importedThreadCount} threads; importing transcripts`);
    yield* legacy.importPendingTranscripts;

    yield* input.log("Updating the task system");
    const taskReport = yield* runTaskV1Cutover({ now: startedAt });
    const after = yield* Effect.all({ threads: countV2, tasks: countTaskSystem });
    return { contextBindings, taskReport, after };
  }).pipe(Effect.provide(Layer.mergeAll(importer, tasks)));

  const { after, taskReport, contextBindings } = migrated;
  const rewrittenInstructionCount = taskReport.rewrittenInstructions.length;
  const check = (name: string, beforeValue: number | string, afterValue: number | string) => ({
    name,
    before: beforeValue,
    after: afterValue,
    ok: beforeValue === afterValue,
  });
  const checks = [
    check("projects", before.threads.projects, after.threads.projects),
    check("project links", before.threads.projectsWithLinks, after.threads.projectsWithLinks),
    check("threads", before.threads.threads, after.threads.threads),
    check("live threads", before.threads.liveThreads, after.threads.liveThreads),
    check(
      "hidden task-run threads",
      before.threads.hiddenLiveThreads,
      after.threads.hiddenLiveThreads,
    ),
    check("Ask threads left", 0, after.threads.askLiveThreads),
    check(
      "threads with linked projects",
      before.threads.linkedLiveThreads,
      after.threads.linkedLiveThreads,
    ),
    check("messages", before.threads.messages, after.threads.messages),
    check("transcripts imported", before.threads.threads, after.threads.transcriptsImported),
    check("import errors", 0, after.threads.importErrors),
    check(
      "messages carrying attached chats",
      contextBindings.messages,
      after.threads.threadReferences,
    ),
    check(
      "resumable Pi threads",
      piSessions.inPlace + piSessions.recovered,
      after.threads.resumablePiThreads,
    ),
    check("tasks", before.tasks.tasks, after.tasks.tasks),
    check("task tags", before.tasks.taskTags, after.tasks.taskTags),
    check(
      "task events (+1 per interrupted run)",
      before.tasks.taskEvents + taskReport.interruptedRuns.length,
      after.tasks.taskEvents,
    ),
    check("runs", before.tasks.runs, after.tasks.runs),
    check("runs still active", 0, after.tasks.activeRuns),
    check("agents", before.tasks.agents, after.tasks.agents),
    check("enabled agents", before.tasks.enabledAgents, after.tasks.enabledAgents),
    check("agent triggers", before.tasks.agentTriggers, after.tasks.agentTriggers),
    check("automations", before.tasks.automations, after.tasks.automations),
    check(
      "instruction history (+1 per rewritten field)",
      before.tasks.instructionHistory + rewrittenInstructionCount,
      after.tasks.instructionHistory,
    ),
  ];

  const report = {
    startedAt,
    finishedAt: DateTime.formatIso(yield* DateTime.now),
    homeDir,
    backupDir,
    restoreCommand: backup.restoreCommand,
    before,
    after,
    piSessions: {
      inPlace: piSessions.inPlace,
      recovered: piSessions.recovered,
      missing: piSessions.missing,
    },
    contextBindings,
    tasks: taskReport,
    settings: settingsKeys(settingsPath),
    checks,
  } satisfies V1CutoverReport;
  const reportPath = NodePath.join(userdata, `v1-cutover-report-${stamp(input.now)}.md`);
  NodeFS.writeFileSync(reportPath, formatV1CutoverReport(report));
  NodeFS.writeFileSync(reportPath.replace(/\.md$/, ".json"), `${encodeReport(report)}\n`);
  return { report, reportPath };
});

/** The report as Markdown, written next to the database. */
export function formatV1CutoverReport(report: V1CutoverReport): string {
  const failed = report.checks.filter((entry) => !entry.ok);
  const lines = [
    "# Up.computer V1 to v2 cutover report",
    "",
    `- Home: ${report.homeDir}`,
    `- Started: ${report.startedAt}, finished: ${report.finishedAt}`,
    `- Backup: ${report.backupDir}`,
    `- Undo: quit Up.computer, then run \`${report.restoreCommand}\``,
    `- Result: ${failed.length === 0 ? "all checks passed" : `${failed.length} check(s) differ, see below`}`,
    "",
    "## Checks",
    "",
    "| Check | Before | After | OK |",
    "|---|---|---|---|",
    ...report.checks.map(
      (entry) =>
        `| ${entry.name} | ${entry.name === "agent triggers" ? "digest" : entry.before} | ${
          entry.name === "agent triggers" ? "digest" : entry.after
        } | ${entry.ok ? "yes" : "NO"} |`,
    ),
    "",
    "## Mapped",
    "",
    `- Hidden task-run threads: ${report.after.threads.hiddenLiveThreads} stay out of the sidebar.`,
    `- Ask threads: ${report.before.threads.askLiveThreads} now use Default mode.`,
    `- Linked projects: ${report.after.threads.linkedLiveThreads} threads and ${report.after.threads.projectsWithLinks} projects.`,
    `- Attached chats: ${report.contextBindings.mapped} became thread references; ${report.contextBindings.skipped} were never sent (no message after attaching) and were left out.`,
    `- Pi sessions: ${report.piSessions.inPlace} in place, ${report.piSessions.recovered} copied back from older userdata folders, ${report.piSessions.missing.length} missing (those threads continue from their transcript).`,
    `- In-flight runs interrupted: ${report.tasks.interruptedRuns.map((run) => `${run.runId} (task ${run.taskId})`).join(", ") || "none"}.`,
    ...(report.tasks.leftForRecovery.length > 0
      ? [`- Runs left to v2's recovery: ${report.tasks.leftForRecovery.join(", ")}.`]
      : []),
    `- Agents with V1 tool names rewritten: ${report.tasks.rewrittenAgents.map((agent) => `${agent.name} (${agent.replacements.length})`).join(", ") || "none"}.`,
    `- Instruction fields rewritten: ${report.tasks.rewrittenInstructions.map((change) => `${change.projectId ?? "global"} ${change.field}`).join(", ") || "none"}.`,
    `- Settings keys: ${report.settings.keys.join(", ") || "none"}; unknown to v2 (dropped on its next save): ${report.settings.droppedByV2.join(", ") || "none"}.`,
    "- Theme: mapped by the app on its first start (V1 light, dark or system becomes the Up.computer theme in that mode).",
    "",
    "## Task descriptions that name V1 tools (left as written)",
    "",
    ...(report.tasks.taskDescriptionsNamingV1Tools.length === 0
      ? ["None."]
      : report.tasks.taskDescriptionsNamingV1Tools.map(
          (task) => `- ${task.taskId} "${task.title}": ${task.names.join(", ")}`,
        )),
    "",
    ...(report.piSessions.missing.length === 0
      ? []
      : [
          "## Pi threads without a session file",
          "",
          ...report.piSessions.missing.map((entry) => `- ${entry.threadId}: ${entry.sessionFile}`),
          "",
        ]),
  ];
  return lines.join("\n");
}
