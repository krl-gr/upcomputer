import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskId, TaskRank, TaskScheduleEntryId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach } from "vite-plus/test";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
} from "../../../../apps/server/src/extensionApi.ts";
import { ProjectService } from "../../../../apps/server/src/project/ProjectService.ts";
import { InboxProject, InboxProjectLive } from "../inbox/InboxProject.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { importWande } from "./WandeImport.ts";
import { folderNameForTitle, type WandeSnapshotTables } from "./wandePlan.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

interface FakeProject {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

const ME = "me-1";
const OTHER = "other-1";
const DAY = Date.UTC(2026, 0, 1);
const jsonl = (rows: ReadonlyArray<object>) => rows.map((row) => JSON.stringify(row)).join("\n");

/**
 * A small snapshot: the user's projects cover each mapping rule, and another
 * user's rows reuse the same project ids, titles and dates.
 */
function snapshot(): WandeSnapshotTables {
  const project = (id: string, title: string, extra: object = {}) => ({
    _id: id,
    _creationTime: DAY,
    title,
    order_num: 1,
    color: "#000",
    user_id: ME,
    ...extra,
  });
  const entity = (id: string, title: string, projectId: string | null, extra: object = {}) => ({
    _id: id,
    _creationTime: DAY + 1000,
    title,
    order: 1,
    status: "new",
    project_id: projectId,
    user_id: ME,
    ...extra,
  });
  const instance = (id: string, entityId: string, title: string, extra: object = {}) => ({
    _id: id,
    _creationTime: DAY,
    date: "2026-01-02",
    entity_id: entityId,
    entity_type: "task",
    instance_id: `i-${id}`,
    order: 1,
    queue_id: "q",
    reminder_pending: false,
    status: "new",
    title,
    updated_at: DAY + 5000,
    user_id: ME,
    ...extra,
  });
  return {
    users: jsonl([
      { _id: ME, _creationTime: DAY, email: "Me@Example.com", name: "me" },
      { _id: OTHER, _creationTime: DAY, email: "other@example.com", name: "other" },
    ]),
    projects: jsonl([
      project("p-alpha", "Alpha"),
      project("p-beta", "beta", { order_num: 2 }),
      project("p-gamma", "Gamma", { order_num: 3 }),
      project("p-gamma-old", "Gamma - Old", { status: "archive", order_num: 0 }),
      project("p-empty", "Empty", { order_num: 4 }),
      { ...project("p-secret", "Secret project"), user_id: OTHER },
    ]),
    tasks: jsonl([
      entity("t-alpha-one", "Alpha one", "p-alpha", { order: 2, content: "# notes" }),
      entity("t-alpha-two", "Alpha two", "p-alpha", { order: 1, status: "done" }),
      entity("t-beta", "Beta task", "p-beta", { status: "archive" }),
      entity("t-gamma", "Gamma task", "p-gamma"),
      entity("t-gamma-old", "Old gamma task", "p-gamma-old", { status: "done" }),
      entity("t-inbox", "Loose task", null, { order: 0.5 }),
      entity("t-lost", "Lost project task", "p-deleted", { order: 3 }),
      entity("t-dup-1", "Dup", null, { order: 4 }),
      entity("t-dup-2", " dup ", null, { order: 5 }),
      { ...entity("t-secret", "Secret task", "p-alpha"), user_id: OTHER },
    ]),
    routines: jsonl([
      entity("r-gym", "Gym", "p-gamma"),
      entity("r-old", "Old routine", null, { status: "archive" }),
      { ...entity("r-secret", "Secret routine", null), user_id: OTHER },
    ]),
    queueInstances: jsonl([
      instance("q-one", "t-alpha-one", "Alpha one", {
        order: 2,
        start_time: "09:30:00",
        duration: 45,
      }),
      instance("q-two", "t-alpha-two", "Alpha two", { status: "done" }),
      instance("q-gym", "r-gym", "Gym", { entity_type: "routine", status: "archived" }),
      instance("q-future", "r-gym", "Gym", {
        entity_type: "routine",
        date: "2099-01-01",
        start_time: "10:00",
      }),
      // Old history: the entity ids are gone, the titles remain.
      instance("q-old-match", "0000-uuid-1", "  ALPHA ONE ", { date: "2025-12-14" }),
      instance("q-old-dup", "0000-uuid-2", "dup", { date: "2025-12-14", order: 2 }),
      instance("q-old-none", "0000-uuid-3", "Nothing like it", { date: "2025-12-14", order: 3 }),
      instance("q-old-kind", "0000-uuid-4", "Alpha one", {
        date: "2025-12-14",
        order: 4,
        entity_type: "routine",
      }),
      { ...instance("q-secret", "t-secret", "Secret task"), user_id: OTHER },
    ]),
  };
}

/** Core projects as the import sees them, an existing task and entry, and a projects folder. */
function harness() {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wande-import-"));
  directories.push(home);
  const projectsDir = NodePath.join(home, "Projects");
  const projects: FakeProject[] = [
    {
      id: ProjectId.make("existing-alpha"),
      title: "Alpha app",
      workspaceRoot: NodePath.join(projectsDir, "Alpha"),
    },
    { id: ProjectId.make("existing-beta"), title: "Beta", workspaceRoot: "/elsewhere/beta" },
  ];
  let bootstraps = 0;
  const core = Layer.mergeAll(
    Layer.succeed(ServerConfig, { baseDir: home } as never),
    Layer.succeed(ProjectService, {
      bootstrap: (input: { projectId: ProjectId; title: string; workspaceRoot: string }) =>
        Effect.sync(() => {
          bootstraps += 1;
          const existing = projects.find(
            (project) => project.workspaceRoot === input.workspaceRoot,
          );
          if (existing) return { project: existing, created: false };
          const project = { ...input, id: input.projectId };
          projects.push(project);
          return { project, created: true };
        }),
    } as never),
    Layer.succeed(ProjectStoreV2, {
      list: () =>
        Effect.sync(() =>
          projects.map(({ id, ...project }) => ({ ...project, projectId: id, deletedAt: null })),
        ),
      getShell: (id: ProjectId) =>
        Effect.sync(() => Option.fromUndefinedOr(projects.find((project) => project.id === id))),
    } as never),
  );
  const storage = TaskRepositoryLive.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  );
  const layer = InboxProjectLive.pipe(
    Layer.provideMerge(Layer.mergeAll(storage, core, NodeServices.layer)),
  );
  const mapping = new Map([["gamma - old", NodePath.join(projectsDir, "Gamma")]]);
  const run = (dryRun: boolean, email = "me@example.com") =>
    importWande({
      tables: snapshot(),
      email,
      rootFor: (title) =>
        mapping.get(title.toLowerCase()) ?? NodePath.join(projectsDir, folderNameForTitle(title)),
      dryRun,
    });
  /** One task and one entry from before the import. */
  const seed = Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const at = "2026-01-01T00:00:00.000Z";
    yield* repository.upsert({
      id: TaskId.make("task-existing"),
      projectId: ProjectId.make("existing-alpha"),
      title: "existing",
      description: "",
      output: null,
      status: "To Do",
      priority: null,
      createdBy: "user",
      assigneeAgentRunId: null,
      sourceThreadId: null,
      sourceRunId: null,
      metadata: null,
      tags: [],
      createdAt: at,
      updatedAt: at,
      audience: "person",
    });
    yield* repository.putScheduleEntries([
      {
        id: TaskScheduleEntryId.make("entry-existing"),
        taskId: TaskId.make("task-existing"),
        date: "2026-01-02",
        position: TaskRank.make("0000000100000000"),
        startTime: null,
        durationMinutes: null,
        status: "open",
        createdAt: at,
        updatedAt: at,
      },
    ]);
  });
  return { projectsDir, projects, bootstraps: () => bootstraps, layer, run, seed };
}

