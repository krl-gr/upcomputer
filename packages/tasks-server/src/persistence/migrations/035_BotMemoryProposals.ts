import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Existing memories stay active. Proposals keep the memory id they would write, since
// their own id must not collide with that active entry.
export const BotMemoryProposalsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE bot_memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`;
  yield* sql`ALTER TABLE bot_memories ADD COLUMN target_id TEXT`;
});
