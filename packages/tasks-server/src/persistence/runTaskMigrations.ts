import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";

/**
 * Applies the task migrations that are not yet recorded. Uses the same
 * `feature_migration_history` ledger as the V1 fork's feature migrations, so a
 * V1 database copied into statev2.sqlite keeps its applied versions.
 */
export const runTaskMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const { namespace, ownerId, migrations } = TASK_MIGRATION_CONTRIBUTION;
  yield* sql`
    CREATE TABLE IF NOT EXISTS feature_migration_history (
      namespace TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (namespace, version)
    )
  `;
  const applied = yield* sql<{ readonly version: number }>`
    SELECT version FROM feature_migration_history WHERE namespace = ${namespace}
  `;
  const appliedVersions = new Set(applied.map((row) => row.version));
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* migration.run;
        yield* sql`
          INSERT INTO feature_migration_history (namespace, version, name, owner_id)
          VALUES (${namespace}, ${migration.version}, ${migration.name}, ${ownerId})
        `;
      }),
    );
  }
});
