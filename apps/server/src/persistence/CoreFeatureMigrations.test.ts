import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../product/FeatureMigrations.ts";
import { CORE_FEATURE_MIGRATIONS } from "./CoreFeatureMigrations.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const sqliteMemoryLayer = Layer.mergeAll(NodeSqliteClient.layerMemory());

const columnNames = Effect.fn("columnNames")(function* (table: string) {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info(${table})
  `;
  return columns.map((column) => column.name);
});

const coreMigrationRows = Effect.fn("coreMigrationRows")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 37
    ORDER BY migration_id
  `;
});

it.layer(sqliteMemoryLayer)("core feature migrations", (it) => {
  it.effect("add linked project columns under the upcomputer.core namespace", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* runExperimentalFeatureMigrations([CORE_FEATURE_MIGRATIONS]);

      assert.include(yield* columnNames("projection_threads"), "linked_project_ids_json");
      assert.include(yield* columnNames("projection_projects"), "linked_project_ids_json");
      assert.include(yield* columnNames("projection_threads"), "project_links_pinned");
      const history = yield* sql<{ readonly namespace: string; readonly version: number }>`
        SELECT namespace, version FROM feature_migration_history ORDER BY version
      `;
      assert.deepStrictEqual(history, [
        { namespace: "upcomputer.core", version: 1 },
        { namespace: "upcomputer.core", version: 2 },
      ]);
      // The core list no longer claims id 38.
      assert.deepStrictEqual(
        (yield* coreMigrationRows()).map((row) => row.migration_id),
        [37],
      );
    }),
  );
});

it.layer(sqliteMemoryLayer)("retired fork migration ids", (it) => {
  it.effect("drop the old core row for ProjectionLinkedProjects and keep the schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // A development database that ran the fork's former core migration 38.
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (38, 'ProjectionLinkedProjects')
      `;
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN linked_project_ids_json TEXT NOT NULL DEFAULT '[]'
      `;

      yield* runMigrations();
      yield* runExperimentalFeatureMigrations([CORE_FEATURE_MIGRATIONS]);

      assert.deepStrictEqual(
        (yield* coreMigrationRows()).map((row) => row.migration_id),
        [37],
      );
      assert.include(yield* columnNames("projection_threads"), "linked_project_ids_json");
      assert.include(yield* columnNames("projection_projects"), "linked_project_ids_json");
    }),
  );
});
