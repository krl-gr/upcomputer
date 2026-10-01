/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, test } from "vite-plus/test";

import * as Effect from "effect/Effect";

import {
  runExperimentalFeatureMigrations,
  type ExperimentalFeatureMigrationContribution,
} from "../../../../../apps/server/src/extensionApi.ts";
import * as NodeSqliteClient from "../../../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

// Kept in step with TaskAutomationDbRow. The repository decodes rows by field
// name, so a stale alias here is a runtime-only failure that types cannot see.
const AUTOMATION_SELECT_ALIASES = [
  "id",
  "projectId",
  "name",
  "status",
  "schedule",
  "template",
  "catchUpPolicy",
  "skipIfOpen",
  "createdBy",
  "sourceThreadId",
  "nextRunAt",
  "lastFiredAt",
  "lastFiredSlot",
  "lastTaskId",
  "lastError",
  "failureCount",
  "createdAt",
  "updatedAt",
] as const;

const AUTOMATION_SELECT = `
  SELECT
    id,
    project_id AS "projectId",
    name,
    status,
    schedule_json AS "schedule",
    template_json AS "template",
    catch_up_policy AS "catchUpPolicy",
    skip_if_open AS "skipIfOpen",
    created_by AS "createdBy",
    source_thread_id AS "sourceThreadId",
    next_run_at AS "nextRunAt",
    last_fired_at AS "lastFiredAt",
    last_fired_slot AS "lastFiredSlot",
    last_task_id AS "lastTaskId",
    last_error AS "lastError",
    failure_count AS "failureCount",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM task_automations
  WHERE id = ?
`;

const temporaryDirectories: string[] = [];

function temporaryDatabase(name: string): string {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-automations-"));
  temporaryDirectories.push(directory);
  return NodePath.join(directory, name);
}

async function migrate(
  path: string,
  contributions: ReadonlyArray<ExperimentalFeatureMigrationContribution<Error>>,
): Promise<void> {
  await Effect.runPromise(
    runExperimentalFeatureMigrations(contributions).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: path })),
    ),
  );
}

function seedAutomation(db: NodeSqlite.DatabaseSync, id: string, status = "draft"): void {
  db.prepare(
    `INSERT INTO task_automations (
        id, project_id, name, status, schedule_json, template_json,
        catch_up_policy, skip_if_open, created_by, source_thread_id,
        next_run_at, last_fired_at, last_fired_slot, last_task_id, last_error,
        failure_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    "project-1",
    "Daily check",
    status,
    JSON.stringify({ cron: "0 9 * * 1-5", timezone: "Europe/Berlin" }),
    JSON.stringify({
      title: "Review dependencies",
      description: "",
      status: "new",
      priority: null,
      tags: ["maintenance"],
    }),
    "fire-once",
    1,
    "agent",
    null,
    "2026-07-15T07:00:00.000Z",
    null,
    null,
    null,
    null,
    0,
    "2026-07-14T10:00:00.000Z",
    "2026-07-14T10:00:00.000Z",
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

test("the automation select exposes exactly the columns the repository decodes", async () => {
  const path = temporaryDatabase("automations.sqlite");
  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);

  const db = new NodeSqlite.DatabaseSync(path);
  try {
    seedAutomation(db, "automation-1");
    const row = db.prepare(AUTOMATION_SELECT).get("automation-1") as Record<string, unknown>;

    NodeAssert.deepEqual(Object.keys(row).sort(), [...AUTOMATION_SELECT_ALIASES].sort());
    // Booleans round-trip as integers, which is why the repository maps them.
    NodeAssert.equal(row.skipIfOpen, 1);
    NodeAssert.equal(row.failureCount, 0);
    NodeAssert.equal(
      JSON.parse(String(row.schedule)).timezone,
      "Europe/Berlin",
      "the schedule column must stay valid JSON for the decoder",
    );
  } finally {
    db.close();
  }
});

test("a schedule slot can only be claimed once", async () => {
  const path = temporaryDatabase("automations.sqlite");
  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);

  const db = new NodeSqlite.DatabaseSync(path);
  try {
    seedAutomation(db, "automation-1");
    const claim = db.prepare(
      `INSERT INTO task_automation_runs (automation_id, slot, task_id, outcome, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    claim.run(
      "automation-1",
      "2026-07-15T07:00:00.000Z",
      null,
      "created",
      null,
      "2026-07-15T07:00:01.000Z",
    );

    // This is the idempotency guarantee the scheduler relies on: a restart
    // mid-fire re-attempts the same slot and must not produce a second task.
    NodeAssert.throws(
      () =>
        claim.run(
          "automation-1",
          "2026-07-15T07:00:00.000Z",
          null,
          "created",
          null,
          "2026-07-15T07:05:00.000Z",
        ),
      /UNIQUE|constraint/i,
    );

    // A different slot for the same automation is still allowed.
    claim.run(
      "automation-1",
      "2026-07-16T07:00:00.000Z",
      null,
      "created",
      null,
      "2026-07-16T07:00:01.000Z",
    );
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM task_automation_runs WHERE automation_id = ?")
      .get("automation-1") as { count: number };
    NodeAssert.equal(count.count, 2);
  } finally {
    db.close();
  }
});

