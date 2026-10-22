import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const BotAppearanceMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE bots ADD COLUMN appearance_json TEXT`;
});
