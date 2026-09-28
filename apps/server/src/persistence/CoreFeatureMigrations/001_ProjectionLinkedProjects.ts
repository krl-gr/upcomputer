import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Threads and projects can link other projects: a thread's links place it
// under more projects, a project's links ("tags") extend to all its threads.
// Stored as JSON arrays of project ids; readers drop ids of deleted projects.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some((column) => column.name === "linked_project_ids_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN linked_project_ids_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

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
