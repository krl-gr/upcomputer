// @effect-diagnostics nodeBuiltinImport:off - a one-off offline command: backups, session files and a restore script
/**
 * The one-time move of an UpComputer V1 home onto v2. The server runs it on
 * its first start on a V1 home, before anything opens the v2 database, and
 * `t3 cutover-v1` runs the same code by hand. v2 keeps its database next to
 * V1's (`statev2.sqlite` beside `state.sqlite`) and never writes the V1 file,
 * so this:
 *
 * 1. backs up `state.sqlite`, the top-level settings files and `secrets/`, and
 *    writes a restore script next to them;
 * 2. copies V1 into a staging file the way the server does on first start;
 * 3. puts back the Pi session files V1 threads resume from, turns V1's
 *    attached chats into v2 thread references and clears V1's settled state,
 *    on the copy only;
 * 4. migrates, imports every thread and transcript, and runs the task step;
 * 5. writes a report with counts before and after, and publishes the copy as
 *    `statev2.sqlite` only when every check passed.
 *
 * Its progress is kept in `v1-cutover.json` (see `@t3tools/shared/upcomputerV1Cutover`):
 * a run that never finished starts over, a failed one is not retried on start.
 * One run at a time holds the home's cutover lock (`v1-cutover.lock`).
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
import { V1_CUTOVER_STATE_FILE, V1CutoverState } from "@t3tools/shared/upcomputerV1Cutover";
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
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
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
import {
  type ExperimentalServerFeatureContribution,
  prepareFeatureHomes,
  ServerProduct,
} from "../product/ServerProduct.ts";

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
const decodeCutoverState = Schema.decodeUnknownSync(fromLenientJson(V1CutoverState));
const encodeCutoverState = Schema.encodeSync(fromJsonStringPretty(V1CutoverState));

function readJsonObject(path: string): Record<string, unknown> {
  return NodeFS.existsSync(path) ? decodeJsonObject(NodeFS.readFileSync(path, "utf8")) : {};
}

/** Replaces a file in one step, so a crash leaves the old or the new text. */
function writeFileAtomic(path: string, text: string) {
  const temporary = `${path}.cutover-${process.pid}`;
  NodeFS.writeFileSync(temporary, text);
  NodeFS.renameSync(temporary, path);
}

