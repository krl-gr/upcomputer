import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const OLD_PUBLIC_MIGRATION_31 = "ProjectionThreadContextBindings";
const OLD_PUBLIC_MIGRATION_32 = "ProjectionTurnsContextBlocks";
const LEGACY_UPCOMPUTER_MIGRATIONS = new Map<number, ReadonlySet<string>>([
  [31, new Set([OLD_PUBLIC_MIGRATION_31])],
  [32, new Set([OLD_PUBLIC_MIGRATION_32])],
  [33, new Set(["Tasks", "ProjectionOrchestrationRuns"])],
  [34, new Set(["TaskTriggers", "ProjectionOrchestrationRunsDeliveries"])],
  [35, new Set(["TaskAgentsCompatibility"])],
  [36, new Set(["EnsureTaskTables"])],
  [37, new Set(["ProjectionThreadProposedPlanProposal"])],
  [38, new Set(["ProjectionThreadsSidebarVisibility"])],
]);

// Fork-only migrations that once used core ids and now live in the
// `upcomputer.core` feature namespace (see CoreFeatureMigrations.ts).
const RETIRED_FORK_MIGRATIONS: ReadonlyArray<readonly [number, string]> = [
  [38, "ProjectionLinkedProjects"],
];

export interface CurrentMigrationIdentity {
  readonly id: number;
  readonly name: string;
}

export interface ApplyOldPublicMigrationCompatibilityOptions {
  readonly currentMigrations: ReadonlyArray<CurrentMigrationIdentity>;
  readonly toMigrationInclusive?: number | undefined;
}

const targetsCurrentAuthMigrationIds = (targetMigrationId: number) => targetMigrationId >= 31;

/**
 * Old UpComputer public builds used migration IDs 31/32 for thread context.
 * Fresh upstream now uses those same IDs for auth schema changes. Normalize the
 * old migration history before Effect's migrator picks the latest migration ID.
 */
export const applyOldPublicMigrationCompatibility = Effect.fn(
  "applyOldPublicMigrationCompatibility",
)(function* ({
  currentMigrations,
  toMigrationInclusive,
}: ApplyOldPublicMigrationCompatibilityOptions) {
  const latestCurrentMigrationId = currentMigrations.at(-1)?.id ?? 0;
  const targetMigrationId = toMigrationInclusive ?? latestCurrentMigrationId;
  if (!targetsCurrentAuthMigrationIds(targetMigrationId)) return;

  const currentMigrationNames = new Map(
    currentMigrations.map(({ id, name }) => [id, name] as const),
  );
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS effect_sql_migrations (
          migration_id integer PRIMARY KEY NOT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        )
      `;

      // Drop retired fork rows so upstream migrations reusing those ids still run.
      for (const [id, name] of RETIRED_FORK_MIGRATIONS) {
        if (currentMigrationNames.get(id) === name) continue;
        yield* sql`
          DELETE FROM effect_sql_migrations
          WHERE migration_id = ${id} AND name = ${name}
        `;
      }

      const latestRows = yield* sql<{ readonly latest: number | null }>`
        SELECT MAX(migration_id) AS "latest"
        FROM effect_sql_migrations
      `;
      const latestMigrationId = latestRows[0]?.latest ?? null;

      const conflictingRows = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 31
        ORDER BY migration_id
      `;
      const legacyRows = conflictingRows.filter((row) =>
        LEGACY_UPCOMPUTER_MIGRATIONS.get(row.migration_id)?.has(row.name),
      );

      const shouldInstallOldPublicContextSchema = latestMigrationId === 30 || legacyRows.length > 0;

      if (!shouldInstallOldPublicContextSchema) return;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_thread_context_bindings (
          binding_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          source_thread_id TEXT NOT NULL,
          source_project_id TEXT,
          source_thread_title TEXT NOT NULL,
          mode TEXT NOT NULL,
          cutoff_message_id TEXT,
          snapshot_text TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_thread_context_bindings_thread
        ON projection_thread_context_bindings(thread_id, created_at, binding_id)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_thread_context_bindings_source
        ON projection_thread_context_bindings(source_thread_id)
      `;

      const projectionTurnColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turns)
      `;
      const hasProjectionTurnsTable = projectionTurnColumns.length > 0;
      const hasContextBlocksColumn = projectionTurnColumns.some(
        (column) => column.name === "context_blocks_json",
      );

      if (hasProjectionTurnsTable && !hasContextBlocksColumn) {
        yield* sql`
          ALTER TABLE projection_turns
          ADD COLUMN context_blocks_json TEXT NOT NULL DEFAULT '[]'
        `;
      }

      if (legacyRows.length === 0) return;

      yield* sql`
        CREATE TABLE IF NOT EXISTS old_public_migration_history (
          legacy_migration_id INTEGER PRIMARY KEY NOT NULL,
          legacy_name TEXT NOT NULL,
          legacy_created_at TEXT,
          recorded_at TEXT NOT NULL DEFAULT current_timestamp
        )
      `;

      for (const row of legacyRows) {
        yield* sql`
          INSERT OR IGNORE INTO old_public_migration_history (
            legacy_migration_id,
            legacy_name,
            legacy_created_at
          )
          SELECT migration_id, name, created_at
          FROM effect_sql_migrations
          WHERE migration_id = ${row.migration_id} AND name = ${row.name}
        `;

        yield* sql`
          DELETE FROM effect_sql_migrations
          WHERE migration_id = ${row.migration_id} AND name = ${row.name}
        `;
      }

      // A previous compatibility pass may already have recorded a newer current
      // migration after an unrecognized legacy row. Replay current migrations
      // from the first collision so Effect's max-ID migrator cannot skip the
      // newly assigned schemas that precede that recorded row.
      const firstLegacyMigrationId = Math.min(...legacyRows.map((row) => row.migration_id));
      const currentRowsToReplay = conflictingRows.filter(
        (row) =>
          row.migration_id >= firstLegacyMigrationId &&
          row.migration_id <= targetMigrationId &&
          currentMigrationNames.get(row.migration_id) === row.name,
      );
      for (const row of currentRowsToReplay) {
        yield* sql`
          DELETE FROM effect_sql_migrations
          WHERE migration_id = ${row.migration_id} AND name = ${row.name}
        `;
      }
    }),
  );
});
