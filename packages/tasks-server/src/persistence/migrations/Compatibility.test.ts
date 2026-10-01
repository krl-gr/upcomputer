/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, test } from "vite-plus/test";

import * as Effect from "effect/Effect";

import { DEFAULT_TASK_PROMPT_SETTINGS } from "@upcomputer/tasks-contracts/v1";
import {
  runExperimentalFeatureMigrations,
  type ExperimentalFeatureMigrationContribution,
} from "../../../../../apps/server/src/extensionApi.ts";
import * as NodeSqliteClient from "../../../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { ORCHESTRATOR_PROPOSAL_MIGRATION_CONTRIBUTION } from "../../proposals/migrations.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const temporaryDirectories: string[] = [];
const taskMigrations = [
  TASK_MIGRATION_CONTRIBUTION,
  ORCHESTRATOR_PROPOSAL_MIGRATION_CONTRIBUTION,
] as const;
const taskMigrationCount = taskMigrations.reduce(
  (total, contribution) => total + contribution.migrations.length,
  0,
);

function temporaryDatabase(name: string): string {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-phase-11-"));
  temporaryDirectories.push(directory);
  return NodePath.join(directory, name);
}

function database<T>(path: string, use: (db: NodeSqlite.DatabaseSync) => T): T {
  const db = new NodeSqlite.DatabaseSync(path);
  try {
    return use(db);
  } finally {
    db.close();
  }
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

test("core-only, disabled, enabled, and restored databases preserve extension data", async () => {
  const coreOnlyPath = temporaryDatabase("core-only.sqlite");
  await migrate(coreOnlyPath, []);
  database(coreOnlyPath, (db) => {
    const taskTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get();
    NodeAssert.equal(taskTable, undefined);
  });

  const tasksPath = temporaryDatabase("tasks.sqlite");
  await migrate(tasksPath, taskMigrations);
  database(tasksPath, (db) => {
    db.prepare(`
      INSERT INTO tasks (
        id, rank, project_id, title, description, status, priority, created_by,
        assignee_worker_id, source_thread_id, source_run_id, metadata_json,
        created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "task-1",
      "0000000100000000",
      "project-1",
      "Preserved task",
      "Compatibility rehearsal",
      "open",
      null,
      "user",
      null,
      null,
      null,
      "{}",
      "2026-07-12T00:00:00.000Z",
      "2026-07-12T00:00:00.000Z",
      null,
    );
  });

  // Opening the same database without installed features must not interpret or
  // remove their tables, rows, or migration cursors.
  await migrate(tasksPath, []);
  database(tasksPath, (db) => {
    const task = db.prepare("SELECT title FROM tasks WHERE id = ?").get("task-1") as
      | { title: string }
      | undefined;
    const history = db.prepare("SELECT COUNT(*) AS count FROM feature_migration_history").get() as {
      count: number;
    };
    NodeAssert.equal(task?.title, "Preserved task");
    NodeAssert.equal(history.count, taskMigrationCount);
  });

  // Re-enabling/reinstalling is idempotent and requires no data migration.
  await migrate(tasksPath, taskMigrations);
  database(tasksPath, (db) => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    NodeAssert.equal(count.count, 1);
  });

  const backupPath = NodePath.join(tasksPath, "..", "restored.sqlite");
  NodeFS.copyFileSync(tasksPath, backupPath);
  await migrate(backupPath, taskMigrations);
  database(backupPath, (db) => {
    const restored = db.prepare("SELECT title FROM tasks WHERE id = ?").get("task-1") as
      | { title: string }
      | undefined;
    NodeAssert.equal(restored?.title, "Preserved task");
  });
});

test("legacy task agents and runs import without deleting legacy tables", async () => {
  const path = temporaryDatabase("legacy.sqlite");
  database(path, (db) => {
    db.exec(`
      CREATE TABLE task_trigger_rules (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        match_statuses_json TEXT NOT NULL,
        match_tags_json TEXT NOT NULL,
        worker_template_json TEXT NOT NULL,
        concurrency_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE task_worker_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        trigger_rule_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        model_selection_json TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
    db.prepare(`
      INSERT INTO task_trigger_rules VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "agent-1",
      "project-1",
      "Legacy agent",
      1,
      '["open"]',
      '["backend"]',
      '{"prompt":"Review the task"}',
      "project-1",
      "2026-07-12T00:00:00.000Z",
      "2026-07-12T00:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO task_worker_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run-1",
      "task-1",
      "agent-1",
      "thread-1",
      '{"provider":"codex"}',
      "completed",
      "2026-07-12T00:00:00.000Z",
      "2026-07-12T00:01:00.000Z",
    );
  });

  await migrate(path, taskMigrations);
  database(path, (db) => {
    const agent = db
      .prepare("SELECT config_json AS configJson FROM task_agents WHERE id = ?")
      .get("agent-1") as { configJson: string } | undefined;
    const run = db
      .prepare("SELECT agent_id AS agentId FROM task_agent_runs WHERE id = ?")
      .get("run-1") as { agentId: string } | undefined;
    const legacyTables = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name IN ('task_trigger_rules', 'task_worker_runs')
      `)
      .get() as { count: number };

    NodeAssert.deepEqual(JSON.parse(agent?.configJson ?? "{}"), {
      instructions: "Review the task",
    });
    NodeAssert.equal(run?.agentId, "agent-1");
    NodeAssert.equal(legacyTables.count, 2);
  });
});

test("adds task output and backfills the latest durable agent summary", async () => {
  const path = temporaryDatabase("task-output.sqlite");
  const migrationsBeforeOutput: ExperimentalFeatureMigrationContribution<Error> = {
    ...TASK_MIGRATION_CONTRIBUTION,
    migrations: TASK_MIGRATION_CONTRIBUTION.migrations.slice(0, 5),
  };
  await migrate(path, [migrationsBeforeOutput]);

  database(path, (db) => {
    db.prepare(
      `INSERT INTO tasks (
        id, project_id, title, description, status, priority, created_by,
        assignee_worker_id, source_thread_id, source_run_id, metadata_json,
        created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "task-1",
      "project-1",
      "Existing task",
      "Keep this description",
      "ready for review",
      null,
      "user",
      null,
      null,
      null,
      "null",
      "2026-08-09T12:00:00.000Z",
      "2026-08-09T12:00:00.000Z",
      null,
    );
    db.prepare(
      `INSERT INTO task_events (id, task_id, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "event-1",
      "task-1",
      "task.agent-result",
      JSON.stringify({ summary: "Completed successfully." }),
      "2026-08-09T12:05:00.000Z",
    );
  });

  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);
  database(path, (db) => {
    const row = db.prepare("SELECT description, output FROM tasks WHERE id = ?").get("task-1") as {
      readonly description: string;
      readonly output: string | null;
    };
    NodeAssert.equal(row.description, "Keep this description");
    NodeAssert.equal(row.output, "Completed successfully.");
  });
});

test("creates durable task prompt settings with product defaults", async () => {
  const path = temporaryDatabase("task-prompt-settings.sqlite");
  const migrationsBeforePromptSettings: ExperimentalFeatureMigrationContribution<Error> = {
    ...TASK_MIGRATION_CONTRIBUTION,
    migrations: TASK_MIGRATION_CONTRIBUTION.migrations.slice(0, 6),
  };
  await migrate(path, [migrationsBeforePromptSettings]);
  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);

  database(path, (db) => {
    const row = db
      .prepare(
        `SELECT
           task_creation AS taskCreation,
           agent_creation AS agentCreation,
           automation_creation AS automationCreation,
           task_execution AS taskExecution
         FROM task_prompt_settings WHERE id = 1`,
      )
      .get() as typeof DEFAULT_TASK_PROMPT_SETTINGS;
    NodeAssert.deepEqual({ ...row }, DEFAULT_TASK_PROMPT_SETTINGS);

    db.prepare("UPDATE task_prompt_settings SET task_creation = ? WHERE id = 1").run(
      "Custom task guidance",
    );
  });

  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);
  database(path, (db) => {
    const row = db
      .prepare("SELECT task_creation AS taskCreation FROM task_prompt_settings WHERE id = 1")
      .get() as { readonly taskCreation: string };
    NodeAssert.equal(row.taskCreation, "Custom task guidance");
  });
});

test("backfills existing task-agent threads as hidden from the core sidebar", async () => {
  const path = temporaryDatabase("thread-visibility.sqlite");
  const migrationsThroughAgentStorage: ExperimentalFeatureMigrationContribution<Error> = {
    ...TASK_MIGRATION_CONTRIBUTION,
    migrations: TASK_MIGRATION_CONTRIBUTION.migrations.slice(0, 4),
  };
  await migrate(path, [migrationsThroughAgentStorage]);

  database(path, (db) => {
    db.exec(`
      CREATE TABLE projection_threads (
        thread_id TEXT PRIMARY KEY,
        sidebar_visible INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO projection_threads (thread_id, sidebar_visible)
      VALUES ('task-agent-thread-1', 1), ('ordinary-thread-1', 1);
    `);
    db.prepare(`
      INSERT INTO task_agent_runs (
        id, task_id, agent_id, thread_id, model_selection_json,
        status, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run-1",
      "task-1",
      "agent-1",
      "task-agent-thread-1",
      '{"provider":"codex"}',
      "completed",
      "2026-07-12T00:00:00.000Z",
      "2026-07-12T00:01:00.000Z",
    );
  });

  await migrate(path, [TASK_MIGRATION_CONTRIBUTION]);
  database(path, (db) => {
    const visibility = db.prepare(
      "SELECT sidebar_visible AS sidebarVisible FROM projection_threads WHERE thread_id = ?",
    );
    NodeAssert.equal(
      (visibility.get("ordinary-thread-1") as { sidebarVisible: number }).sidebarVisible,
      1,
    );
    NodeAssert.equal(
      (visibility.get("task-agent-thread-1") as { sidebarVisible: number }).sidebarVisible,
      0,
    );
  });
});
