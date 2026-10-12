import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import { TaskRepository } from "../TaskRepository.ts";
import { TaskRepositoryLive } from "../TaskRepositoryLive.ts";
import { TASK_RANK_STEP, encodeTaskRank } from "../taskRank.ts";
import { TasksNewestFirstMigration } from "./031_TasksNewestFirst.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

/** When migration 25 switched new tasks to the end of the order. */
const appendedSince = "2026-10-10 02:30:00";

/** Backlog tasks of a dev queue, each at a slot of the order (1 is the top). */
const seed = (rows: ReadonlyArray<readonly [id: string, slot: number, createdAt: string]>) =>
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    for (const [id, slot, createdAt] of rows)
      yield* repository.upsert({
        id: TaskId.make(id),
        projectId: ProjectId.make("project-1"),
        title: id,
        description: "",
        output: null,
        status: "Backlog",
        priority: null,
        createdBy: "test",
        assigneeAgentRunId: null,
        sourceThreadId: null,
        sourceRunId: null,
        metadata: null,
        tags: ["dev"],
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        rank: encodeTaskRank(BigInt(slot) * TASK_RANK_STEP),
      });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE feature_migration_history SET applied_at = ${appendedSince}
      WHERE name = ${"UpdateDefaultQueuePrompts"}
    `;
  });

const order = Effect.gen(function* () {
  const tasks = yield* (yield* TaskRepository).search({ limit: 500 });
  return tasks.map(({ id }) => id as string);
});

const clear = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM tasks`;
});

it.layer(TaskRepositoryLive.pipe(Layer.provideMerge(database)))(
  "TasksNewestFirst migration",
  (it) => {
    it.effect("moves the tasks that joined the end to the top, in reverse, once", () =>
      Effect.gen(function* () {
        yield* clear;
        yield* seed([
          // Before migration 25 new tasks went on top: newest first, and old-1
          // was dragged below old-2 by hand.
          ["old-3", 1, "2026-10-09T12:00:00.000Z"],
          // Created since, but placed among the older tasks by hand.
          ["placed", 2, "2026-10-11T09:00:00.000Z"],
          ["old-2", 3, "2026-10-09T11:00:00.000Z"],
          ["old-1", 4, "2026-10-09T10:00:00.000Z"],
          // Since then new tasks joined the end; new-3 was moved above new-2.
          ["new-1", 5, "2026-10-10T08:00:00.000Z"],
          ["new-3", 6, "2026-10-11T10:00:00.000Z"],
          ["new-2", 7, "2026-10-10T09:00:00.000Z"],
        ]);
        yield* TasksNewestFirstMigration;

        assert.deepStrictEqual(yield* order, [
          "new-2",
          "new-3",
          "new-1",
          "old-3",
          "placed",
          "old-2",
          "old-1",
        ]);
        // The queue now runs from the bottom: the older part as before, then
        // the moved block in the order it had.
        const queue = yield* (yield* TaskRepository).search({ tags: ["dev"], from: "bottom" });
        assert.deepStrictEqual(queue.map(({ id }) => id as string).slice(-3), [
          "new-1",
          "new-3",
          "new-2",
        ]);

        const once = yield* order;
        yield* TasksNewestFirstMigration;
        assert.deepStrictEqual(yield* order, once);

        // The order is centered, so new tasks have room above the top.
        const [top] = yield* (yield* TaskRepository).search({ limit: 1 });
        assert.isAbove(top!.rank.localeCompare("4000000000000000"), 0);
      }),
    );

    it.effect("a store whose order ends with an older task stays as it is", () =>
      Effect.gen(function* () {
        yield* clear;
        yield* seed([
          ["new-1", 1, "2026-10-11T08:00:00.000Z"],
          ["old-2", 2, "2026-10-09T11:00:00.000Z"],
          ["old-1", 3, "2026-10-09T10:00:00.000Z"],
        ]);
        const sql = yield* SqlClient.SqlClient;
        const ranks = () => sql`SELECT id, rank FROM tasks ORDER BY id`;
        const before = yield* ranks();
        yield* TasksNewestFirstMigration;
        assert.deepStrictEqual(yield* ranks(), before);
      }),
    );
  },
);