export function readV1CutoverState(userdata: string): V1CutoverState | null {
  const path = NodePath.join(userdata, V1_CUTOVER_STATE_FILE);
  if (!NodeFS.existsSync(path)) return null;
  try {
    return decodeCutoverState(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeV1CutoverState(userdata: string, state: V1CutoverState) {
  writeFileAtomic(NodePath.join(userdata, V1_CUTOVER_STATE_FILE), `${encodeCutoverState(state)}\n`);
}

/** Records a run's outcome unless the state file names another run, so an older run never overwrites a newer one's. */
function writeOwnV1CutoverState(userdata: string, state: V1CutoverState & { runId: string }) {
  const current = readV1CutoverState(userdata);
  if (current !== null && current.runId !== state.runId) return false;
  writeV1CutoverState(userdata, state);
  return true;
}

/** What the person sees when a cutover stopped: the reason, and that nothing was lost. */
export function describeFailedV1Cutover(state: V1CutoverState): string {
  return [
    `Up.computer could not move your V1 data to the new version: ${state.message ?? "unknown error"}.`,
    "Your V1 data was not changed.",
    ...(state.reportPath === undefined ? [] : [`Report: ${state.reportPath}`]),
    `Backup: ${state.backupDir}`,
  ].join(" ");
}

/** A V1 database whose migration ledger has V1's own entry 33. */
function isUpcomputerV1Database(v1Path: string) {
  return Effect.try({
    try: () => {
      const database = new NodeSqlite.DatabaseSync(v1Path, { readOnly: true });
      try {
        const ledger = database
          .prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 33")
          .get() as { name?: string } | undefined;
        return ledger?.name === "ProjectionThreadContext";
      } finally {
        database.close();
      }
    },
    catch: (cause) => new V1CutoverError({ message: `Could not read ${v1Path}: ${cause}` }),
  });
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
  /** Features whose `prepareHome` moves their V1 files once the database is published. */
  readonly features?: ReadonlyArray<
    Pick<ExperimentalServerFeatureContribution, "id" | "prepareHome">
  >;
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
  readonly settledLiveThreads: number;
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
  readonly settledLiveThreads: number;
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
/**
 * The v2 database while a run builds it, `statev2.sqlite.cutover-<run id>`;
 * it becomes `statev2.sqlite` once every check passed.
 */
const STAGING_PREFIX = "statev2.sqlite.cutover";
const BACKUP_PREFIX = "v1-cutover-backup-";
const LOCK_NAME = "v1-cutover.lock";

function removeStaging(stagingPath: string) {
  for (const suffix of ["", ...SQLITE_SIDE_FILES]) {
    NodeFS.rmSync(`${stagingPath}${suffix}`, { force: true });
  }
}

/** Staging files of runs that died; only called under the lock, so none is live. */
function removeAbandonedStaging(userdata: string) {
  for (const name of NodeFS.readdirSync(userdata)) {
    if (name.startsWith(STAGING_PREFIX))
      NodeFS.rmSync(NodePath.join(userdata, name), { force: true });
  }
}

/** This process, as the owner a running state names. */
const currentOwner = Effect.map(DateTime.now, (now) => ({
  pid: process.pid,
  startedAt: DateTime.formatIso(
    DateTime.makeUnsafe(DateTime.toEpochMillis(now) - Math.round(process.uptime() * 1000)),
  ),
}));

/**
 * Runs the effect holding the home's cutover lock. It is SQLite's exclusive
 * lock on `v1-cutover.lock`, an OS file lock: a second starter, in another
 * process or this one, is refused, and the lock goes away with a process that
 * dies. A `running` state found under the lock therefore belongs to a dead run.
 */
function withCutoverLock<A, E, R>(userdata: string, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        const lock = new NodeSqlite.DatabaseSync(NodePath.join(userdata, LOCK_NAME));
        try {
          lock.exec("PRAGMA journal_mode = OFF; BEGIN EXCLUSIVE");
        } catch (cause) {
          lock.close();
          throw cause;
        }
        return lock;
      },
      catch: (cause) => {
        if ((cause as { errcode?: unknown }).errcode !== 5) {
          return new V1CutoverError({ message: `Could not lock ${userdata}: ${cause}` });
        }
        const owner = readV1CutoverState(userdata)?.owner;
        return new V1CutoverError({
          message:
            "Another V1 data cutover is running on this home" +
            (owner === undefined ? "" : ` (pid ${owner.pid}, started ${owner.startedAt})`) +
            ". Wait for it to finish, then start Up.computer again.",
        });
      },
    }),
    () => effect,
    (lock) => Effect.sync(() => lock.close()),
  );
}

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
        !entry.name.startsWith("statev2.sqlite") &&
        // The cutover's own state and reports describe this run, not V1's data.
        !entry.name.startsWith("v1-cutover"),
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
    'rm -f "$U/state.sqlite-wal" "$U/state.sqlite-shm" "$U/v1-cutover.json"',
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
      (SELECT COUNT(*) FROM projection_threads
        WHERE deleted_at IS NULL
          AND (settled_override IS NOT NULL OR settled_at IS NOT NULL)) AS "settledLiveThreads",
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
      (SELECT COUNT(*) FROM orchestration_v2_projection_threads
        WHERE json_type(payload_json, '$.deletedAt') IS NOT 'text'
          AND (json_type(payload_json, '$.settledOverride') = 'text'
            OR json_type(payload_json, '$.settledAt') = 'text')) AS "settledLiveThreads",
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
 * A path outside V1's userdata (another home) is copied into this home's
 * sessions folder, so the moved home never depends on, or writes to, another.
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
  const sessionsDir = NodePath.join(input.homeDir, "userdata", "provider", "pi", "sessions");
  for (const cursor of input.cursors) {
    // Files only ever land inside the home being moved: a path under V1's
    // userdata keeps its place there, any other (another home) goes to its sessions folder.
    const target = cursor.sessionFile.startsWith(v1Userdata)
      ? NodePath.join(input.homeDir, "userdata", cursor.sessionFile.slice(v1Userdata.length))
      : NodePath.join(sessionsDir, NodePath.basename(cursor.sessionFile));
    if (target !== cursor.sessionFile) {
      rewrites.push({ threadId: cursor.threadId, sessionFile: target });
    }
    if (NodeFS.existsSync(target)) {
      inPlace += 1;
      continue;
    }
    const source = [
      cursor.sessionFile,
      ...searchDirs.map((directory) =>
        NodePath.join(directory, NodePath.basename(cursor.sessionFile)),
      ),
    ].find((candidate) => NodeFS.existsSync(candidate));
    if (source === undefined) {
      missing.push(cursor);
      continue;
    }
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    // Through a temporary name, so a run cut short never leaves half a session in place.
    NodeFS.copyFileSync(source, `${target}.cutover`);
    NodeFS.renameSync(`${target}.cutover`, target);
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

/**
 * Up.computer hides upstream's settled-thread lifecycle, but some server
 * queries still skip settled threads, so V1's settled state is dropped on the
 * copied rows the importer reads.
 */
const clearSettledState = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_threads
    SET settled_override = NULL, settled_at = NULL
    WHERE settled_override IS NOT NULL OR settled_at IS NOT NULL
  `;
});

/**
 * The all-chats text lives in `settings.json`. A rewrite is held until the
 * cutover publishes the v2 database, then written keeping every other key.
 */
function settingsFileAllChats(settingsPath: string) {
  let pending: string | undefined;
  return {
    layer: Layer.succeed(AllChatsInstructions, {
      get: Effect.sync(() => {
        if (pending !== undefined) return pending;
        const text = readJsonObject(settingsPath).customInstructions;
        return typeof text === "string" ? text : "";
      }),
      set: (text) =>
        Effect.sync(() => {
          pending = text;
        }),
    }),
    write: () => {
      if (pending === undefined) return;
      const settings = readJsonObject(settingsPath);
      writeFileAtomic(
        settingsPath,
        `${encodeJsonObject({ ...settings, customInstructions: pending })}\n`,
      );
    },
  };
}

function settingsKeys(settingsPath: string) {
  const settings = readJsonObject(settingsPath);
  const known = new Set(Object.keys(ServerSettings.fields));
  const keys = Object.keys(settings).toSorted();
  return { keys, droppedByV2: keys.filter((key) => !known.has(key)) };
}

/** The cutover by hand (`t3 cutover-v1`), or a retry after a failed one. */
export const runV1Cutover = Effect.fn("runV1Cutover")(function* (input: V1CutoverInput) {
  const userdata = NodePath.join(NodePath.resolve(input.homeDir), "userdata");
  const v1Path = NodePath.join(userdata, "state.sqlite");
  if (!NodeFS.existsSync(v1Path)) return yield* fail(`No V1 database at ${v1Path}.`);
  return yield* withCutoverLock(userdata, cutoverHoldingLock(input));
});

/** The cutover itself; the caller holds the home's cutover lock. */
const cutoverHoldingLock = Effect.fn("V1Cutover.cutoverHoldingLock")(function* (
  input: V1CutoverInput,
) {
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
  if (!(yield* isUpcomputerV1Database(v1Path))) {
    return yield* fail(`${v1Path} is not an UpComputer V1 database.`);
  }

  // A run that never finished (the app was closed or crashed) changed nothing
  // V1 reads, so its partial backup and staging copy go and it starts over.
  // Its owner is dead: a live one would still hold the lock this run holds.
  // A folder the restore script kept a v2 database in is never removed.
  const previous = readV1CutoverState(userdata);
  if (
    previous?.status === "running" &&
    NodePath.dirname(previous.backupDir) === userdata &&
    NodePath.basename(previous.backupDir).startsWith(BACKUP_PREFIX) &&
    NodeFS.existsSync(previous.backupDir) &&
    !NodeFS.readdirSync(previous.backupDir).some((name) => name.startsWith("statev2.sqlite"))
  ) {
    yield* input.log(
      `Removing the backup of a cutover that did not finish` +
        `${previous.owner === undefined ? "" : ` (pid ${previous.owner.pid})`}: ${previous.backupDir}`,
    );
    NodeFS.rmSync(previous.backupDir, { recursive: true, force: true });
  }
  removeAbandonedStaging(userdata);

  const runId = `${stamp(input.now)}-${process.pid}`;
  const stagingPath = NodePath.join(userdata, `${STAGING_PREFIX}-${runId}`);
  const backupDir = NodePath.join(userdata, `${BACKUP_PREFIX}${stamp(input.now)}`);
  const reportPath = NodePath.join(userdata, `v1-cutover-report-${stamp(input.now)}.md`);
  writeV1CutoverState(userdata, {
    status: "running",
    runId,
    owner: yield* currentOwner,
    startedAt,
    backupDir,
  });
  const allChats = settingsFileAllChats(settingsPath);

  const attempt = Effect.gen(function* () {
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
    yield* initializeV2Database(stagingPath);

    const piSessions = resolvePiSessions({ cursors, homeDir, v1HomeDir });
    yield* input.log(
      `Pi sessions: ${piSessions.inPlace} in place, ${piSessions.recovered} recovered, ${piSessions.missing.length} missing`,
    );

    const environmentIdPath = NodePath.join(userdata, "environment-id");
    const environmentId = NodeFS.existsSync(environmentIdPath)
      ? EnvironmentId.make(NodeFS.readFileSync(environmentIdPath, "utf8").trim())
      : null;

    const database = makeSqlitePersistenceLive(stagingPath);
    const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
      Layer.provideMerge(database),
    );
    const importer = LegacyV1ThreadImporter.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(stores, EventSink.layer.pipe(Layer.provide(stores)))),
    );
    const tasks = Layer.mergeAll(TaskRepositoryLive, TaskPromptSettingsStoreLive).pipe(
      Layer.provide(allChats.layer),
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
      yield* clearSettledState;

      const legacy = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      yield* input.log("Importing thread shells");
      const shells = yield* legacy.reconcileShells;
      yield* input.log(`Imported ${shells.importedThreadCount} threads; importing transcripts`);
      yield* legacy.importPendingTranscripts;

      yield* input.log("Updating the task system");
      const taskReport = yield* runTaskV1Cutover({ now: startedAt });
      const after = yield* Effect.all({ threads: countV2, tasks: countTaskSystem });
      // Publishing renames one file, so fold the write-ahead log into it first.
      yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
      const journal = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode = DELETE`;
      if (journal[0]?.journal_mode !== "delete") {
        return yield* fail(`Could not close ${stagingPath} into one file.`);
      }
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
      check("settled threads left", 0, after.threads.settledLiveThreads),
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
    NodeFS.writeFileSync(reportPath, formatV1CutoverReport(report));
    NodeFS.writeFileSync(reportPath.replace(/\.md$/, ".json"), `${encodeReport(report)}\n`);

    const failed = checks.filter((entry) => !entry.ok);
    if (failed.length > 0) {
      return yield* fail(
        `${failed.length} check(s) differ (${failed.map((entry) => entry.name).join(", ")})`,
      );
    }
    // The only step V1 data cannot come back from without the restore script.
    NodeFS.linkSync(stagingPath, v2Path);
    removeStaging(stagingPath);
    return report;
  });

  const report = yield* attempt.pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        // Closing the app mid-run is not a failure: the next start begins again.
        if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause);
        const error = Cause.squash(cause);
        const message = error instanceof Error ? error.message : String(error);
        removeStaging(stagingPath);
        if (!NodeFS.existsSync(reportPath)) {
          NodeFS.writeFileSync(
            reportPath,
            formatFailedV1Cutover({ homeDir, startedAt, backupDir, message }),
          );
        }
        const state: V1CutoverState & { runId: string } = {
          status: "failed",
          runId,
          startedAt,
          finishedAt: DateTime.formatIso(yield* DateTime.now),
          backupDir,
          reportPath,
          message,
        };
        writeOwnV1CutoverState(userdata, state);
        return yield* fail(describeFailedV1Cutover(state));
      }),
    ),
  );

  // The database is published: a failure here is reported, not undone.
  yield* Effect.try({
    try: allChats.write,
    catch: (cause) =>
      new V1CutoverError({
        message: `Could not update the all-chats instructions in ${settingsPath}: ${cause}`,
      }),
  }).pipe(Effect.catch((error) => input.log(error.message)));
  // Feature settings kept in V1's settings.json, such as computer-use
  // restrictions, move to their own files before v2's first settings save
  // could drop them. The next start retries a failure.
  yield* prepareFeatureHomes(input.features ?? [], { settingsPath, fromV1Cutover: true }).pipe(
    Effect.flatMap((lines) =>
      Effect.gen(function* () {
        for (const line of lines) yield* input.log(`Feature settings: ${line}`);
        if (lines.length > 0) {
          NodeFS.appendFileSync(
            reportPath,
            ["## Feature settings", "", ...lines.map((line) => `- ${line}`), ""].join("\n"),
          );
        }
      }),
    ),
    Effect.catch((error) => input.log(`Could not move feature settings: ${error.message}`)),
  );
  writeOwnV1CutoverState(userdata, {
    status: "completed",
    runId,
    startedAt,
    finishedAt: report.finishedAt,
    backupDir,
    restoreCommand: report.restoreCommand,
    reportPath,
  });
  return { report, reportPath };
});