const importedTasks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    id: string;
    projectId: string;
    title: string;
    description: string;
    status: string;
    archived: number;
    audience: string;
    kind: string;
    createdAt: string;
    wandeId: string | null;
    wandeProjectId: string | null;
  }>`SELECT id, project_id AS "projectId", title, description, status,
      archived_at IS NOT NULL AS archived, audience, kind, created_at AS "createdAt",
      json_extract(metadata_json, '$.wandeId') AS "wandeId",
      json_extract(metadata_json, '$.wandeProjectId') AS "wandeProjectId"
    FROM tasks ORDER BY rank`;
});

const entries = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    id: string;
    taskId: string;
    date: string;
    startTime: string | null;
    durationMinutes: number | null;
    status: string;
    remindAt: string | null;
  }>`SELECT id, task_id AS "taskId", date, start_time AS "startTime",
      duration_minutes AS "durationMinutes", status, remind_at AS "remindAt"
    FROM task_schedule_entries ORDER BY date, position`;
});

// Live clock: whether an imported entry gets a reminder depends on today's date.
it.live("a dry run plans every mapping rule and writes nothing", () => {
  const { projectsDir, projects, bootstraps, layer, run, seed } = harness();
  return Effect.gen(function* () {
    yield* seed;
    const report = yield* run(true);

    const summary = report.groups.map((group) => ({
      target:
        group.target.type === "inbox"
          ? "inbox"
          : group.target.type === "existing"
            ? `${group.target.projectId} by ${group.target.matchedBy}`
            : `create ${group.target.title} at ${NodePath.relative(projectsDir, group.target.workspaceRoot)}`,
      wandeProjects: group.wandeProjects,
      tasks: group.tasks,
      routines: group.routines,
    }));
    const none = { todo: 0, done: 0, archived: 0 };
    assert.deepStrictEqual(summary, [
      {
        target: "existing-alpha by root",
        wandeProjects: ["Alpha"],
        tasks: { todo: 1, done: 1, archived: 0 },
        routines: none,
      },
      {
        target: "existing-beta by title",
        wandeProjects: ["beta"],
        tasks: { todo: 0, done: 0, archived: 1 },
        routines: none,
      },
      {
        // The archived project shares the folder, so it merges into the active one.
        target: "create Gamma at Gamma",
        wandeProjects: ["Gamma", "Gamma - Old"],
        tasks: { todo: 1, done: 1, archived: 0 },
        routines: { todo: 1, done: 0, archived: 0 },
      },
      {
        target: "inbox",
        wandeProjects: [],
        tasks: { todo: 4, done: 0, archived: 0 },
        routines: { todo: 0, done: 0, archived: 1 },
      },
    ]);
    assert.deepStrictEqual(report.skippedProjects, ["Empty"]);
    assert.equal(report.unknownProjectItems, 1);
    assert.deepStrictEqual(report.tasks, { planned: 9, existing: 0, added: 0 });
    assert.deepStrictEqual(report.routines, { planned: 2, existing: 0, added: 0 });
    assert.deepStrictEqual(report.history, { matched: 1, ambiguous: 1, none: 2 });
    assert.deepStrictEqual(report.entries.byStatus, { open: 3, done: 1, skipped: 1 });

    // Nothing written: only the seeded task and entry, no project, no folder.
    assert.deepStrictEqual(
      (yield* importedTasks).map(({ id }) => id),
      ["task-existing"],
    );
    assert.equal((yield* entries).length, 1);
    assert.equal(bootstraps(), 0);
    assert.equal(projects.length, 2);
    assert.isFalse(NodeFS.existsSync(NodePath.join(projectsDir, "Gamma")));
  }).pipe(Effect.provide(layer));
});

