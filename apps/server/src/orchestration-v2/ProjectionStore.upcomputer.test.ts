import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layer = Layer.mergeAll(
  SqlitePersistence.layerMemory,
  ProjectionStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
);

it.layer(layer)("hasPersonMessageOutsideThread", (it) => {
  it.effect("leaves out messages to the free agent when asked", () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-11-24T00:00:00.000Z";
      const personMessage = (id: string, threadId: string, provider: string, model: string) =>
        Effect.all([
          sql`INSERT INTO orchestration_v2_projection_messages
            (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
            VALUES (${id}, ${threadId}, NULL, NULL, 'user', 0, ${now}, ${now},
              ${JSON.stringify({ createdBy: "user", creationSource: "web" })})`,
          sql`INSERT INTO orchestration_v2_projection_runs
            (run_id, thread_id, ordinal, provider, provider_instance_id, provider_thread_id, status,
              requested_at, completed_at, payload_json)
            VALUES (${`run:${id}`}, ${threadId}, 1, ${provider}, ${provider}, NULL, 'completed',
              ${now}, ${now}, ${JSON.stringify({ userMessageId: id, modelSelection: { model } })})`,
        ]);
      const here = ThreadId.make("thread:here");
      const elsewhere = (options?: { readonly exceptFreeAgent?: boolean }) =>
        store.hasPersonMessageOutsideThread(here, options);

      yield* personMessage("free", "thread:setup", "opencode", "opencode/glm-5.3-flash-free");
      assert.isTrue(yield* elsewhere());
      assert.isFalse(yield* elsewhere({ exceptFreeAgent: true }));

      // The user's own OpenCode on their own keys is a real agent.
      yield* personMessage("own", "thread:own", "opencode", "anthropic/claude-sonnet-5-5");
      assert.isTrue(yield* elsewhere({ exceptFreeAgent: true }));
    }),
  );
});
