import {
  OrchestrationProposalApplicationState,
  OrchestrationProposalSnapshot,
  OrchestrationProposalSpec,
  OrchestrationProposedPlanId,
  TaskAgentId,
  TaskId,
  type OrchestrationProposalSearchInput,
  type OrchestrationProposalSpec as OrchestrationProposalSpecType,
} from "@upcomputer/tasks-contracts/v1";
import { ThreadId } from "@upcomputer/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const StoredProposalApplicationState = OrchestrationProposalApplicationState;
export type StoredProposalApplicationState = typeof StoredProposalApplicationState.Type;

export const StoredOrchestrationProposal = OrchestrationProposalSnapshot;
export type StoredOrchestrationProposal = typeof StoredOrchestrationProposal.Type;

export class ProposalStoreError extends Schema.TaggedErrorClass<ProposalStoreError>()(
  "ProposalStoreError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

interface ProposalRow {
  readonly threadId: string;
  readonly planId: string;
  readonly ownerId: string;
  readonly modeId: string;
  readonly modeVersion: number;
  readonly proposalJson: string;
  readonly applicationState: string;
  readonly agentIdsJson: string;
  readonly taskIdsJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appliedAt: string | null;
}

export interface ProposalStoreShape {
  readonly upsertOutput: (input: {
    readonly threadId: ThreadId;
    readonly planId: OrchestrationProposedPlanId;
    readonly ownerId: string;
    readonly modeId: string;
    readonly modeVersion: number;
    readonly proposal: OrchestrationProposalSpecType;
    readonly createdAt: string;
  }) => Effect.Effect<StoredOrchestrationProposal, ProposalStoreError>;
  readonly get: (input: {
    readonly threadId: ThreadId;
    readonly planId: OrchestrationProposedPlanId;
  }) => Effect.Effect<Option.Option<StoredOrchestrationProposal>, ProposalStoreError>;
  readonly search: (
    input: OrchestrationProposalSearchInput,
  ) => Effect.Effect<ReadonlyArray<StoredOrchestrationProposal>, ProposalStoreError>;
  readonly claimApplication: (input: {
    readonly threadId: ThreadId;
    readonly planId: OrchestrationProposedPlanId;
    readonly updatedAt: string;
  }) => Effect.Effect<StoredOrchestrationProposal, ProposalStoreError>;
  readonly completeApplication: (input: {
    readonly threadId: ThreadId;
    readonly planId: OrchestrationProposedPlanId;
    readonly agentIds: ReadonlyArray<TaskAgentId>;
    readonly taskIds: ReadonlyArray<TaskId>;
    readonly appliedAt: string;
  }) => Effect.Effect<StoredOrchestrationProposal, ProposalStoreError>;
}

export class ProposalStore extends Context.Service<ProposalStore, ProposalStoreShape>()(
  "@upcomputer/tasks-server/proposals/ProposalStore",
) {}

const decodeProposal = Schema.decodeUnknownSync(OrchestrationProposalSpec);

const decodeApplicationState = Schema.decodeUnknownSync(StoredProposalApplicationState);
const decodeAgentIds = Schema.decodeUnknownSync(Schema.Array(TaskAgentId));
const decodeTaskIds = Schema.decodeUnknownSync(Schema.Array(TaskId));

function decodeRow(row: ProposalRow): StoredOrchestrationProposal {
  return {
    threadId: ThreadId.make(row.threadId),
    planId: row.planId,
    ownerId: row.ownerId,
    modeId: row.modeId,
    modeVersion: row.modeVersion,
    proposal: decodeProposal(JSON.parse(row.proposalJson)),
    applicationState: decodeApplicationState(row.applicationState),
    agentIds: decodeAgentIds(JSON.parse(row.agentIdsJson)),
    taskIds: decodeTaskIds(JSON.parse(row.taskIdsJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appliedAt: row.appliedAt,
  };
}

function storeError(operation: string) {
  return (cause: unknown) =>
    new ProposalStoreError({
      operation,
      message: `Failed to ${operation} an Orchestrator proposal.`,
      cause,
    });
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const load = (input: { threadId: ThreadId; planId: OrchestrationProposedPlanId }) =>
    sql<ProposalRow>`
          SELECT
            thread_id AS "threadId",
            plan_id AS "planId",
            owner_id AS "ownerId",
            mode_id AS "modeId",
            mode_version AS "modeVersion",
            proposal_json AS "proposalJson",
            application_state AS "applicationState",
            agent_ids_json AS "agentIdsJson",
            task_ids_json AS "taskIdsJson",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            applied_at AS "appliedAt"
          FROM upcomputer_orchestrator_proposals
          WHERE thread_id = ${input.threadId} AND plan_id = ${input.planId}
          LIMIT 1
        `.pipe(
      Effect.map((rows) => (rows[0] ? Option.some(decodeRow(rows[0])) : Option.none())),
      Effect.mapError(storeError("load")),
    );

  const upsertOutput: ProposalStoreShape["upsertOutput"] = (input) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO upcomputer_orchestrator_proposals (
          thread_id, plan_id, owner_id, mode_id, mode_version, proposal_json,
          application_state, agent_ids_json, task_ids_json, created_at, updated_at, applied_at
        ) VALUES (
          ${input.threadId}, ${input.planId}, ${input.ownerId}, ${input.modeId},
          ${input.modeVersion}, ${JSON.stringify(input.proposal)}, 'pending', '[]', '[]',
          ${input.createdAt}, ${input.createdAt}, NULL
        )
        ON CONFLICT (thread_id, plan_id) DO UPDATE SET
          proposal_json = CASE
            WHEN upcomputer_orchestrator_proposals.application_state = 'pending'
            THEN excluded.proposal_json
            ELSE upcomputer_orchestrator_proposals.proposal_json
          END,
          updated_at = excluded.updated_at
      `;
      return yield* load(input).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(storeError("reload")(new Error("Proposal disappeared."))),
            onSome: Effect.succeed,
          }),
        ),
      );
    }).pipe(Effect.mapError(storeError("persist")));

  const get: ProposalStoreShape["get"] = (input) => load(input);

  const search: ProposalStoreShape["search"] = (input) => {
    const threadId = input.threadId ?? null;
    const applicationState = input.applicationState ?? null;
    const limit = input.limit ?? 100;
    return sql<ProposalRow>`
      SELECT
        thread_id AS "threadId",
        plan_id AS "planId",
        owner_id AS "ownerId",
        mode_id AS "modeId",
        mode_version AS "modeVersion",
        proposal_json AS "proposalJson",
        application_state AS "applicationState",
        agent_ids_json AS "agentIdsJson",
        task_ids_json AS "taskIdsJson",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        applied_at AS "appliedAt"
      FROM upcomputer_orchestrator_proposals
      WHERE (${threadId} IS NULL OR thread_id = ${threadId})
        AND (${applicationState} IS NULL OR application_state = ${applicationState})
      ORDER BY updated_at DESC, created_at DESC, plan_id ASC
      LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map(decodeRow)),
      Effect.mapError(storeError("search")),
    );
  };

  const claimApplication: ProposalStoreShape["claimApplication"] = (input) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE upcomputer_orchestrator_proposals
        SET application_state = 'applying', updated_at = ${input.updatedAt}
        WHERE thread_id = ${input.threadId}
          AND plan_id = ${input.planId}
          AND application_state = 'pending'
      `;
      const proposal = yield* load(input);
      return yield* Option.match(proposal, {
        onNone: () => Effect.fail(storeError("claim")(new Error("Proposal not found."))),
        onSome: Effect.succeed,
      });
    }).pipe(Effect.mapError(storeError("claim")));

  const completeApplication: ProposalStoreShape["completeApplication"] = (input) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE upcomputer_orchestrator_proposals
        SET
          application_state = 'applied',
          agent_ids_json = ${JSON.stringify(input.agentIds)},
          task_ids_json = ${JSON.stringify(input.taskIds)},
          applied_at = ${input.appliedAt},
          updated_at = ${input.appliedAt}
        WHERE thread_id = ${input.threadId} AND plan_id = ${input.planId}
      `;
      const proposal = yield* load(input);
      return yield* Option.match(proposal, {
        onNone: () => Effect.fail(storeError("complete")(new Error("Proposal not found."))),
        onSome: Effect.succeed,
      });
    }).pipe(Effect.mapError(storeError("complete")));

  return {
    upsertOutput,
    get,
    search,
    claimApplication,
    completeApplication,
  } satisfies ProposalStoreShape;
});

export const ProposalStoreLive = Layer.effect(ProposalStore, make);