it.live("the import maps projects, statuses, order and entries, for one user only", () => {
  const { projectsDir, projects, layer, run, seed } = harness();
  return Effect.gen(function* () {
    yield* seed;
    const report = yield* run(false);
    assert.deepStrictEqual(report.tasks, { planned: 9, existing: 0, added: 9 });
    assert.deepStrictEqual(report.routines, { planned: 2, existing: 0, added: 2 });
    assert.equal(report.projectsCreated, 1);

    const gamma = projects.find(({ title }) => title === "Gamma")!;
    assert.equal(gamma.workspaceRoot, NodePath.join(projectsDir, "Gamma"));
    assert.ok(NodeFS.statSync(gamma.workspaceRoot).isDirectory());
    const inbox = yield* (yield* InboxProject).ensure;

    const tasks = yield* importedTasks;
    // Imported after the existing task, tasks by wande order, then routines.
    assert.deepStrictEqual(
      tasks.map(({ title }) => title),
      [
        "existing",
        "Loose task",
        "Alpha two",
        "Beta task",
        "Gamma task",
        "Old gamma task",
        "Alpha one",
        "Lost project task",
        "Dup",
        "dup",
        "Gym",
        "Old routine",
      ],
    );
    assert.isFalse(tasks.some(({ title }) => title.startsWith("Secret")));
    const byWande = new Map(tasks.map((task) => [task.wandeId, task]));
    const alphaOne = byWande.get("t-alpha-one")!;
    assert.deepStrictEqual(
      [alphaOne.id, alphaOne.projectId, alphaOne.description, alphaOne.audience, alphaOne.kind],
      ["task-wande-t-alpha-one", "existing-alpha", "# notes", "person", "task"],
    );
    assert.equal(alphaOne.wandeProjectId, "p-alpha");
    assert.equal(alphaOne.createdAt, new Date(DAY + 1000).toISOString());
    assert.deepStrictEqual(
      [byWande.get("t-alpha-two")!.status, byWande.get("t-alpha-two")!.archived],
      ["Done", 0],
    );
    assert.deepStrictEqual(
      [
        byWande.get("t-beta")!.projectId,
        byWande.get("t-beta")!.status,
        byWande.get("t-beta")!.archived,
      ],
      ["existing-beta", "To Do", 1],
    );
    assert.equal(byWande.get("t-gamma-old")!.projectId, gamma.id);
    assert.equal(byWande.get("t-lost")!.projectId, inbox);
    assert.equal(byWande.get("t-inbox")!.projectId, inbox);
    assert.deepStrictEqual(
      [byWande.get("r-gym")!.kind, byWande.get("r-gym")!.projectId],
      ["routine", gamma.id],
    );

    const rows = yield* entries;
    assert.deepStrictEqual(
      rows.map(({ id, taskId, date, startTime, durationMinutes, status }) => [
        id,
        taskId,
        date,
        startTime,
        durationMinutes,
        status,
      ]),
      [
        // The old instance matched by title; the ambiguous, unmatched and wrong-kind ones are skipped.
        [
          "task-schedule-entry-wande-q-old-match",
          "task-wande-t-alpha-one",
          "2025-12-14",
          null,
          null,
          "open",
        ],
        // After the entry that was there before, in wande's order.
        ["entry-existing", "task-existing", "2026-01-02", null, null, "open"],
        [
          "task-schedule-entry-wande-q-gym",
          "task-wande-r-gym",
          "2026-01-02",
          null,
          null,
          "skipped",
        ],
        [
          "task-schedule-entry-wande-q-two",
          "task-wande-t-alpha-two",
          "2026-01-02",
          null,
          null,
          "done",
        ],
        [
          "task-schedule-entry-wande-q-one",
          "task-wande-t-alpha-one",
          "2026-01-02",
          "09:30",
          45,
          "open",
        ],
        [
          "task-schedule-entry-wande-q-future",
          "task-wande-r-gym",
          "2099-01-01",
          "10:00",
          null,
          "open",
        ],
      ],
    );
    // A past timed entry never reminds; a future one does.
    const remindAt = new Map(rows.map(({ id, remindAt }) => [id, remindAt]));
    assert.isNull(remindAt.get("task-schedule-entry-wande-q-one"));
    assert.isNotNull(remindAt.get("task-schedule-entry-wande-q-future"));
  }).pipe(Effect.provide(layer));
});

