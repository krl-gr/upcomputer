import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Who keeps a bot's memory: Up.computer ("upcomputer"), or the agent itself ("agent"). */
export const BotMemoryModeMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE bots ADD COLUMN memory_mode TEXT NOT NULL DEFAULT 'upcomputer'`;
});
