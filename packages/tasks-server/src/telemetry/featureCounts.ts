import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { registerHeartbeatCounts } from "../../../../apps/server/src/extensionApi.ts";

interface FeatureCountsRow {
  readonly agentTaskCount: number;
  readonly personTaskCount: number;
  readonly enabledAgentCount: number;
  readonly botCount: number;
  readonly automationCount: number;
}

/**
 * Unarchived tasks by audience (routines left out), enabled agents other than
 * bots, bots, and enabled automations, for `server.boot.heartbeat`.
 */
export const TaskFeatureCountsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* registerHeartbeatCounts(
      sql<FeatureCountsRow>`
        SELECT
          (SELECT COUNT(*) FROM tasks
            WHERE archived_at IS NULL AND kind = 'task' AND audience = 'agent') AS "agentTaskCount",
          (SELECT COUNT(*) FROM tasks
            WHERE archived_at IS NULL AND kind = 'task' AND audience = 'person') AS "personTaskCount",
          (SELECT COUNT(*) FROM task_agents a
            WHERE a.enabled = 1
              AND NOT EXISTS (SELECT 1 FROM bots b WHERE b.agent_id = a.id)) AS "enabledAgentCount",
          (SELECT COUNT(*) FROM bots) AS "botCount",
          (SELECT COUNT(*) FROM task_automations WHERE status = 'enabled') AS "automationCount"
      `.pipe(Effect.map(([row]) => row ?? {})),
    );
  }),
);
