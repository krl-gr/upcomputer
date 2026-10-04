import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ProjectionThreadsSettled from "./Migrations/033_ProjectionThreadsSettled.ts";
import ProjectionThreadsSnoozed from "./Migrations/034_ProjectionThreadsSnoozed.ts";
import ProjectionThreadTitleRegeneration from "./Migrations/035_ProjectionThreadTitleRegeneration.ts";
import ProjectionThreadsPinned from "./Migrations/036_ProjectionThreadsPinned.ts";
import ProjectionTurnsKeysetIndex from "./Migrations/037_ProjectionTurnsKeysetIndex.ts";

/**
 * What the UpComputer V1 fork recorded at ids 33-37. Its 34, 35 and 37 are
 * upstream's 33, 34 and 44 under other ids; its 33 and 36 are its own schema,
 * which stays in place for the V1 importer.
 */
const UPCOMPUTER_V1_MIGRATIONS = new Map<number, string>([
  [33, "ProjectionThreadContext"],
  [34, "ProjectionThreadsSettled"],
  [35, "ProjectionThreadsSnoozed"],
  [36, "ProjectionThreadsSidebarVisibility"],
  [37, "ClearAutomaticProjectModelDefaults"],
]);

// Each is idempotent, so the ones V1 already applied under other ids rerun safely.
const UPSTREAM_MIGRATIONS = [
  [33, "ProjectionThreadsSettled", ProjectionThreadsSettled],
  [34, "ProjectionThreadsSnoozed", ProjectionThreadsSnoozed],
  [35, "ProjectionThreadTitleRegeneration", ProjectionThreadTitleRegeneration],
  [36, "ProjectionThreadsPinned", ProjectionThreadsPinned],
  [37, "ProjectionTurnsKeysetIndex", ProjectionTurnsKeysetIndex],
] as const;

/**
 * Brings a database copied from UpComputer V1 onto upstream's ledger. The
 * migrator runs only ids past the recorded maximum, so without this V1's
 * 33-37 would hide upstream's 35-37 and later migrations would fail on the
 * missing columns. Upstream's 44 runs again with the rest; it is idempotent.
 */
export const reconcileUpComputerV1Migrations = Effect.fn("reconcileUpComputerV1Migrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
        if (tables.length === 0) return [];
        const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations
          WHERE migration_id >= 33
          ORDER BY migration_id
        `;
        const first = history[0];
        if (first?.migration_id !== 33 || first.name !== UPCOMPUTER_V1_MIGRATIONS.get(33)) {
          return [];
        }
        const unexpected = history.filter(
          (row) => UPCOMPUTER_V1_MIGRATIONS.get(row.migration_id) !== row.name,
        );
        if (unexpected.length > 0) {
          return yield* new Migrator.MigrationError({
            kind: "BadState",
            message: `Cannot upgrade an UpComputer V1 database with unexpected migrations: ${unexpected
              .map((row) => `${row.migration_id}:${row.name}`)
              .join(", ")}.`,
          });
        }
        const executed: Array<readonly [number, string]> = [];
        for (const [id, name, migration] of UPSTREAM_MIGRATIONS) {
          yield* migration;
          executed.push([id, name]);
        }
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 33`;
        for (const [id, name] of executed) {
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
        }
        return executed;
      }),
    );
  },
);