it.live("a rerun adds only what is missing and keeps the person's changes", () => {
  const { projects, bootstraps, layer, run } = harness();
  return Effect.gen(function* () {
    yield* run(false);
    const repository = yield* TaskRepository;
    const sql = yield* SqlClient.SqlClient;
    yield* repository.update({
      id: TaskId.make("task-wande-t-alpha-one"),
      title: "Renamed after the import",
      actor: { type: "person" },
    });
    yield* repository.deleteScheduleEntries([
      TaskScheduleEntryId.make("task-schedule-entry-wande-q-two"),
    ]);
    const before = { tasks: (yield* importedTasks).length, projects: projects.length };
    const calls = bootstraps();

    const report = yield* run(false);
    assert.deepStrictEqual(report.tasks, { planned: 9, existing: 9, added: 0 });
    assert.deepStrictEqual(report.routines, { planned: 2, existing: 2, added: 0 });
    // The deleted entry is the only thing missing, so it comes back.
    assert.deepStrictEqual(
      [report.entries.existing, report.entries.added],
      [report.entries.planned - 1, 1],
    );
    assert.equal(report.projectsCreated, 0);
    assert.equal(bootstraps(), calls);
    assert.deepStrictEqual(
      { tasks: (yield* importedTasks).length, projects: projects.length },
      before,
    );
    const renamed = yield* sql<{ title: string }>`
      SELECT title FROM tasks WHERE id = 'task-wande-t-alpha-one'`;
    assert.equal(renamed[0]!.title, "Renamed after the import");
  }).pipe(Effect.provide(layer));
});

it.live("the email must name exactly one user", () => {
  const { layer, run } = harness();
  return Effect.gen(function* () {
    const missing = yield* Effect.flip(run(true, "nobody@example.com"));
    assert.include(missing.message, "No user in the snapshot");
    assert.equal((yield* importedTasks).length, 0);
  }).pipe(Effect.provide(layer));
});