/**
 * Runs the cutover on server start when the home holds UpComputer V1 data and
 * no v2 database yet. A failed cutover is not retried here: the server stays
 * down with the reason until the person retries (the desktop offers it, or
 * `t3 cutover-v1`).
 */
export const runV1CutoverOnStart = Effect.fn("runV1CutoverOnStart")(function* (
  input: Omit<V1CutoverInput, "homeDir" | "v1HomeDir"> & {
    readonly baseDir: string;
    readonly dbPath: string;
  },
) {
  const homeDir = NodePath.resolve(input.baseDir);
  const userdata = NodePath.join(homeDir, "userdata");
  const v1Path = NodePath.join(userdata, "state.sqlite");
  const v2Path = NodePath.join(userdata, "statev2.sqlite");
  if (
    NodePath.resolve(input.dbPath) !== v2Path ||
    NodeFS.existsSync(v2Path) ||
    !NodeFS.existsSync(v1Path) ||
    !(yield* isUpcomputerV1Database(v1Path))
  ) {
    return "not-needed" as const;
  }
  return yield* withCutoverLock(
    userdata,
    Effect.gen(function* () {
      const state = readV1CutoverState(userdata);
      if (state?.status === "failed") return yield* fail(describeFailedV1Cutover(state));
      // Another starter may have published it between the checks above and the lock.
      if (NodeFS.existsSync(v2Path)) return "not-needed" as const;
      yield* input.log("This home holds UpComputer V1 data; moving it to v2");
      const { reportPath } = yield* cutoverHoldingLock({ ...input, homeDir });
      yield* input.log(`Done. Report: ${reportPath}`);
      return "completed" as const;
    }),
  );
});

