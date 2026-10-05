import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// A project can link projects for all of its threads, stored as a JSON array
// of project ids; readers drop ids of deleted projects. Thread links live in
// the v2 thread record. V1 also added a thread column here, which v2 does not
// read; a V1 database keeps it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  if (!projectColumns.some((column) => column.name === "linked_project_ids_json")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN linked_project_ids_json TEXT NOT NULL DEFAULT '[]'
    `;
  }
});