test("the guarded schedule write only applies while the automation is enabled", async () => {
  const path = temporaryDatabase("automations.sqlite");
  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);

  const db = new NodeSqlite.DatabaseSync(path);
  try {
    seedAutomation(db, "automation-1", "enabled");
    const update = db.prepare(
      `UPDATE task_automations
         SET next_run_at = ?,
           last_fired_at = COALESCE(?, last_fired_at),
           last_fired_slot = COALESCE(?, last_fired_slot),
           last_task_id = COALESCE(?, last_task_id),
           last_error = ?,
           failure_count = ?,
           updated_at = ?
         WHERE id = ? AND status = 'enabled'
         RETURNING id`,
    );

    const applied = update.all(
      "2026-07-16T07:00:00.000Z",
      "2026-07-15T07:00:01.000Z",
      "2026-07-15T07:00:00.000Z",
      "task-1",
      null,
      0,
      "2026-07-15T07:00:01.000Z",
      "automation-1",
    );
    NodeAssert.equal(applied.length, 1, "an enabled automation accepts the scheduler write");

    // A person pauses mid-pass. The in-flight write must not resurrect it.
    db.prepare("UPDATE task_automations SET status = 'disabled' WHERE id = ?").run("automation-1");
    const rejected = update.all(
      "2026-07-17T07:00:00.000Z",
      null,
      null,
      null,
      null,
      0,
      "2026-07-16T07:00:01.000Z",
      "automation-1",
    );
    NodeAssert.equal(rejected.length, 0, "a paused automation rejects the scheduler write");

    const row = db
      .prepare("SELECT status, next_run_at, last_task_id FROM task_automations WHERE id = ?")
      .get("automation-1") as { status: string; next_run_at: string; last_task_id: string };
    NodeAssert.equal(row.status, "disabled");
    NodeAssert.equal(
      row.next_run_at,
      "2026-07-16T07:00:00.000Z",
      "the rejected write left no trace",
    );
    // COALESCE keeps the earlier fire result rather than clearing it.
    NodeAssert.equal(row.last_task_id, "task-1");
  } finally {
    db.close();
  }
});

test("open tasks are found by automation metadata, not by a stored pointer", async () => {
  const path = temporaryDatabase("automations.sqlite");
  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);

  const db = new NodeSqlite.DatabaseSync(path);
  try {
    const insertTask = db.prepare(
      `INSERT INTO tasks (
         id, rank, project_id, title, description, status, priority, created_by,
         assignee_worker_id, source_thread_id, source_run_id, metadata_json,
         created_at, updated_at, closed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const metadata = (automationId: string) =>
      JSON.stringify({ source: "automation", automationId, slot: "2026-07-15T07:00:00.000Z" });

    insertTask.run(
      "task-open",
      "0000000100000000",
      "project-1",
      "Open",
      "",
      "new",
      null,
      "automation:automation-1",
      null,
      null,
      null,
      metadata("automation-1"),
      "t",
      "t",
      null,
    );
    insertTask.run(
      "task-closed",
      "0000000200000000",
      "project-1",
      "Closed",
      "",
      "done",
      null,
      "automation:automation-1",
      null,
      null,
      null,
      metadata("automation-1"),
      "t",
      "t",
      "t",
    );
    insertTask.run(
      "task-other",
      "0000000300000000",
      "project-1",
      "Other",
      "",
      "new",
      null,
      "automation:automation-2",
      null,
      null,
      null,
      metadata("automation-2"),
      "t",
      "t",
      null,
    );
    insertTask.run(
      "task-manual",
      "0000000400000000",
      "project-1",
      "Manual",
      "",
      "new",
      null,
      "user",
      null,
      null,
      null,
      "null",
      "t",
      "t",
      null,
    );

    const count = db.prepare(
      `SELECT COUNT(*) AS "count"
         FROM tasks
         WHERE closed_at IS NULL
           AND json_extract(metadata_json, '$.automationId') = ?`,
    );

    NodeAssert.equal((count.get("automation-1") as { count: number }).count, 1);
    NodeAssert.equal((count.get("automation-2") as { count: number }).count, 1);
    NodeAssert.equal((count.get("automation-3") as { count: number }).count, 0);
  } finally {
    db.close();
  }
});

test("a duplicate automation id is rejected by a plain insert", async () => {
  const path = temporaryDatabase("automations.sqlite");
  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);

  const db = new NodeSqlite.DatabaseSync(path);
  try {
    seedAutomation(db, "automation-1", "enabled");
    // The tool path inserts rather than upserts so it cannot overwrite an
    // automation a person has already reviewed.
    NodeAssert.throws(() => seedAutomation(db, "automation-1"), /UNIQUE|constraint/i);
    const row = db
      .prepare("SELECT status FROM task_automations WHERE id = ?")
      .get("automation-1") as { status: string };
    NodeAssert.equal(row.status, "enabled");
  } finally {
    db.close();
  }
});

test("automations survive a core-only open that does not know the feature", async () => {
  const path = temporaryDatabase("automations.sqlite");
  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);
  const db = new NodeSqlite.DatabaseSync(path);
  try {
    seedAutomation(db, "automation-1", "enabled");
  } finally {
    db.close();
  }

  await migrate(path, []);

  const reopened = new NodeSqlite.DatabaseSync(path);
  try {
    const row = reopened
      .prepare("SELECT status, next_run_at FROM task_automations WHERE id = ?")
      .get("automation-1") as { status: string; next_run_at: string } | undefined;
    NodeAssert.equal(row?.status, "enabled");
    NodeAssert.equal(row?.next_run_at, "2026-07-15T07:00:00.000Z");
  } finally {
    reopened.close();
  }
});
