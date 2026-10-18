import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const BotsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bots (
    agent_id TEXT PRIMARY KEY REFERENCES task_agents(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    allowed_projects_json TEXT NOT NULL,
    adopted INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE TABLE bot_memories (
    agent_id TEXT NOT NULL REFERENCES bots(agent_id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    project_id TEXT,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (agent_id, id)
  )`;
  yield* sql`CREATE INDEX bot_memories_scope ON bot_memories(agent_id, project_id, updated_at)`;
});
