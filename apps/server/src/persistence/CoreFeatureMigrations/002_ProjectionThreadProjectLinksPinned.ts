import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Marks threads whose project links the user edited by removing one, so
// auto-linking never overrides that choice. 1 = pinned.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some((column) => column.name === "project_links_pinned")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN project_links_pinned INTEGER NOT NULL DEFAULT 0
    `;
  }
});
