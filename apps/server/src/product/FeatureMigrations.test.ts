import { assert, it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  FeatureMigrationError,
  runExperimentalFeatureMigrations,
  type ExperimentalFeatureMigrationContribution,
} from "./FeatureMigrations.ts";

class SimulatedMigrationError extends Data.TaggedError("SimulatedMigrationError")<{}> {}

const noFeatureMigrations: ReadonlyArray<ExperimentalFeatureMigrationContribution<never>> = [];

const contribution = <E = never>(
  namespace: string,
  migrations: ExperimentalFeatureMigrationContribution<E>["migrations"],
): ExperimentalFeatureMigrationContribution<E> => ({
  ownerId: namespace,
  namespace,
  migrations,
});

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("feature migrations", (it) => {
  it.effect("preserves absent feature tables, data, and migration history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const feature = contribution("test.preserved", [
        {
          version: 1,
          name: "CreatePreservedData",
          run: sql`CREATE TABLE preserved_feature_data (id TEXT PRIMARY KEY, value TEXT NOT NULL)`,
        },
      ]);

      assert.deepStrictEqual(yield* runExperimentalFeatureMigrations([feature]), [
        {
          ownerId: "test.preserved",
          namespace: "test.preserved",
          version: 1,
          name: "CreatePreservedData",
        },
      ]);
      yield* sql`INSERT INTO preserved_feature_data (id, value) VALUES ('row-1', 'kept')`;

      yield* runExperimentalFeatureMigrations(noFeatureMigrations);
      const rows = yield* sql<{ readonly value: string }>`
        SELECT value FROM preserved_feature_data WHERE id = 'row-1'
      `;
      const history = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM feature_migration_history
        WHERE namespace = 'test.preserved'
      `;

      assert.equal(rows[0]?.value, "kept");
      assert.equal(history[0]?.count, 1);
      assert.deepStrictEqual(yield* runExperimentalFeatureMigrations([feature]), []);
    }),
  );

  it.effect("rolls back a failed migration and permits a corrected restart", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const failed = contribution("test.recovery", [
        {
          version: 1,
          name: "CreateRecoveredData",
          run: Effect.gen(function* () {
            yield* sql`CREATE TABLE recovered_feature_data (id TEXT PRIMARY KEY)`;
            return yield* new SimulatedMigrationError();
          }),
        },
      ]);

      const failedExit = yield* Effect.exit(runExperimentalFeatureMigrations([failed]));
      assert.equal(failedExit._tag, "Failure");
      const tablesAfterFailure = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'recovered_feature_data'
      `;
      const historyAfterFailure = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM feature_migration_history
        WHERE namespace = 'test.recovery'
      `;
      assert.equal(tablesAfterFailure[0]?.count, 0);
      assert.equal(historyAfterFailure[0]?.count, 0);

      const corrected = contribution("test.recovery", [
        {
          version: 1,
          name: "CreateRecoveredData",
          run: sql`CREATE TABLE recovered_feature_data (id TEXT PRIMARY KEY)`,
        },
      ]);
      assert.equal((yield* runExperimentalFeatureMigrations([corrected])).length, 1);
    }),
  );

  it.effect("rejects opening newer active feature history with an older feature", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const current = contribution("test.downgrade", [
        {
          version: 1,
          name: "CreateDowngradeData",
          run: sql`CREATE TABLE downgrade_feature_data (id TEXT PRIMARY KEY)`,
        },
        {
          version: 2,
          name: "AddDowngradeValue",
          run: sql`ALTER TABLE downgrade_feature_data ADD COLUMN value TEXT`,
        },
      ]);
      yield* runExperimentalFeatureMigrations([current]);

      const older = contribution("test.downgrade", [current.migrations[0]!]);
      const error = yield* runExperimentalFeatureMigrations([older]).pipe(Effect.flip);
      assert.equal(error instanceof FeatureMigrationError, true);
      if (error instanceof FeatureMigrationError) {
        assert.equal(error.code, "history-ahead");
      }
    }),
  );
});