/**
 * The server's first step: nothing may open the v2 database before this, and
 * nothing may write `settings.json` before features moved their files out of it.
 */
export const cutoverV1OnServerStart = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const product = yield* ServerProduct;
  yield* runV1CutoverOnStart({
    baseDir: config.baseDir,
    dbPath: config.dbPath,
    featureMigrations: product.features.flatMap((feature) => feature.migrations ?? []),
    features: product.features,
    now: yield* DateTime.now,
    log: (line) => Effect.logInfo(`V1 data cutover: ${line}`),
  }).pipe(Effect.tapError((error) => Effect.logError(error.message)));
  // Also for homes the cutover never ran on; a no-op once the files moved.
  const lines = yield* prepareFeatureHomes(product.features, {
    settingsPath: config.settingsPath,
    fromV1Cutover: false,
  }).pipe(
    Effect.mapError(
      (error) =>
        new V1CutoverError({ message: `Could not move feature settings: ${error.message}` }),
    ),
    Effect.tapError((error) => Effect.logError(error.message)),
  );
  for (const line of lines) yield* Effect.logInfo(`Feature settings: ${line}`);
});

function formatFailedV1Cutover(input: {
  readonly homeDir: string;
  readonly startedAt: string;
  readonly backupDir: string;
  readonly message: string;
}): string {
  return [
    "# Up.computer V1 to v2 cutover report",
    "",
    `- Home: ${input.homeDir}`,
    `- Started: ${input.startedAt}`,
    `- Backup: ${input.backupDir}`,
    `- Result: stopped before the checks: ${input.message}`,
    "",
    "The v2 database was not created and the V1 data was not changed.",
    "",
  ].join("\n");
}

/** The report as Markdown, written next to the database. */
export function formatV1CutoverReport(report: V1CutoverReport): string {
  const failed = report.checks.filter((entry) => !entry.ok);
  const lines = [
    "# Up.computer V1 to v2 cutover report",
    "",
    `- Home: ${report.homeDir}`,
    `- Started: ${report.startedAt}, finished: ${report.finishedAt}`,
    `- Backup: ${report.backupDir}`,
    ...(failed.length === 0
      ? [
          `- Undo: quit Up.computer, then run \`${report.restoreCommand}\``,
          "- Result: all checks passed",
        ]
      : [
          `- Result: ${failed.length} check(s) differ, see below. The v2 database was not created and the V1 data was not changed.`,
        ]),
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
    `- Settled threads: ${report.before.threads.settledLiveThreads} are ordinary threads again (Up.computer has no Settled section).`,
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
