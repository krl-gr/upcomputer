import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const ORCHESTRATOR_PROPOSAL_MIGRATION_CONTRIBUTION = {
  ownerId: "upcomputer.tasks",
  namespace: "upcomputer.orchestrator-proposals",
  migrations: [
    {
      version: 1,
      name: "CreateOrchestratorProposalStorage",
      run: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          CREATE TABLE IF NOT EXISTS upcomputer_orchestrator_proposals (
            thread_id TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            mode_id TEXT NOT NULL,
            mode_version INTEGER NOT NULL,
            proposal_json TEXT NOT NULL,
            application_state TEXT NOT NULL,
            agent_ids_json TEXT NOT NULL,
            task_ids_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            applied_at TEXT,
            PRIMARY KEY (thread_id, plan_id)
          )
        `;
        yield* sql`
          CREATE INDEX IF NOT EXISTS idx_upcomputer_orchestrator_proposals_thread_updated
          ON upcomputer_orchestrator_proposals (thread_id, updated_at DESC)
        `;
      }),
    },
  ],
} as const;
