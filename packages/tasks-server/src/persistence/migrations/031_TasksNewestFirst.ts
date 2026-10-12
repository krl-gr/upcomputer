import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { centeredTaskRanks } from "../taskRank.ts";

/**
 * Migration 25 shipped with the rule that new tasks join the end of the
 * order; until then, and again from this update, they go to the top. Tasks
 * created in between sit at the bottom in creation order. This moves them to
 * the top in reverse, so the list reads newest first and agents' queues, which
 * now run from the bottom, still take them in the order they were created.
 *
 * The block is the bottom run of the order below the last task created before
 * migration 25 applied: those tasks can only have got there by joining the
 * end. Tasks created since but placed among older ones by hand stay where
 * they are. Once moved, the order ends with an older task again, so a second
 * run finds no block.
 */
export const TasksNewestFirstMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [appended] = yield* sql<{ readonly appliedAt: string | null }>`
    SELECT MIN(applied_at) AS "appliedAt" FROM feature_migration_history
    WHERE namespace = ${"upcomputer.tasks"} AND name = ${"UpdateDefaultQueuePrompts"}
  `;
  if (!appended?.appliedAt) return;
  // applied_at is SQLite's CURRENT_TIMESTAMP (UTC, "YYYY-MM-DD HH:MM:SS");
  // created_at is ISO 8601 in UTC.
  const since = appended.appliedAt.replace(" ", "T");

  const order = yield* sql<{ readonly id: string; readonly createdAt: string }>`
    SELECT id, created_at AS "createdAt" FROM tasks ORDER BY rank ASC, id ASC
  `;
  const lastOlder = order.findLastIndex(({ createdAt }) => createdAt < since);
  const block = order.slice(lastOlder + 1);
  if (block.length === 0) return;

  // The centered spacing leaves room above the top for the tasks to come.
  const ranks = centeredTaskRanks([
    ...block.toReversed().map(({ id }) => id),
    ...order.slice(0, lastOlder + 1).map(({ id }) => id),
  ]);
  yield* sql`UPDATE tasks SET rank = NULL`;
  for (const [id, rank] of ranks) yield* sql`UPDATE tasks SET rank = ${rank} WHERE id = ${id}`;
});
