import { OrchestrationV2TurnItem, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class TurnItemPositionStoreError extends Schema.TaggedError<TurnItemPositionStoreError>()(
  "TurnItemPositionStoreError",
  {
    threadId: ThreadId,
    turnItemId: TurnItemId,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const isTurnItemPositionStoreError = Schema.is(TurnItemPositionStoreError);

export interface TurnItemPositionStoreV2Shape {
  /**
   * Run items are positioned in their run's band. Items without a run are history from
   * before the first run, unless `afterLatestRun` places one after the thread's latest run.
   */
  readonly allocate: (input: {
    readonly threadId: ThreadId;
    readonly turnItemId: TurnItemId;
    readonly runId: RunId | null;
    readonly runOrdinal?: number;
    readonly afterLatestRun?: boolean;
    // `run_start` takes the run's unused first slot, ahead of its items, and appends once it is taken.
    readonly placement?: "append" | "run_start";
    // Keep an existing position even when it lies outside the run's range.
    readonly keepExisting?: boolean;
  }) => Effect.Effect<number, TurnItemPositionStoreError>;
  readonly normalize: (
    item: OrchestrationV2TurnItem,
    runOrdinal?: number,
  ) => Effect.Effect<OrchestrationV2TurnItem, TurnItemPositionStoreError>;
}

export class TurnItemPositionStoreV2 extends Context.Service<
  TurnItemPositionStoreV2,
  TurnItemPositionStoreV2Shape
>()("t3/orchestration-v2/TurnItemPositionStore/TurnItemPositionStoreV2") {}

export const layer: Layer.Layer<TurnItemPositionStoreV2, never, SqlClient.SqlClient> = Layer.effect(
  TurnItemPositionStoreV2,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const allocate: TurnItemPositionStoreV2Shape["allocate"] =
      /* This helper runs for individual orchestration events; the enclosing operation owns the span. */
      Effect.fnUntraced(
        function* ({
          threadId,
          turnItemId,
          runId,
          runOrdinal: suppliedRunOrdinal,
          afterLatestRun = false,
          placement = "append",
          keepExisting = false,
        }) {
          const existing = yield* sql<{ readonly ordinal: number }>`
          SELECT ordinal
          FROM orchestration_v2_turn_item_positions
          WHERE thread_id = ${threadId} AND turn_item_id = ${turnItemId}
          LIMIT 1
        `;
          const runRows =
            suppliedRunOrdinal !== undefined
              ? []
              : runId !== null
                ? yield* sql<{ readonly ordinal: number }>`
                  SELECT ordinal
                  FROM orchestration_v2_projection_runs
                  WHERE thread_id = ${threadId} AND run_id = ${runId}
                  LIMIT 1
                `
                : // A placed run-less item keeps its slot once it has one.
                  afterLatestRun && existing[0] === undefined
                  ? yield* sql<{ readonly ordinal: number | null }>`
                    SELECT MAX(ordinal) AS ordinal
                    FROM orchestration_v2_projection_runs
                    WHERE thread_id = ${threadId}
                  `
                  : [];
          const runOrdinal = suppliedRunOrdinal ?? runRows[0]?.ordinal ?? null;
          const lowerBound = runOrdinal === null ? 0 : runOrdinal * 1_000_000;
          const upperBound = runOrdinal === null ? 999_999 : lowerBound + 999_999;
          const current = existing[0]?.ordinal;
          if (current !== undefined) {
            // A steer that missed its turn starts the next run; it moves into that run's range.
            if (
              keepExisting ||
              runOrdinal === null ||
              (current >= lowerBound && current <= upperBound)
            ) {
              return current;
            }
            yield* sql`
            UPDATE orchestration_v2_turn_item_positions
            SET ordinal = (
              SELECT COALESCE(MAX(ordinal), ${lowerBound}) + 1
              FROM orchestration_v2_turn_item_positions
              WHERE thread_id = ${threadId}
                AND ordinal >= ${lowerBound}
                AND ordinal <= ${upperBound}
            )
            WHERE thread_id = ${threadId} AND turn_item_id = ${turnItemId}
          `;
          } else {
            yield* sql`
            INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
            SELECT
              ${threadId},
              ${turnItemId},
              ${
                placement === "run_start"
                  ? sql`CASE WHEN COALESCE(MIN(ordinal), ${upperBound}) > ${lowerBound} THEN ${lowerBound} ELSE MAX(ordinal) + 1 END`
                  : sql`COALESCE(MAX(ordinal), ${lowerBound}) + 1`
              }
            FROM orchestration_v2_turn_item_positions
            WHERE thread_id = ${threadId}
              AND ordinal >= ${lowerBound}
              AND ordinal <= ${upperBound}
            ON CONFLICT(thread_id, turn_item_id) DO NOTHING
          `;
          }
          const rows = yield* sql<{ readonly ordinal: number }>`
          SELECT ordinal
          FROM orchestration_v2_turn_item_positions
          WHERE thread_id = ${threadId} AND turn_item_id = ${turnItemId}
          LIMIT 1
        `;
          const ordinal = rows[0]?.ordinal;
          if (ordinal === undefined) {
            return yield* new TurnItemPositionStoreError({
              threadId,
              turnItemId,
              cause: "Position allocation returned no row.",
            });
          }
          return ordinal;
        },
        (effect, { threadId, turnItemId }) =>
          effect.pipe(
            Effect.mapError((cause) =>
              isTurnItemPositionStoreError(cause)
                ? cause
                : new TurnItemPositionStoreError({ threadId, turnItemId, cause }),
            ),
          ),
      );

    return TurnItemPositionStoreV2.of({
      allocate,
      // Per-event normalization shares the enclosing orchestration span.
      normalize: Effect.fnUntraced(function* (item, runOrdinal) {
        return yield* allocate({
          threadId: item.threadId,
          turnItemId: item.id,
          runId: item.runId,
          // Queued steers keep their submission order until their run starts (see Orchestrator).
          keepExisting: item.status === "pending",
          ...(runOrdinal === undefined ? {} : { runOrdinal }),
          // A notification recorded without a run (thread.notification.record) happened
          // after the runs the thread has so far, not before them.
          afterLatestRun: item.runId === null && item.type === "notification",
        }).pipe(Effect.map((ordinal) => (item.ordinal === ordinal ? item : { ...item, ordinal })));
      }),
    });
  }),
);
