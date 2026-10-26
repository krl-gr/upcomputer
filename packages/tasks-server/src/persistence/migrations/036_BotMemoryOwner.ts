import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Existing entries are classified by their source. "user" came from the Memory settings,
// ".../message:..." from a "remember:" message, and "task:..." is active only through an
// accepted suggestion: all the user's. A plain "chat:<thread>" is the bot's own bot_remember.
export const BotMemoryOwnerMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE bot_memories ADD COLUMN owner TEXT NOT NULL DEFAULT 'bot'`;
  yield* sql`UPDATE bot_memories SET owner = 'user'
  WHERE status = 'active' AND (source = 'user' OR source LIKE 'task:%' OR source LIKE '%/message:%')`;
});
