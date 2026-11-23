import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// A person's `@bot` message, sent to the bot's chat from another thread, and the bot run that
// answers it. The reply goes back to `origin_thread_id`; `pending` rows are relayed at startup.
// `context` is the origin's latest conversation when the person sent it, for the bot's turn.
export const BotMentionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bot_mentions (
    message_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    bot_thread_id TEXT NOT NULL,
    origin_thread_id TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    context TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX bot_mentions_pending_run ON bot_mentions (run_id) WHERE status = 'pending'`;
  yield* sql`CREATE INDEX bot_mentions_thread_run ON bot_mentions (bot_thread_id, run_id)`;
});
